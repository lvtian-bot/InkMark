import { describe, expect, it } from 'vitest';
import { headingsFromMarkdown } from './outline-move';

describe('headingsFromMarkdown', () => {
  it('识别 ATX 标题并记录行首位置', () => {
    const doc = '# A\n\n## B\n\nbody';
    expect(headingsFromMarkdown(doc)).toEqual([
      { pos: 0, level: 1 },
      { pos: 5, level: 2 },
    ]);
  });

  it('跳过 YAML frontmatter 内的内容', () => {
    const doc = '---\ntitle: # 不是标题\n---\n\n# A';
    expect(headingsFromMarkdown(doc)).toEqual([{ pos: doc.indexOf('# A'), level: 1 }]);
  });

  it('识别 setext 标题,位置记在标题文字行首', () => {
    const doc = 'A\n===\n\nB\n---\n';
    expect(headingsFromMarkdown(doc)).toEqual([
      { pos: 0, level: 1 },
      { pos: 7, level: 2 },
    ]);
  });

  it('围栏代码块内的 # 不算标题', () => {
    const doc = '# A\n\n```bash\n# 注释\n```\n\n# B';
    expect(headingsFromMarkdown(doc).map((heading) => heading.level)).toEqual([1, 1]);
    expect(headingsFromMarkdown(doc)[1].pos).toBe(doc.indexOf('# B'));
  });

  it('波浪号围栏同样生效', () => {
    const doc = '~~~\n# 注释\n~~~\n\n# B';
    expect(headingsFromMarkdown(doc)).toEqual([{ pos: doc.indexOf('# B'), level: 1 }]);
  });

  it('六个以上 # 或缺少空格不是标题', () => {
    const doc = '####### 不是标题\n#不是标题\n\n# 是标题';
    expect(headingsFromMarkdown(doc)).toEqual([{ pos: doc.indexOf('# 是标题'), level: 1 }]);
  });

  it('CRLF 换行下位置正确', () => {
    const doc = '# A\r\n\r\n## B\r\n';
    expect(headingsFromMarkdown(doc)).toEqual([
      { pos: 0, level: 1 },
      { pos: 7, level: 2 },
    ]);
  });

  it('四反引号围栏内的三反引号行不闭合代码块', () => {
    const doc = '# A\n\n````markdown\n```\n# fake\n````\n\n# B\n\nbody';
    expect(headingsFromMarkdown(doc)).toEqual([
      { pos: 0, level: 1 },
      { pos: doc.indexOf('# B'), level: 1 },
    ]);
  });

  it('闭合围栏长度不足时不闭合', () => {
    const doc = '# A\n\n````\n```\n# fake\n````\n\n# B';
    expect(headingsFromMarkdown(doc).map((heading) => heading.level)).toEqual([1, 1]);
  });

  it('识别引用块内的标题', () => {
    const doc = '# A\n\n> # Quote\n\n# B';
    expect(headingsFromMarkdown(doc)).toEqual([
      { pos: 0, level: 1 },
      { pos: doc.indexOf('> # Quote'), level: 1 },
      { pos: doc.indexOf('# B'), level: 1 },
    ]);
  });

  it('识别列表项内的标题', () => {
    const doc = '# A\n\n- # Item\n\n# B';
    expect(headingsFromMarkdown(doc).map((heading) => heading.level)).toEqual([1, 1, 1]);
  });

  it('识别嵌套容器内的标题', () => {
    const doc = '# A\n\n> - > ## Deep\n\n# B';
    expect(headingsFromMarkdown(doc)).toEqual([
      { pos: 0, level: 1 },
      { pos: doc.indexOf('> - > ## Deep'), level: 2 },
      { pos: doc.indexOf('# B'), level: 1 },
    ]);
  });
});
