// 外部改动审阅的运行时编排：磁盘快照、待注入队列与入库/注入流程。
// 「磁盘快照」是每个标签页最近一次确认过的磁盘内容，作为外部增量 diff
// 的基线（脏标签的用户编辑不在磁盘上，无法从磁盘重读，只能留存在内存）。
import { useStore } from '../stores/useStore';
import { sourceEditorHandle } from '../source-editor-ref';
import { editorHandle } from '../editor-ref';
import { editorStateCache } from '../editor-state-cache';
import {
  anchorReviewChunks,
  computeReviewChunks,
  normalizeReviewText,
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
 * buffer 后进入审阅。每个会话固定这批改动与磁盘快照；后续外部修改
 * 只标记冲突，不能重写本轮选择或前推保存基线。
 */
export function ingestReviewChunks(tabId: string, diskContent: string, diskMtime: number): void {
  const before = useStore.getState();
  if (before.tabs.find((tab) => tab.id === tabId)?.reviewSession) {
    const snapshot = diskSnapshots.get(tabId);
    if (!snapshot || snapshot.mtime !== diskMtime || snapshot.content !== diskContent) {
      before.updateTab(tabId, { externalUpdatePending: true });
    }
    return;
  }
  // Milkdown 的变更通知有延迟；只取尚未上报的真实编辑，避免用格式化
  // 后的 Markdown 替换一份未编辑过的原文。文件读取期间的新输入也在此补齐。
  if (before.activeTabId === tabId && before.viewMode === 'wysiwyg') {
    const pending = editorHandle.current?.getPendingMarkdown();
    if (pending != null) before.updateTab(tabId, { sourceContent: pending, isDirty: true });
  }
  const state = useStore.getState();
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const content = normalizeReviewText(tab.sourceContent);
  const base = normalizeReviewText(diskSnapshots.get(tabId)?.content ?? tab.sourceContent);
  const reviewDiskContent = normalizeReviewText(diskContent);
  const deltaChunks = computeReviewChunks(base, reviewDiskContent);

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

  const incremental = anchorReviewChunks(deltaChunks, base, content);
  let anchored: AnchoredReviewChunk[];
  if (incremental.length !== deltaChunks.length) {
    // 本地编辑与外部改动重叠时，展示当前正文到固定磁盘版的全部差异。
    anchored = anchorReviewChunks(
      computeReviewChunks(content, reviewDiskContent),
      content,
      content,
    );
  } else {
    anchored = incremental;
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
    sourceContent: content,
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
  // 定位失败属于同步失败，不能把未显示的外部改动当作已处理。
  // 保留整批待决块，等待正文同步后再次注入。
  if (verified.length !== chunks.length) return false;
  handle.applyReviewChunks(verified);
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

/** 审阅结果已成功保存：结束会话，不再改动编辑器中的审阅决定。 */
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
 * 注入的是本轮固定版本的完整待审集合（set 语义）。
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
  if (verified.length !== queued.length) return;
  queuedChunks.delete(tabId);
  handle.applyReviewChunks(verified);
  useStore.getState().updateTab(tabId, { pendingReviewCount: verified.length });
}
