import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canDropOutlineSection,
  canMoveOutlineSection,
  headingsFromMarkdown,
  moveOutlineSection,
} from './outline-move';
import {
  computeSectionRanges,
  hasExpectedHeadingOrder,
  hasSafeSectionBoundaries,
  hasStableLinkDefinitions,
  hasUnclosedFence,
  moveSection,
} from './outline-sections';
import { extractHeadings } from './hooks/useOutline';
import { sourceEditorHandle } from './source-editor-ref';
import { useStore } from './stores/useStore';

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

describe('hasUnclosedFence', () => {
  it('文末未闭合的围栏被识别', () => {
    expect(hasUnclosedFence('# A\n\na\n\n# B\n\n```js\ncode', 0)).toBe(true);
  });

  it('已闭合的围栏不算未闭合', () => {
    expect(hasUnclosedFence('# A\n\n```js\ncode\n```\n\n# B', 0)).toBe(false);
  });

  it('闭合围栏长度不足时仍视为未闭合', () => {
    expect(hasUnclosedFence('````\n```\ncode\n````', 0)).toBe(false);
    expect(hasUnclosedFence('````\ncode\n```', 0)).toBe(true);
  });

  it('识别带缩进和伪闭合行的未闭合围栏', () => {
    expect(hasUnclosedFence('# A\n\n# B\n\n  ```js\ncode', 0)).toBe(true);
    expect(hasUnclosedFence('# A\n\n# B\n\n```js\n```not-a-close\ncode', 0)).toBe(true);
  });

  it('区分引用内结束的围栏和后续的普通章节', () => {
    expect(hasUnclosedFence('# A\n\n> ```js\n> code\n\n# B', 0)).toBe(true);
    expect(hasUnclosedFence('# A\n\n> ```js\n> code\n> ```\n\n# B', 0)).toBe(false);
  });

  it('没有围栏时返回 false', () => {
    expect(hasUnclosedFence('# A\n\nbody', 0)).toBe(false);
  });
});

describe('YAML 元信息不参与正文安全检查', () => {
  it.each(['\n', '\r\n'])('保留原文坐标并允许安全移动（换行 %j）', (eol) => {
    const metadata = [
      '---',
      'description: |',
      '  ```js',
      '  # example',
      '  [x]: /metadata',
      '  <!-- example',
      '---',
      '',
      '',
    ].join(eol);
    const doc = metadata + ['# A', '', 'a', '', '# B', '', 'b'].join(eol);
    const headings = headingsFromMarkdown(doc);
    expect(headings).toEqual([
      { pos: doc.indexOf('# A'), level: 1 },
      { pos: doc.indexOf('# B'), level: 1 },
    ]);
    const ranges = computeSectionRanges(doc, headings);
    const anchor = { kind: 'before', index: 0 } as const;
    const result = moveSection(doc, ranges, 1, anchor);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.content.startsWith(metadata.trimEnd())).toBe(true);
    expect(hasUnclosedFence(doc, 0)).toBe(false);
    expect(hasSafeSectionBoundaries(doc, ranges, 1, anchor)).toBe(true);
    expect(hasExpectedHeadingOrder(doc, result.content, ranges, 1, anchor)).toBe(true);
    expect(hasStableLinkDefinitions(doc, result.content)).toBe(true);
  });

  it('空元信息不产生假标题', () => {
    expect(headingsFromMarkdown('---\n---\n\n# A')).toEqual([{ pos: 9, level: 1 }]);
  });

  it('跳过元信息后仍能发现正文中的未闭合围栏', () => {
    expect(hasUnclosedFence('---\ntitle: example\n---\n\n# A\n\n```js\ncode', 0)).toBe(true);
  });
});

describe('富文本大纲标题标识', () => {
  it('标题本身带序号时仍不与重复标题的标识冲突', () => {
    const texts = ['a', 'a-1', 'a', 'B'];
    const doc = {
      descendants: (
        visit: (
          node: { type: { name: string }; attrs: { level: number }; textContent: string },
          pos: number,
        ) => boolean,
      ) => {
        texts.forEach((textContent, pos) =>
          visit({ type: { name: 'heading' }, attrs: { level: 1 }, textContent }, pos),
        );
      },
    };
    expect(extractHeadings(doc).map((heading) => heading.id)).toEqual(['a', 'a-1', 'a-2', 'b']);
  });
});

