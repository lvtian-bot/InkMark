// 外部改动审阅的运行时编排：磁盘快照、待注入队列与入库/注入流程。
// 「磁盘快照」是每个标签页最近一次确认过的磁盘内容，作为外部增量 diff
// 的基线（脏标签的用户编辑不在磁盘上，无法从磁盘重读，只能留存在内存）。
import { useStore } from '../stores/useStore';
import { sourceEditorHandle } from '../source-editor-ref';
import { editorStateCache } from '../editor-state-cache';
import { getReviewChunks } from './review-extension';
import {
  anchorReviewChunks,
  computeReviewChunks,
  verifyAnchoredChunks,
  type AnchoredReviewChunk,
} from './review-diff';

interface DiskSnapshot {
  content: string;
  mtime: number;
}

const diskSnapshots = new Map<string, DiskSnapshot>();
// 暂无 CodeMirror 状态可注入的标签页（后台标签、源码模式尚未挂载）的待决块，
// 待该标签成为活动标签且处于源码模式时由 drainQueuedReviewChunks 注入。
const queuedChunks = new Map<string, AnchoredReviewChunk[]>();

function renumberChunks(chunks: AnchoredReviewChunk[]): AnchoredReviewChunk[] {
  return chunks
    .sort((a, b) => a.anchor - b.anchor)
    .map((chunk, index) => ({ ...chunk, id: index + 1 }));
}

function chunksOverlap(a: AnchoredReviewChunk, b: AnchoredReviewChunk): boolean {
  const aEnd = a.anchor + Math.max(a.removedText.length, 1);
  const bEnd = b.anchor + Math.max(b.removedText.length, 1);
  return a.anchor < bEnd && b.anchor < aEnd;
}

function currentReviewChunks(tabId: string, sourceContent: string): AnchoredReviewChunk[] {
  const state = useStore.getState();
  const handle = sourceEditorHandle.current;
  if (
    state.activeTabId === tabId &&
    state.viewMode === 'source' &&
    handle?.getValue() === sourceContent
  ) {
    return handle.getReviewChunks();
  }
  const queued = queuedChunks.get(tabId);
  if (queued) return queued;
  const cachedState = editorStateCache.restore(tabId, 'source', sourceContent);
  if (cachedState) return getReviewChunks(cachedState);
  return [];
}

export function setDiskSnapshot(tabId: string, content: string, mtime: number): void {
  diskSnapshots.set(tabId, { content, mtime });
}

export function getDiskSnapshot(tabId: string): DiskSnapshot | undefined {
  return diskSnapshots.get(tabId);
}

/** 关闭标签时清理审阅状态（块本体随编辑器状态缓存一起销毁）。 */
export function clearReviewForTab(tabId: string): void {
  diskSnapshots.delete(tabId);
  queuedChunks.delete(tabId);
}

/**
 * 外部改动入库：diff(磁盘快照, 磁盘最新版) 得到外部增量，锚定到当前
 * buffer 后进入审阅。已决块早已物化进 buffer，天然保留；新的非重叠块
 * 追加到现有未决块，重叠区域则从当前 buffer 到最新磁盘态重新计算。
 * 同时把 fileMtime 前推到磁盘版（保存冲突检测以此为已知版本）。
 */
