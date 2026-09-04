import { describe, expect, it } from 'vitest';
import {
  anchorReviewChunks,
  computeReviewChunks,
  tokenizeReviewText,
  verifyAnchoredChunks,
} from './review-diff';

describe('tokenizeReviewText', () => {
  it('整行（含换行符）成一个 token', () => {
    expect(tokenizeReviewText('第一行\n第二行')).toEqual(['第一行\n', '第二行']);
  });

  it('空行也是一个 token', () => {
    expect(tokenizeReviewText('a\n\nb')).toEqual(['a\n', '\n', 'b']);
  });

  it('无换行的末行单独成 token', () => {
    expect(tokenizeReviewText('hello world')).toEqual(['hello world']);
  });
});

describe('computeReviewChunks', () => {
  it('内容相同则无改动块', () => {
    expect(computeReviewChunks('abc', 'abc')).toEqual([]);
  });

  it('纯新增：插入整行构成无旧侧的 insertedText', () => {
    const chunks = computeReviewChunks('# 标题\n\n正文\n', '# 标题\n\n正文\n新段落');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].removedText).toBe('');
    expect(chunks[0].insertedText).toBe('新段落');
  });

  it('纯删除：removedText 记录被删内容，baseOffset 指向其起点', () => {
    const base = '保留\n删除我\n结尾';
    const chunks = computeReviewChunks(base, '保留\n结尾');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].removedText).toBe('删除我\n');
    expect(
      base.slice(chunks[0].baseOffset, chunks[0].baseOffset + chunks[0].removedText.length),
    ).toBe('删除我\n');
  });

  it('按行粒度：一行内一个字的变化整行成一个块', () => {
    const chunks = computeReviewChunks('这是第一句话。\n', '这是第二句话。\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].removedText).toBe('这是第一句话。\n');
    expect(chunks[0].insertedText).toBe('这是第二句话。\n');
  });

  it('相隔数行的两处改动构成两个块，各自带前后上下文', () => {
    const base = 'AAA\n第一处改动\n结尾\n\nBBBB\n第二处改动\n结尾';
    const disk = 'AAA\n外部一号\n结尾\n\nBBBB\n外部二号\n结尾';
    const chunks = computeReviewChunks(base, disk);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].beforeContext).toContain('AAA');
    expect(chunks[0].afterContext).toContain('结尾');
    expect(chunks[1].beforeContext).toContain('BBBB');
  });

  it('连续改动的多行合并为一个块', () => {
    const base = '头\n第一行旧\n第二行旧\n尾';
    const disk = '头\n第一行新\n第二行新\n尾';
    const chunks = computeReviewChunks(base, disk);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].removedText).toBe('第一行旧\n第二行旧\n');
    expect(chunks[0].insertedText).toBe('第一行新\n第二行新\n');
  });

  it('上下文不超过 10 行', () => {
    const prefix = Array.from({ length: 15 }, (_, i) => `第${i}行\n`).join('');
    const base = `${prefix}目标行`;
    const disk = `${prefix}改动行`;
    const chunks = computeReviewChunks(base, disk);
    expect(chunks).toHaveLength(1);
    expect(tokenizeReviewText(chunks[0].beforeContext).length).toBeLessThanOrEqual(10);
    expect(tokenizeReviewText(chunks[0].afterContext).length).toBeLessThanOrEqual(10);
  });
});

