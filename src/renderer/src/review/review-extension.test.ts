// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  buildAcceptChange,
  createReviewExtension,
  reviewActionAnchor,
  resolveReviewChunk,
  reviewChunksField,
  setReviewChunks,
  type ReviewChunk,
} from './review-extension';
import { anchorReviewChunks, computeReviewChunks } from './review-diff';

function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: createReviewExtension({}) });
}

function injectChunks(state: EditorState, base: string, disk: string): EditorState {
  const chunks = anchorReviewChunks(computeReviewChunks(base, disk), base, state.doc.toString());
  return state.update({ effects: setReviewChunks.of(chunks) }).state;
}

describe('reviewChunksField', () => {
  it('set 效果整体替换未决块', () => {
    let state = makeState('旧的内容');
    state = injectChunks(state, '旧的内容', '新的内容');
    expect(state.field(reviewChunksField).chunks).toHaveLength(1);

    state = state.update({ effects: setReviewChunks.of([]) }).state;
    expect(state.field(reviewChunksField).chunks).toHaveLength(0);
  });

  it('有待决块时编辑器锁定：普通修改被拒绝，块与文档保持不变', () => {
    const base = 'AAAA\n被替换的行\nBBBB';
    let state = injectChunks(makeState(base), base, 'AAAA\n外部内容\nBBBB');
    expect(state.field(reviewChunksField).chunks).toHaveLength(1);
    expect(state.facet(EditorView.editable)).toBe(false);
    expect(state.readOnly).toBe(true);

    // 键入类修改（input.* userEvent）被 changeFilter 拒绝，文档与块保持不变。
    state = state.update({
      changes: { from: 0, to: 0, insert: '字' },
      userEvent: 'input.type',
    }).state;
    expect(state.doc.toString()).toBe(base);
    expect(state.field(reviewChunksField).chunks).toHaveLength(1);
  });

  it('块清零后解锁：普通修改恢复生效', () => {
    const base = 'AAAA\n被替换的行\nBBBB';
    let state = injectChunks(makeState(base), base, 'AAAA\n外部内容\nBBBB');
    const id = state.field(reviewChunksField).chunks[0].id;
    state = state.update({ effects: resolveReviewChunk.of(id) }).state;
    expect(state.facet(EditorView.editable)).toBe(true);
    expect(state.readOnly).toBe(false);

    state = state.update({
      changes: { from: 0, to: 0, insert: '字' },
      userEvent: 'input.type',
    }).state;
    expect(state.doc.toString()).toBe(`字${base}`);
  });

  it('审阅命令的修改在锁定下放行，后续块锚点随文本平移', () => {
    const base = 'AAAA\n第一块\nBBBB\n第二块\nCCCC';
    const disk = '外部头\n第一块\nBBBB\n外部二\nCCCC';
    let state = injectChunks(makeState(base), base, disk);
    expect(state.field(reviewChunksField).chunks).toHaveLength(2);

    const first = state.field(reviewChunksField).chunks[0];
    state = state.update({
      changes: buildAcceptChange(first)!,
      effects: resolveReviewChunk.of(first.id),
      userEvent: 'review.accept',
    }).state;
    expect(state.doc.toString()).toBe('外部头\n第一块\nBBBB\n第二块\nCCCC');
    const remaining = state.field(reviewChunksField).chunks;
    expect(remaining).toHaveLength(1);
    expect(state.doc.toString().startsWith('第二块', remaining[0].anchor)).toBe(true);
  });

  it('相邻改动块之间的长未变化区间生成折叠', () => {
    const gap = Array.from({ length: 20 }, (_, i) => `第${i}行`).join('\n');
    const base = `改动一\n${gap}\n改动二`;
    const disk = `外部一\n${gap}\n外部二`;
    const state = injectChunks(makeState(base), base, disk);
    const folds = state.field(reviewChunksField).folds;
    expect(folds).toHaveLength(1);
    expect(folds[0].collapsedLines).toBeGreaterThanOrEqual(12);
  });

  it('未变化区间不足时不折叠', () => {
    const base = '改动一\n只隔三行\n再来一行\n最后一行\n改动二';
    const disk = '外部一\n只隔三行\n再来一行\n最后一行\n外部二';
    const state = injectChunks(makeState(base), base, disk);
    expect(state.field(reviewChunksField).folds).toHaveLength(0);
  });

  it('删除空行时可以生成审阅装饰，不创建零长度 mark', () => {
    const base = '前文\n\n后文';
    expect(() => injectChunks(makeState(base), base, '前文\n后文')).not.toThrow();
  });

  it('纯删除块的操作按钮落在删除内容的可见末尾，而不是下一行开头', () => {
    const base = '前文\n删除我\n后文';
    const chunk = anchorReviewChunks(computeReviewChunks(base, '前文\n后文'), base, base)[0];

    expect(chunk.removedText.endsWith('\n')).toBe(true);
    expect(reviewActionAnchor(chunk)).toBe(chunk.anchor + chunk.removedText.length - 1);
  });

  it('待决块清空后折叠一并清空（退出审阅后全文不得被折叠）', () => {
    const gap = Array.from({ length: 20 }, (_, i) => `第${i}行`).join('\n');
    const base = `改动一\n${gap}\n改动二`;
    const disk = `外部一\n${gap}\n外部二`;
    let state = injectChunks(makeState(base), base, disk);
    expect(state.field(reviewChunksField).folds).toHaveLength(1);

    // 退出审阅的注入路径：set 空数组整体替换。
    state = state.update({ effects: setReviewChunks.of([]) }).state;
    expect(state.field(reviewChunksField).chunks).toHaveLength(0);
    expect(state.field(reviewChunksField).folds).toHaveLength(0);
  });

  it('逐个解决全部待决块后折叠同样清空', () => {
    const gap = Array.from({ length: 20 }, (_, i) => `第${i}行`).join('\n');
    const base = `改动一\n${gap}\n改动二`;
    const disk = `外部一\n${gap}\n外部二`;
    let state = injectChunks(makeState(base), base, disk);
    expect(state.field(reviewChunksField).folds).toHaveLength(1);

    for (const chunk of state.field(reviewChunksField).chunks) {
      state = state.update({ effects: resolveReviewChunk.of(chunk.id) }).state;
    }
    expect(state.field(reviewChunksField).chunks).toHaveLength(0);
    expect(state.field(reviewChunksField).folds).toHaveLength(0);
  });
});

