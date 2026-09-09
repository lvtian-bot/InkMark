// CodeMirror 6 的外部改动审阅扩展（change-review.md 审阅模式的源码模式实现）。
// 核心不变量：文档内容永远是「已接受投影」——buffer 就是 sourceContent，
// 未决改动只以装饰层存在：删除侧旧文本用红色划线 mark 标在真实文本上，
// 新增侧文本用 widget 画在插入点，不进入文档，保存路径无需感知审阅。
import {
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type Range,
  type Text,
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { t } from '../i18n';
import type { AnchoredReviewChunk } from './review-diff';

export type ReviewChunk = AnchoredReviewChunk;

export const setReviewChunks = StateEffect.define<ReviewChunk[]>();
export const resolveReviewChunk = StateEffect.define<number>();
const unfoldReviewFold = StateEffect.define<number>();

// 相邻改动块之间未变化行数达到该值才折叠。
const FOLD_MIN_GAP_LINES = 12;

interface ReviewFold {
  fromLine: number;
  toLine: number;
  collapsedLines: number;
}

interface ReviewFieldState {
  chunks: ReviewChunk[];
  folds: ReviewFold[];
  /** 已手动展开过的折叠区（按起始行号记忆），重算时不再次折叠。 */
  dismissedFoldLines: number[];
}

function computeFolds(
  chunks: ReviewChunk[],
  doc: Text,
  dismissed: number[],
  selectionRanges: readonly { from: number; to: number }[] | null,
): ReviewFold[] {
  // 无待决块时不存在「改动之间」的未变化区域，全文不得折叠：
  // 否则退出审阅或全部处理后，整篇文档会被折叠成一个占位条。
  if (chunks.length === 0) return [];
  const sorted = [...chunks].sort((a, b) => a.anchor - b.anchor);
  // 新增侧 widget 画在块尾（替换块删除文本之后、纯新增块的插入点），恰为
  // 后方未变化区间首行的行首。CodeMirror 的块替换装饰不渲染落在其区间
  // 起点的 point widget，折叠若从该行开始，绿色新增与操作按钮会整体
  // 消失，因此承载 widget 的行必须保持可见。
  const insertWidgetPositions = new Set(
    sorted.filter((c) => c.insertedText.length > 0).map((c) => c.anchor + c.removedText.length),
  );
  const folds: ReviewFold[] = [];
  let prevEnd = 0;
  const consider = (gapStart: number, gapEnd: number): void => {
    if (gapEnd <= gapStart) return;
    const startLine = doc.lineAt(gapStart);
    let from = startLine.from >= gapStart ? startLine.number : startLine.number + 1;
    const endLine = doc.lineAt(gapEnd);
    const to = endLine.to <= gapEnd ? endLine.number : endLine.number - 1;
    if (to < from) return;
    // 折叠起点行承载上一块的新增 widget 时，该行保持可见，从下一行起折叠。
    if (insertWidgetPositions.has(doc.line(from).from)) {
      from += 1;
      if (to < from) return;
    }
    if (to - from + 1 < FOLD_MIN_GAP_LINES) return;
    if (dismissed.includes(from)) return;
    const fromPos = doc.line(from).from;
    const toPos = doc.line(to).to;
    // 光标已在折叠区内时不折叠，用户编辑到附近相当于自动展开。
    if (selectionRanges && selectionRanges.some((r) => r.from < toPos && r.to > fromPos)) {
      return;
    }
    folds.push({ fromLine: from, toLine: to, collapsedLines: to - from + 1 });
  };
  for (const chunk of sorted) {
    consider(prevEnd, chunk.anchor);
    prevEnd = chunk.anchor + chunk.removedText.length;
  }
  if (doc.lines > 0) consider(prevEnd, doc.line(doc.lines).to);
  return folds;
}

export const reviewChunksField = StateField.define<ReviewFieldState>({
  create: () => ({ chunks: [], folds: [], dismissedFoldLines: [] }),
  update(value, tr) {
    const setEffect = tr.effects.find((e) => e.is(setReviewChunks));
    if (setEffect) {
      // 重新入库：未决块整体替换（已决块早已物化进 buffer，天然保留）。
      return {
        chunks: setEffect.value,
        folds: computeFolds(setEffect.value, tr.state.doc, [], null),
        dismissedFoldLines: [],
      };
    }

    const resolvedIds = tr.effects
      .filter((e) => e.is(resolveReviewChunk))
      .map((e) => e.value as number);
    const unfoldLine = tr.effects.find((e) => e.is(unfoldReviewFold));
    let chunks = value.chunks;
    let dismissed = value.dismissedFoldLines;
    if (unfoldLine) {
      dismissed = [...dismissed, unfoldLine.value as number];
    }
    if (resolvedIds.length > 0) {
      const ids = new Set(resolvedIds);
      chunks = chunks.filter((c) => !ids.has(c.id));
    }
    if (tr.docChanged) {
      // 锁定编辑后文档修改只可能来自审阅命令（reviewChangeFilter 挡住其他
      // 一切来源），接受物化的文本会移动后续块的锚点，平移即可。
      chunks = chunks.map((c) => ({ ...c, anchor: tr.changes.mapPos(c.anchor) }));
    }
    if (chunks === value.chunks && dismissed === value.dismissedFoldLines && !tr.docChanged) {
      return value;
    }
    return {
      chunks,
      folds: computeFolds(chunks, tr.state.doc, dismissed, tr.state.selection.ranges),
      dismissedFoldLines: dismissed,
    };
  },
});

function findChunk(state: EditorState, id: number): ReviewChunk | undefined {
  return state.field(reviewChunksField).chunks.find((c) => c.id === id);
}

/** 接受一处改动的文档变更：把新侧文本落进文档（替换/删除旧侧或插入新文本）。 */
export function buildAcceptChange(
  chunk: ReviewChunk,
): { from: number; to: number; insert: string } | null {
  if (chunk.insertedText === chunk.removedText) return null;
  return {
    from: chunk.anchor,
    to: chunk.anchor + chunk.removedText.length,
    insert: chunk.insertedText,
  };
}

/** 接受一处改动：把新侧文本落进文档（替换/删除旧侧文本或插入新文本）。 */
export function acceptReviewChunk(view: EditorView, id: number): void {
  const chunk = findChunk(view.state, id);
  if (!chunk) return;
  const spec: Parameters<EditorView['dispatch']>[0] = {
    effects: resolveReviewChunk.of(id),
    userEvent: 'review.accept',
    // 审阅决定不进撤销历史：StateField 不参与历史回滚，
    // 混入历史会出现「文本撤销了、块状态没撤销」的错位。
    annotations: Transaction.addToHistory.of(false),
  };
  const change = buildAcceptChange(chunk);
  if (change) spec.changes = change;
  view.dispatch(spec);
}

/** 拒绝一处改动：保留 buffer 现状（旧文本本就在文档中），仅移除待决块。 */
export function rejectReviewChunk(view: EditorView, id: number): void {
  if (!findChunk(view.state, id)) return;
  view.dispatch({
    effects: resolveReviewChunk.of(id),
    userEvent: 'review.reject',
    annotations: Transaction.addToHistory.of(false),
  });
}

/** 一次性接受全部未决改动（审阅工具条「全部接受」）。 */
export function acceptAllReviewChunks(view: EditorView): void {
  const chunks = view.state.field(reviewChunksField).chunks;
  if (chunks.length === 0) return;
  const changes: { from: number; to: number; insert: string }[] = [];
  const effects: ReturnType<typeof resolveReviewChunk.of>[] = [];
  for (const chunk of chunks) {
    const change = buildAcceptChange(chunk);
    if (change) changes.push(change);
    effects.push(resolveReviewChunk.of(chunk.id));
  }
  // 同一事务的多个 change 以原文档坐标解释，需按位置排序。
  changes.sort((a, b) => a.from - b.from);
  view.dispatch({
    changes,
    effects,
    userEvent: 'review.acceptAll',
    annotations: Transaction.addToHistory.of(false),
  });
}

/** 一次性拒绝全部未决改动（审阅工具条「全部拒绝」，buffer 保持现状）。 */
export function rejectAllReviewChunks(view: EditorView): void {
  const chunks = view.state.field(reviewChunksField).chunks;
  if (chunks.length === 0) return;
  view.dispatch({
    effects: chunks.map((c) => resolveReviewChunk.of(c.id)),
    userEvent: 'review.rejectAll',
    annotations: Transaction.addToHistory.of(false),
  });
}

export function getReviewChunkCount(state: EditorState): number {
  const field = state.field(reviewChunksField, false);
  return field ? field.chunks.length : 0;
}

export function getReviewChunks(state: EditorState): ReviewChunk[] {
  const field = state.field(reviewChunksField, false);
  return field ? [...field.chunks] : [];
}

/** 纯删除块的按钮停在最后一个可见字符旁，避免越过换行落到下一行或折叠区。 */
export function reviewActionAnchor(chunk: ReviewChunk): number {
  const end = chunk.anchor + chunk.removedText.length;
  return chunk.removedText.endsWith('\n') ? end - 1 : end;
}

function chunkAcceptTitle(chunk: ReviewChunk): string {
  if (chunk.removedText && !chunk.insertedText) return t('review.acceptDelete');
  if (!chunk.removedText && chunk.insertedText) return t('review.acceptInsert');
  return t('review.acceptReplace');
}

function chunkRejectTitle(chunk: ReviewChunk): string {
  if (chunk.removedText && !chunk.insertedText) return t('review.keepOriginal');
  if (!chunk.removedText && chunk.insertedText) return t('review.rejectInsert');
  return t('review.keepOriginal');
}

function appendChunkActions(view: EditorView, chunk: ReviewChunk, host: HTMLElement): void {
  const actions = document.createElement('span');
  actions.className = 'review-actions';
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'review-btn is-accept';
  accept.textContent = '✔';
  accept.title = chunkAcceptTitle(chunk);
  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'review-btn is-reject';
  reject.textContent = '✖';
  reject.title = chunkRejectTitle(chunk);
  for (const button of [accept, reject]) {
    // 阻止 mousedown 抢走编辑器焦点/选区，click 再执行命令。
    button.addEventListener('mousedown', (e) => e.preventDefault());
  }
  accept.addEventListener('click', () => acceptReviewChunk(view, chunk.id));
  reject.addEventListener('click', () => rejectReviewChunk(view, chunk.id));
  actions.append(accept, reject);
  host.appendChild(actions);
}

/** 新增侧文本：绿色底色展示，附带接受/拒绝按钮；不进入文档内容。 */
class ReviewInsertWidget extends WidgetType {
  constructor(readonly chunk: ReviewChunk) {
    super();
  }

  eq(other: ReviewInsertWidget): boolean {
    return other.chunk.id === this.chunk.id && other.chunk.insertedText === this.chunk.insertedText;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'review-insert';
    const text = document.createElement('span');
    text.className = 'review-insert-text';
    text.textContent = this.chunk.insertedText;
    wrap.appendChild(text);
    appendChunkActions(view, this.chunk, wrap);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 纯删除块的操作按钮：旧文本已用 mark 标在文档中，这里只挂接受/拒绝。 */
class ReviewActionsWidget extends WidgetType {
  constructor(readonly chunk: ReviewChunk) {
    super();
  }

  eq(other: ReviewActionsWidget): boolean {
    return other.chunk.id === this.chunk.id;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'review-actions';
    appendChunkActions(view, this.chunk, wrap);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 未变化区域的折叠占位：点击展开。 */
class ReviewFoldWidget extends WidgetType {
  constructor(readonly fold: ReviewFold) {
    super();
  }

  eq(other: ReviewFoldWidget): boolean {
    return other.fold.fromLine === this.fold.fromLine;
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'review-fold';
    button.textContent = t('review.foldCollapsed', { count: this.fold.collapsedLines });
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => {
      view.dispatch({ effects: unfoldReviewFold.of(this.fold.fromLine) });
    });
    return button;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const reviewDecorations = EditorView.decorations.compute([reviewChunksField], (state) => {
  const { chunks, folds } = state.field(reviewChunksField);
  const ranges: Range<Decoration>[] = [];
  for (const chunk of chunks) {
    const removedLen = chunk.removedText.length;
    if (removedLen > 0) {
      // mark 不能跨行：按行拆分旧文本的红色划线。
      let pos = chunk.anchor;
      const end = chunk.anchor + removedLen;
      while (pos < end) {
        const line = state.doc.lineAt(pos);
        const to = Math.min(line.to, end);
        // 空行只有换行符，line.from === line.to；CodeMirror 禁止零长度 mark。
        // 跳过不可见的换行符标记，块操作按钮仍会在删除区末尾正常显示。
        if (to > pos) {
          ranges.push(Decoration.mark({ class: 'review-del' }).range(pos, to));
        }
        pos = to + 1;
      }
    }
    const at = chunk.insertedText ? chunk.anchor + removedLen : reviewActionAnchor(chunk);
    const widget = chunk.insertedText
      ? new ReviewInsertWidget(chunk)
      : new ReviewActionsWidget(chunk);
    ranges.push(Decoration.widget({ widget, side: 1 }).range(at));
  }
  for (const fold of folds) {
    const fromLine = state.doc.line(Math.min(fold.fromLine, state.doc.lines));
    const toLine = state.doc.line(Math.min(fold.toLine, state.doc.lines));
    if (toLine.to > fromLine.from) {
      ranges.push(
        Decoration.replace({ block: true, widget: new ReviewFoldWidget(fold) }).range(
          fromLine.from,
          toLine.to,
        ),
      );
    }
  }
  return Decoration.set(ranges, true);
});

// —— 审阅锁定编辑（change-review.md 2026-09-04 修订）——
// 有待决块时编辑器只读：editable=false 挡住打字/粘贴的浏览器输入路径，
// changeFilter 挡住按键与菜单命令的事务修改，readOnly 供命令层检查。
// 接受/拒绝自身的修改以 review.* userEvent 标记，始终放行。
const reviewEditable = EditorView.editable.compute(
  [reviewChunksField],
  (state) => state.field(reviewChunksField).chunks.length === 0,
);

const reviewReadOnly = EditorState.readOnly.compute(
  [reviewChunksField],
  (state) => state.field(reviewChunksField).chunks.length > 0,
);

const reviewChangeFilter = EditorState.changeFilter.of((tr) => {
  if (!tr.docChanged) return true;
  const field = tr.startState.field(reviewChunksField, false);
  if (!field || field.chunks.length === 0) return true;
  return (tr.annotation(Transaction.userEvent) ?? '').startsWith('review.');
});

/**
 * 组装审阅扩展。callbacks 对象由调用方持有，可随时替换 onCountChange
 * （React 每次渲染生成的新回调写进同一对象，扩展本身保持稳定）。
 */
export function createReviewExtension(callbacks: {
  onCountChange?: (count: number, content: string) => void;
}): Extension[] {
  return [
    reviewChunksField,
    reviewDecorations,
    reviewEditable,
    reviewReadOnly,
    reviewChangeFilter,
    EditorView.updateListener.of((vu) => {
      if (!callbacks.onCountChange) return;
      const prev = vu.startState.field(reviewChunksField, false);
      const next = vu.state.field(reviewChunksField, false);
      const prevCount = prev ? prev.chunks.length : 0;
      const nextCount = next ? next.chunks.length : 0;
      if (prevCount !== nextCount) {
        callbacks.onCountChange(nextCount, vu.state.doc.toString());
      }
    }),
  ];
}