describe('源码模式大纲搬移接入', () => {
  const initialState = useStore.getState();

  afterEach(() => {
    useStore.setState(initialState);
    sourceEditorHandle.current = null;
  });

  function prepare(doc: string, readOnly = false) {
    const state = EditorState.create({
      doc,
      extensions: [markdown(), EditorState.readOnly.of(readOnly)],
    });
    const replaceDocumentUndoable = vi.fn();
    useStore.setState({ viewMode: 'source' });
    sourceEditorHandle.current = {
      getValue: () => state.sliceDoc(),
      getDocText: () => state.doc.toString(),
      getEditorState: () => state,
      setEditorState: () => undefined,
      setValue: () => undefined,
      focus: () => undefined,
      getSelection: () => ({ from: 0, to: 0 }),
      showFindScope: () => undefined,
      showFindMatches: () => undefined,
      getSelectedText: () => '',
      setSelection: () => undefined,
      getScrollTop: () => 0,
      setScrollTop: () => undefined,
      replaceRange: () => undefined,
      replaceRangeQuiet: () => undefined,
      replaceTextMatches: () => 0,
      notifyChange: () => undefined,
      undo: () => undefined,
      redo: () => undefined,
      deleteLine: () => undefined,
      replaceDocumentUndoable,
      applyReviewChunks: () => undefined,
      getReviewChunks: () => [],
      acceptAllReviewChunks: () => undefined,
      rejectAllReviewChunks: () => undefined,
    };
    return replaceDocumentUndoable;
  }

  it('安全的顶层章节移动写回正确正文', () => {
    const replace = prepare('# A\n\na\n\n# B\n\nb');
    expect(canDropOutlineSection(1, { kind: 'before', index: 0 })).toBe(true);
    expect(moveOutlineSection(1, { kind: 'before', index: 0 })).toBe(true);
    expect(replace).toHaveBeenCalledWith('# B\n\nb\n\n# A\n\na');
  });

  it('不允许拆开列表中的相邻章节', () => {
    const replace = prepare('# X\n\n- # A\n\n  # B\n\n# C');
    expect(canDropOutlineSection(1, { kind: 'before', index: 0 })).toBe(false);
    expect(moveOutlineSection(1, { kind: 'before', index: 0 })).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('拒绝让未移动的缩进标题进入列表', () => {
    const replace = prepare('  # A\n\na\n\n# B\n\n- item');
    expect(canDropOutlineSection(1, { kind: 'before', index: 0 })).toBe(false);
    expect(moveOutlineSection(1, { kind: 'before', index: 0 })).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('缩进标题归属不变时仍允许移动', () => {
    const replace = prepare('  # A\n\na\n\n# B\n\nb');
    expect(moveOutlineSection(1, { kind: 'before', index: 0 })).toBe(true);
    expect(replace).toHaveBeenCalledWith('# B\n\nb\n\n  # A\n\na');
  });

  it('未闭合的缩进围栏阻止写回', () => {
    const replace = prepare('# A\n\na\n\n# B\n\n  ```js\ncode');
    expect(canMoveOutlineSection()).toBe(false);
    expect(moveOutlineSection(1, { kind: 'before', index: 0 })).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    ['HTML 注释', '<!-- comment'],
    ['脚本块', '<script>\nconst x = 1;'],
    ['样式块', '<style>\n.x { color: red; }'],
  ])('未闭合的%s不能吞掉其他章节', (_name, block) => {
    const replace = prepare(`# A\n\na\n\n# B\n\n${block}`);
    expect(canDropOutlineSection(1, { kind: 'before', index: 0 })).toBe(false);
    expect(moveOutlineSection(1, { kind: 'before', index: 0 })).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('闭合的 HTML 注释不妨碍安全移动', () => {
    const replace = prepare('# A\n\na\n\n# B\n\n<!-- comment -->');
    expect(canDropOutlineSection(1, { kind: 'before', index: 0 })).toBe(true);
    expect(moveOutlineSection(1, { kind: 'before', index: 0 })).toBe(true);
    expect(replace).toHaveBeenCalledWith('# B\n\n<!-- comment -->\n\n# A\n\na');
  });

  it('向后移动父章节时保留其子标题的顺序和内容', () => {
    const replace = prepare('# A\n\n## A1\n\nbody\n\n# B\n\nb');
    expect(moveOutlineSection(0, { kind: 'after', index: 2 })).toBe(true);
    expect(replace).toHaveBeenCalledWith('# B\n\nb\n\n# A\n\n## A1\n\nbody');
  });

  it('审阅只读状态禁止拖动与写回', () => {
    const replace = prepare('# A\n\n# B', true);
    expect(canMoveOutlineSection()).toBe(false);
    expect(moveOutlineSection(1, { kind: 'before', index: 0 })).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('拒绝改变链接定义顺序，避免未移动章节的链接指向改变', () => {
    const replace = prepare('# A\n\n[x]: /first\n\n# B\n\n[x]: /second\n\n# C\n\n[read][x]');
    expect(canDropOutlineSection(1, { kind: 'before', index: 0 })).toBe(false);
    expect(moveOutlineSection(1, { kind: 'before', index: 0 })).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('未改变链接定义顺序时仍可移动其他章节', () => {
    const replace = prepare('# A\n\n[x]: /first\n\n# B\n\nbody\n\n# C\n\n[read][x]');
    expect(moveOutlineSection(1, { kind: 'before', index: 0 })).toBe(true);
    expect(replace).toHaveBeenCalledOnce();
  });
});
