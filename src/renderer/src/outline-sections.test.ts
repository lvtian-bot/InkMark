import { describe, expect, it } from 'vitest';
import {
  computeSectionRanges,
  expandToLineEnd,
  expandToLineStart,
  isSectionAncestor,
  moveSection,
  resolveDropAnchor,
  type HeadingRange,
} from './outline-sections';

/** 按行首的 `#` 标记模拟大纲标题位置，避免测试依赖 Markdown 解析器。 */
function headingsOf(doc: string): HeadingRange[] {
  const headings: HeadingRange[] = [];
  let offset = 0;
  for (const line of doc.split('\n')) {
    const match = /^(#{1,6})\s+/.exec(line);
    if (match) headings.push({ pos: offset, level: match[1].length });
    offset += line.length + 1;
  }
  return headings;
}

function sectionTexts(doc: string): string[] {
  return computeSectionRanges(doc, headingsOf(doc)).map((range) =>
    doc.slice(range.from, range.to).replace(/\s+$/, ''),
  );
}

function move(
  doc: string,
  fromIndex: number,
  kind: 'before' | 'after',
  index: number,
): string | null {
  const result = moveSection(doc, computeSectionRanges(doc, headingsOf(doc)), fromIndex, {
    kind,
    index,
  });
  return result ? result.content : null;
}

const doc = [
  '# A',
  '',
  'a body',
  '',
  '## A1',
  '',
  'a1 body',
  '',
  '## A2',
  '',
  'a2 body',
  '',
  '# B',
  '',
  'b body',
].join('\n');

describe('expandToLineStart / expandToLineEnd', () => {
  it('行首偏移原样返回', () => {
    expect(expandToLineStart('abc\ndef', 4)).toBe(4);
  });

  it('行中偏移回到行首', () => {
    expect(expandToLineStart('abc\ndef', 6)).toBe(4);
  });

  it('行首偏移延伸到含换行符的行尾', () => {
    expect(expandToLineEnd('abc\ndef', 4)).toBe(7);
  });

  it('末行延伸到文末', () => {
    expect(expandToLineEnd('abc\ndef', 5)).toBe(7);
  });
});

describe('computeSectionRanges', () => {
  it('父章节包含全部子章节,同级标题另起一节', () => {
    expect(sectionTexts(doc)).toEqual([
      '# A\n\na body\n\n## A1\n\na1 body\n\n## A2\n\na2 body',
      '## A1\n\na1 body',
      '## A2\n\na2 body',
      '# B\n\nb body',
    ]);
  });

  it('区间按文档顺序返回,父章节覆盖其后全部子章节', () => {
    const ranges = computeSectionRanges(doc, headingsOf(doc));
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index - 1].from).toBeLessThan(ranges[index].from);
    }
    // 父章节 A 覆盖子章节 A1、A2 的全部内容，止于同级标题 B。
    expect(ranges[0].to).toBeGreaterThanOrEqual(ranges[2].to);
    expect(ranges[0].to).toBeLessThan(ranges[3].from + 1);
  });

  it('章节内容不含末尾空行,空行记录在 gapTo 中', () => {
    const ranges = computeSectionRanges(doc, headingsOf(doc));
    for (const range of ranges) {
      // 末尾允许残留一个换行符（行尾），但不允许出现空行。
      expect(doc.slice(range.from, range.to)).not.toMatch(/\n\s*\n$/);
      expect(range.gapTo).toBeGreaterThanOrEqual(range.to);
    }
  });

  it('标题之前的内容不属于任何章节', () => {
    const content = 'a body\n\n# B\n\nb body';
    const ranges = computeSectionRanges(content, [{ pos: 7, level: 1 }]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].from).toBe(7);
  });

  it('文末章节延伸到文末', () => {
    const content = '# A\n\na body';
    const ranges = computeSectionRanges(content, [{ pos: 0, level: 1 }]);
    expect(content.slice(ranges[0].from, ranges[0].to)).toBe('# A\n\na body');
  });

  it('空大纲返回空数组', () => {
    expect(computeSectionRanges('', [])).toEqual([]);
  });
});

describe('moveSection', () => {
  it('把后一章搬到前一章之前', () => {
    expect(move(doc, 3, 'before', 0)).toBe(
      [
        '# B',
        '',
        'b body',
        '',
        '# A',
        '',
        'a body',
        '',
        '## A1',
        '',
        'a1 body',
        '',
        '## A2',
        '',
        'a2 body',
      ].join('\n'),
    );
  });

  it('把前一章搬到后一章之后', () => {
    expect(move(doc, 0, 'after', 3)).toBe(
      [
        '# B',
        '',
        'b body',
        '',
        '# A',
        '',
        'a body',
        '',
        '## A1',
        '',
        'a1 body',
        '',
        '## A2',
        '',
        'a2 body',
      ].join('\n'),
    );
  });

  it('子章节搬到父章节之前时整节一起移动', () => {
    const result = move(doc, 2, 'before', 0);
    expect(result?.startsWith('## A2\n\na2 body\n\n# A\n')).toBe(true);
    // 原位置不再残留 A2 章节。
    expect(result?.match(/## A2/g)).toHaveLength(1);
  });

  it('同级章节之间换位后每个标题恰好出现一次', () => {
    const result = move(doc, 2, 'before', 1);
    const lines = (result ?? '').split('\n');
    for (const heading of ['# A', '## A1', '## A2', '# B']) {
      expect(lines.filter((line) => line === heading)).toHaveLength(1);
    }
    const order = ['## A2', '## A1'].map((heading) => lines.indexOf(heading));
    expect(order[0]).toBeLessThan(order[1]);
  });

  it('原地搬到自己之前返回 null', () => {
    expect(move(doc, 3, 'before', 3)).toBeNull();
  });

  it('搬到自己之后返回 null', () => {
    expect(move(doc, 3, 'after', 3)).toBeNull();
  });

  it('落点落在自己内部返回 null', () => {
    // 把 A 搬到其子章节 A1 之后，属于自己内部。
    expect(move(doc, 0, 'after', 1)).toBeNull();
  });

  it('章节之间保持一个空行分隔', () => {
    const result = move(doc, 3, 'before', 0);
    expect(result).not.toMatch(/\n{3,}/);
  });
});

describe('resolveDropAnchor / isSectionAncestor', () => {
  it('鼠标在标题行上半区插到该章节之前', () => {
    expect(resolveDropAnchor(2, 0.2)).toEqual({ kind: 'before', index: 2 });
  });

  it('鼠标在标题行下半区插到该章节之后', () => {
    expect(resolveDropAnchor(2, 0.8)).toEqual({ kind: 'after', index: 2 });
  });

  it('拖到自己身上属于自身范围', () => {
    const headings = headingsOf(doc);
    expect(isSectionAncestor(headings, 3, 3)).toBe(true);
  });

  it('拖到自己子章节内部属于自身范围', () => {
    const headings = headingsOf(doc);
    expect(isSectionAncestor(headings, 0, 1)).toBe(true);
    expect(isSectionAncestor(headings, 0, 2)).toBe(true);
  });

  it('拖到其他章节不属于自身范围', () => {
    const headings = headingsOf(doc);
    expect(isSectionAncestor(headings, 0, 3)).toBe(false);
    expect(isSectionAncestor(headings, 3, 0)).toBe(false);
  });

  it('遇到同级标题后不再属于父章节', () => {
    // A(1) A1(2) A2(2) B(1)：A2 不在 A1 之内
    const headings = headingsOf(doc);
    expect(isSectionAncestor(headings, 1, 2)).toBe(false);
  });
});