export function ingestReviewChunks(tabId: string, diskContent: string, diskMtime: number): void {
  const state = useStore.getState();
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const base = diskSnapshots.get(tabId)?.content ?? tab.sourceContent;
  const deltaChunks = computeReviewChunks(base, diskContent);
  const existing = currentReviewChunks(tabId, tab.sourceContent);

  // 同一磁盘版本可能因双击入口或重复文件事件再次到达。空增量不能清空
  // 已经在审的块，更不能制造 reviewSession=true / pendingReviewCount=0。
  if (deltaChunks.length === 0) {
    diskSnapshots.set(tabId, { content: diskContent, mtime: diskMtime });
    useStore.getState().updateTab(tabId, {
      fileMtime: diskMtime,
      externalUpdatePending: false,
      ...(tab.pendingReviewCount === 0 ? { reviewSession: false } : {}),
    });
    return;
  }

  const incremental = anchorReviewChunks(deltaChunks, base, tab.sourceContent);
  const overlapsExisting = incremental.some((next) =>
    existing.some((current) => chunksOverlap(current, next)),
  );
  let anchored: AnchoredReviewChunk[];
  if (incremental.length !== deltaChunks.length || overlapsExisting) {
    // AI 再次改写了尚未决定的区域。此时上一磁盘版中的旧侧文本已不在
    // 当前 buffer，不能把块当成“已处理”丢弃；改为直接展示当前正文到
    // 最新磁盘版的差异，确保没有外部内容被静默吞掉。
    anchored = anchorReviewChunks(
      computeReviewChunks(tab.sourceContent, diskContent),
      tab.sourceContent,
      tab.sourceContent,
    );
  } else {
    anchored = renumberChunks([...existing, ...incremental]);
  }
  diskSnapshots.set(tabId, { content: diskContent, mtime: diskMtime });
  if (anchored.length === 0) {
    queuedChunks.delete(tabId);
    editorStateCache.disposeMode(tabId, 'source');
    useStore.getState().updateTab(tabId, {
      fileMtime: diskMtime,
      externalUpdatePending: false,
      pendingReviewCount: 0,
      reviewSession: false,
      isDirty: false,
    });
    if (
      useStore.getState().activeTabId === tabId &&
      useStore.getState().viewMode === 'source' &&
      sourceEditorHandle.current?.getValue() === tab.sourceContent
    ) {
      sourceEditorHandle.current.applyReviewChunks([]);
    }
    return;
  }
  useStore.getState().updateTab(tabId, {
    fileMtime: diskMtime,
    externalUpdatePending: false,
    pendingReviewCount: anchored.length,
    // 外部内容与快照一致（如文件被 touch 或改动被外部撤销）时，
    // 没有可审阅的内容，不空开审阅会话。
    ...(anchored.length > 0 ? { reviewSession: true } : {}),
  });

  if (!tryInjectChunks(tabId, anchored)) {
    queuedChunks.set(tabId, anchored);
  }
}

/** 尝试把块注入当前活动的源码编辑器；返回是否注入成功。 */
function tryInjectChunks(tabId: string, chunks: AnchoredReviewChunk[]): boolean {
  const state = useStore.getState();
  if (state.activeTabId !== tabId || state.viewMode !== 'source') return false;
  const handle = sourceEditorHandle.current;
  if (!handle) return false;
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab || handle.getValue() !== tab.sourceContent) return false;
  // 注入前再校验一次锚点（模式/标签切换竞态下 buffer 可能已变化）。
  const verified = verifyAnchoredChunks(chunks, handle.getValue());
  handle.applyReviewChunks(verified);
  if (verified.length !== chunks.length) {
    useStore.getState().updateTab(tabId, { pendingReviewCount: verified.length });
  }
  return true;
}

/**
 * 退出审阅：未决块按拒绝处理（文档保持现状），会话结束，
 * 之后的外部改动回到提示条/冲突弹窗让用户重新选择。
 */
export function exitReview(tabId: string): void {
  queuedChunks.delete(tabId);
  const state = useStore.getState();
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (state.activeTabId === tabId && state.viewMode === 'source') {
    const handle = sourceEditorHandle.current;
    if (handle) handle.rejectAllReviewChunks();
  }
  useStore.getState().updateTab(tabId, { reviewSession: false, pendingReviewCount: 0 });
  const nextState = useStore.getState();
  if (nextState.activeTabId === tabId && nextState.viewMode === 'source') {
    nextState.setViewMode('wysiwyg');
  }
}

/** 最后一块已逐项处理：只结束会话，不再改动编辑器中的审阅决定。 */
export function completeReview(tabId: string): void {
  queuedChunks.delete(tabId);
  useStore.getState().updateTab(tabId, { reviewSession: false, pendingReviewCount: 0 });
  const nextState = useStore.getState();
  if (nextState.activeTabId === tabId && nextState.viewMode === 'source') {
    nextState.setViewMode('wysiwyg');
  }
}

/**
 * 排空某标签的待注入块：该标签成为活动标签且源码编辑器就绪后调用。
 * 注入的是已经合并过旧块与最新增量的完整待审集合（set 语义）。
 */
export function drainQueuedReviewChunks(tabId: string): void {
  const queued = queuedChunks.get(tabId);
  if (!queued || queued.length === 0) return;
  const state = useStore.getState();
  if (state.activeTabId !== tabId || state.viewMode !== 'source') return;
  const handle = sourceEditorHandle.current;
  if (!handle) return;
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab || handle.getValue() !== tab.sourceContent) return;
  const verified = verifyAnchoredChunks(queued, handle.getValue());
  queuedChunks.delete(tabId);
  handle.applyReviewChunks(verified);
  useStore.getState().updateTab(tabId, { pendingReviewCount: verified.length });
}