describe('折叠与新增 widget 的渲染', () => {
  // 回归：CodeMirror 的块替换装饰不渲染落在其区间起点的 point widget。
  // 折叠若从承载新增 widget 的行开始，绿色新增与操作按钮会整体消失。
  function renderInsert(
    base: string,
    disk: string,
  ): {
    view: EditorView;
    state: EditorState;
  } {
    const state = injectChunks(makeState(base), base, disk);
    const view = new EditorView({ state, parent: document.body });
    return { view, state };
  }

  it('替换块后方的折叠避开 widget 行，绿色新增默认可见', () => {
    const gap = Array.from({ length: 20 }, (_, i) => `第${i}行`).join('\n');
    const base = `开头\n旧中部行\n${gap}\n结尾`;
    const { view, state } = renderInsert(base, `开头\n新中部行\n${gap}\n结尾`);
    try {
      expect(view.dom.querySelector('.review-insert')).not.toBeNull();
      const folds = state.field(reviewChunksField).folds;
      expect(folds).toHaveLength(1);
      const chunk = state.field(reviewChunksField).chunks[0];
      const widgetLine = state.doc.lineAt(chunk.anchor + chunk.removedText.length);
      expect(folds[0].fromLine).toBeGreaterThan(widgetLine.number);
    } finally {
      view.destroy();
    }
  });

  it('纯新增块后方的折叠同样避开插入点行', () => {
    const gap = Array.from({ length: 20 }, (_, i) => `第${i}行`).join('\n');
    const base = `开头\n${gap}\n结尾`;
    const { view, state } = renderInsert(base, `开头\n新插入行\n${gap}\n结尾`);
    try {
      expect(view.dom.querySelector('.review-insert')).not.toBeNull();
      const folds = state.field(reviewChunksField).folds;
      expect(folds).toHaveLength(1);
      const chunk = state.field(reviewChunksField).chunks[0];
      expect(folds[0].fromLine).toBeGreaterThan(state.doc.lineAt(chunk.anchor).number);
    } finally {
      view.destroy();
    }
  });
});

describe('buildAcceptChange 与块决定', () => {
  const base = '前文\n替换我\n后文';

  function singleChunk(disk: string, doc: string): ReviewChunk {
    return anchorReviewChunks(computeReviewChunks(base, disk), base, doc)[0];
  }

  it('替换块接受后旧文本换为新文本', () => {
    const chunk = singleChunk('前文\n外部\n后文', base);
    const change = buildAcceptChange(chunk)!;
    const state = EditorState.create({ doc: base }).update({ changes: change }).state;
    expect(state.doc.toString()).toBe('前文\n外部\n后文');
  });

  it('纯删除块接受后旧文本移除', () => {
    const chunk = singleChunk('前文\n后文', base);
    const change = buildAcceptChange(chunk)!;
    const state = EditorState.create({ doc: base }).update({ changes: change }).state;
    expect(state.doc.toString()).toBe('前文\n后文');
  });

  it('纯新增块接受后插入新文本，拒绝则文档不动', () => {
    const chunk = singleChunk('前文\n插入我\n后文', base);
    const change = buildAcceptChange(chunk)!;
    const accepted = EditorState.create({ doc: base }).update({ changes: change }).state;
    expect(accepted.doc.toString()).toBe('前文\n插入我\n后文');

    const rejected = EditorState.create({ doc: base });
    expect(rejected.doc.toString()).toBe(base);
  });

  it('接受与拒绝都同时移除待决块', () => {
    let state = injectChunks(makeState(base), base, '前文\n外部\n后文');
    const id = state.field(reviewChunksField).chunks[0].id;
    const change = buildAcceptChange(state.field(reviewChunksField).chunks[0])!;
    state = state.update({
      changes: change,
      effects: resolveReviewChunk.of(id),
      userEvent: 'review.accept',
    }).state;
    expect(state.doc.toString()).toBe('前文\n外部\n后文');
    expect(state.field(reviewChunksField).chunks).toHaveLength(0);
  });
});