describe('anchorReviewChunks', () => {
  it('buffer 与 base 一致时锚点即 base 偏移', () => {
    const base = '前文\n被替换的段落\n后文';
    const chunks = computeReviewChunks(base, '前文\n新段落\n后文');
    const anchored = anchorReviewChunks(chunks, base, base);
    expect(anchored).toHaveLength(1);
    expect(base.startsWith('被替换的段落', anchored[0].anchor)).toBe(true);
  });

  it('用户在改动之前的编辑使锚点平移', () => {
    const base = '开头\n中间\n被改\n结尾';
    const disk = '开头\n中间\n外部\n结尾';
    const buffer = '插入了几个字\n开头\n中间\n被改\n结尾';
    const anchored = anchorReviewChunks(computeReviewChunks(base, disk), base, buffer);
    expect(anchored).toHaveLength(1);
    expect(buffer.startsWith('被改', anchored[0].anchor)).toBe(true);
  });

  it('用户已改掉旧文本的区域，锚定失败即丢弃（用户编辑优先）', () => {
    const base = '用户改过的区域旧文本尾巴';
    const disk = '用户改过的区域新文本尾巴';
    const buffer = '用户改过的区域自己写的尾巴';
    const anchored = anchorReviewChunks(computeReviewChunks(base, disk), base, buffer);
    expect(anchored).toHaveLength(0);
  });

  it('用户已删掉旧文本时，纯删除块按用户编辑优先丢弃', () => {
    const base = 'AAAA\n被删除的行\nBBBB';
    const disk = 'AAAA\nBBBB';
    // 用户已手动删掉「被删除的行」，buffer 中旧文本不复存在；
    // 删除事实上已被用户完成，外部改动块不应再锚定。
    const buffer = 'AAAA\nBBBB';
    const anchored = anchorReviewChunks(computeReviewChunks(base, disk), base, buffer);
    expect(anchored).toHaveLength(0);
  });

  it('二次入库：块的上下文含未接受的前次改动时，仍锚定到 buffer 中的旧文本', () => {
    // 快照 D1 已含 AI 第一次改动（外部一），但用户未接受，buffer 仍是第一块。
    const base = 'AAAA\n外部一\nBBBB\n第二块\n结尾';
    const disk = 'AAAA\n外部一\nBBBB\n外部二\n结尾';
    const buffer = 'AAAA\n第一块\nBBBB\n第二块\n结尾';
    const anchored = anchorReviewChunks(computeReviewChunks(base, disk), base, buffer);
    expect(anchored).toHaveLength(1);
    expect(buffer.startsWith(anchored[0].removedText, anchored[0].anchor)).toBe(true);
    expect(anchored[0].insertedText).toBe('外部二\n');
  });

  it('偏移映射在等值段内做插值：用户前置编辑后锚点落在正确位置', () => {
    const base = '头\nAAAA\n目标段\n尾';
    const disk = '头\nAAAA\n外部段\n尾';
    // 用户在文档最前面加了两个字，块仍在「目标段」处。
    const buffer = '插字头\nAAAA\n目标段\n尾';
    const anchored = anchorReviewChunks(computeReviewChunks(base, disk), base, buffer);
    expect(anchored).toHaveLength(1);
    expect(buffer.startsWith('目标段', anchored[0].anchor)).toBe(true);
  });
});

describe('verifyAnchoredChunks', () => {
  it('上下文仍成立的块保留，失效且无法重定位的块丢弃', () => {
    const base = 'AAAA\n第一块\nBBBB\n第二块\n结尾';
    const disk = 'AAAA\n外部一\nBBBB\n外部二\n结尾';
    const anchored = anchorReviewChunks(computeReviewChunks(base, disk), base, base);
    expect(anchored).toHaveLength(2);

    // 用户只在文档开头插入一行、并改写了第二块所在行：第一块可唯一重定位，
    // 第二块无法重定位而丢弃。
    const buffer = '多了几个字\nAAAA\n第一块\nBBBB\n自己写的\n结尾';
    const verified = verifyAnchoredChunks(anchored, buffer);
    expect(verified).toHaveLength(1);
    expect(verified[0].insertedText).toBe('外部一\n');
    expect(buffer.startsWith('第一块', verified[0].anchor)).toBe(true);
  });

  it('锚点偏移但上下文可唯一重定位时修正锚点', () => {
    const base = '前文\n改动\n后文';
    const disk = '前文\n外部\n后文';
    const anchored = anchorReviewChunks(computeReviewChunks(base, disk), base, base);
    // 人为把锚点挪错，验证会被唯一匹配纠正。
    const shifted = anchored.map((c) => ({ ...c, anchor: 0 }));
    const verified = verifyAnchoredChunks(shifted, base);
    expect(verified).toHaveLength(1);
    expect(base.startsWith('改动', verified[0].anchor)).toBe(true);
  });
});
