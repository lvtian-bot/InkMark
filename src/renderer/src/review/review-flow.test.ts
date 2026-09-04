import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { useStore } from '../stores/useStore';
import { sourceEditorHandle, type SourceEditorHandle } from '../source-editor-ref';
import { editorStateCache } from '../editor-state-cache';
import { reviewChunksField, setReviewChunks, type ReviewChunk } from './review-extension';
import {
  drainQueuedReviewChunks,
  completeReview,
  exitReview,
  ingestReviewChunks,
  setDiskSnapshot,
} from './review-store';

// 端到端数据流测试：重现「打开文件 → 外部修改 → 入库 → 注入源码编辑器」
// 全链路，验证真实 store 与伪编辑器句柄下待决块确实产生并注入。

function installFakeHandle(doc: string): {
  applied: ReviewChunk[][];
  getChunks: () => ReviewChunk[];
  setDoc: (d: string) => void;
} {
  const applied: ReviewChunk[][] = [];
  const state = { doc };
  let chunks: ReviewChunk[] = [];
  const handle = {
    getValue: () => state.doc,
    getReviewChunks: () => chunks,
    applyReviewChunks: (nextChunks: ReviewChunk[]) => {
      applied.push(nextChunks);
      chunks = nextChunks;
    },
    rejectAllReviewChunks: () => {
      applied.push([]);
      chunks = [];
    },
  };
  (sourceEditorHandle as { current: SourceEditorHandle | null }).current =
    handle as unknown as SourceEditorHandle;
  return {
    applied,
    getChunks: () => chunks,
    setDoc: (d: string) => (state.doc = d),
  };
}

describe('外部改动审阅数据流', () => {
  const initialState = {
    tabs: useStore.getState().tabs,
    activeTabId: useStore.getState().activeTabId,
    viewMode: useStore.getState().viewMode,
  };

  afterEach(() => {
    for (const tab of useStore.getState().tabs) editorStateCache.dispose(tab.id);
    useStore.setState(initialState);
    sourceEditorHandle.current = null;
  });

  it('干净标签：外部修改入库后产生待决块并注入源码编辑器', () => {
    const disk0 = '# 计划\n\n第一段正文内容。\n\n第二段正文内容。\n';
    const disk1 = disk0.replace('第一段正文内容。', '第一段被 AI 改写后的内容！');
    const { addTab, updateTab } = useStore.getState();
    const tabId = addTab({ startPage: false });
    updateTab(tabId, {
      filePath: 'D:/notes/a.md',
      sourceContent: disk0,
      fileMtime: 1,
      isDirty: false,
    });
    setDiskSnapshot(tabId, disk0, 1);
    useStore.setState({ activeTabId: tabId, viewMode: 'source' });
    const { applied } = installFakeHandle(disk0);

    ingestReviewChunks(tabId, disk1, 2);

    const tab = useStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.pendingReviewCount).toBeGreaterThan(0);
    expect(tab.fileMtime).toBe(2);
    expect(applied).toHaveLength(1);
    expect(applied[0].length).toBe(tab.pendingReviewCount);
    expect(applied[0][0].insertedText).toContain('AI 改写');
  });

  it('所见即所得入口：入库排队，切回源码后经 drain 注入', () => {
    const disk0 = '# 笔记\n\n旧的句子在这里。\n';
    const disk1 = '# 笔记\n\n全新润色的句子在这里。\n';
    const { addTab, updateTab } = useStore.getState();
    const tabId = addTab({ startPage: false });
    updateTab(tabId, {
      filePath: 'D:/notes/b.md',
      sourceContent: disk0,
      fileMtime: 1,
      isDirty: false,
    });
    setDiskSnapshot(tabId, disk0, 1);
    // 用户停留在所见即所得模式：入库应排队而不是注入。
    useStore.setState({ activeTabId: tabId, viewMode: 'wysiwyg' });
    const { applied, setDoc } = installFakeHandle(disk0);

    ingestReviewChunks(tabId, disk1, 2);
    expect(applied).toHaveLength(0);
    expect(useStore.getState().tabs.find((t) => t.id === tabId)!.pendingReviewCount).toBe(1);

    // 模拟 App 的模式切换：源码编辑器内容被同步为 sourceContent 后排空队列。
    useStore.setState({ viewMode: 'source' });
    setDoc(disk0);
    drainQueuedReviewChunks(tabId);

    expect(applied).toHaveLength(1);
    expect(applied[0]).toHaveLength(1);
    // 按行粒度：第三行整行为一个改动块。
    expect(applied[0][0].removedText).toBe('旧的句子在这里。\n');
    expect(applied[0][0].insertedText).toBe('全新润色的句子在这里。\n');
  });

  it('审阅中 AI 再次修改其他位置：已有未决块与新块一起保留', () => {
    const disk0 = 'AAAA\n第一块\nBBBB\n第二块\n结尾';
    const disk1 = 'AAAA\n外部一\nBBBB\n第二块\n结尾';
    const disk2 = 'AAAA\n外部一\nBBBB\n外部二\n结尾';
    const { addTab, updateTab } = useStore.getState();
    const tabId = addTab({ startPage: false });
    updateTab(tabId, {
      filePath: 'D:/notes/c.md',
      sourceContent: disk0,
      fileMtime: 1,
      isDirty: false,
    });
    setDiskSnapshot(tabId, disk0, 1);
    useStore.setState({ activeTabId: tabId, viewMode: 'source' });
    const { applied } = installFakeHandle(disk0);

    ingestReviewChunks(tabId, disk1, 2);
    expect(useStore.getState().tabs.find((t) => t.id === tabId)!.pendingReviewCount).toBe(1);

    ingestReviewChunks(tabId, disk2, 3);
    // D0→D1 的第一块尚未处理，D1→D2 的第二块应追加，不能静默丢失第一块。
    expect(applied).toHaveLength(2);
    expect(applied[1]).toHaveLength(2);
    expect(applied[1].map((chunk) => chunk.insertedText)).toEqual(['外部一\n', '外部二\n']);
    const tab = useStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.pendingReviewCount).toBe(2);
    expect(tab.fileMtime).toBe(3);
  });

  it('同一磁盘版本重复入库：不清空已有待决块，也不进入零块会话', () => {
    const disk0 = '原文\n';
    const disk1 = 'AI 改写\n';
    const { addTab, updateTab } = useStore.getState();
    const tabId = addTab({ startPage: false });
    updateTab(tabId, {
      filePath: 'D:/notes/repeated.md',
      sourceContent: disk0,
      fileMtime: 1,
      isDirty: false,
    });
    setDiskSnapshot(tabId, disk0, 1);
    useStore.setState({ activeTabId: tabId, viewMode: 'source' });
    const { applied, getChunks } = installFakeHandle(disk0);

    ingestReviewChunks(tabId, disk1, 2);
    ingestReviewChunks(tabId, disk1, 2);

    const tab = useStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.reviewSession).toBe(true);
    expect(tab.pendingReviewCount).toBe(1);
    expect(getChunks()).toHaveLength(1);
    expect(applied).toHaveLength(1);
  });

  it('AI 再次改写同一个未决行：更新为当前正文到最新磁盘版的待决块', () => {
    const disk0 = '原文\n';
    const disk1 = 'AI 第一次改写\n';
    const disk2 = 'AI 第二次改写\n';
    const { addTab, updateTab } = useStore.getState();
    const tabId = addTab({ startPage: false });
    updateTab(tabId, {
      filePath: 'D:/notes/rewrite.md',
      sourceContent: disk0,
      fileMtime: 1,
      isDirty: false,
    });
    setDiskSnapshot(tabId, disk0, 1);
    useStore.setState({ activeTabId: tabId, viewMode: 'source' });
    const { getChunks } = installFakeHandle(disk0);

    ingestReviewChunks(tabId, disk1, 2);
    ingestReviewChunks(tabId, disk2, 3);

    const tab = useStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.reviewSession).toBe(true);
    expect(tab.pendingReviewCount).toBe(1);
    expect(getChunks()[0].removedText).toBe(disk0);
    expect(getChunks()[0].insertedText).toBe(disk2);
  });

  it('源码编辑器仍是旧标签内容：先排队，不把会话错误清成零块', () => {
    const disk0 = '原文\n';
    const disk1 = 'AI 改写\n';
    const { addTab, updateTab } = useStore.getState();
    const tabId = addTab({ startPage: false });
    updateTab(tabId, {
      filePath: 'D:/notes/stale-editor.md',
      sourceContent: disk0,
      fileMtime: 1,
      isDirty: false,
    });
    setDiskSnapshot(tabId, disk0, 1);
    useStore.setState({ activeTabId: tabId, viewMode: 'source' });
    const { applied, setDoc } = installFakeHandle('旧标签内容\n');

    ingestReviewChunks(tabId, disk1, 2);

    let tab = useStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.reviewSession).toBe(true);
    expect(tab.pendingReviewCount).toBe(1);
    expect(applied).toHaveLength(0);

    setDoc(disk0);
    drainQueuedReviewChunks(tabId);

    tab = useStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.pendingReviewCount).toBe(1);
    expect(applied).toHaveLength(1);
  });

  it('后台标签的外部改动被撤销：清空队列并结束会话，不留下零块会话', () => {
    const disk0 = '原文\n';
    const disk1 = 'AI 改写\n';
    const { addTab, updateTab } = useStore.getState();
    const tabId = addTab({ startPage: false });
    updateTab(tabId, {
      filePath: 'D:/notes/reverted.md',
      sourceContent: disk0,
      fileMtime: 1,
      isDirty: false,
    });
    setDiskSnapshot(tabId, disk0, 1);
    useStore.setState({ activeTabId: tabId, viewMode: 'wysiwyg' });

    ingestReviewChunks(tabId, disk1, 2);
    ingestReviewChunks(tabId, disk0, 3);

    const tab = useStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.pendingReviewCount).toBe(0);
    expect(tab.reviewSession).toBe(false);
    expect(tab.isDirty).toBe(false);
  });

  it('后台标签继续收到外部改动：从编辑器缓存保留原有未决块并追加新块', () => {
    const disk0 = 'AAAA\n第一块\nBBBB\n第二块\nCCCC\n第三块\n结尾';
    const disk1 = 'AAAA\n外部一\nBBBB\n第二块\nCCCC\n第三块\n结尾';
    const disk2 = 'AAAA\n外部一\nBBBB\n外部二\nCCCC\n第三块\n结尾';
    const disk3 = 'AAAA\n外部一\nBBBB\n外部二\nCCCC\n外部三\n结尾';
    const { addTab, updateTab } = useStore.getState();
    const tabId = addTab({ startPage: false });
    updateTab(tabId, {
      filePath: 'D:/notes/background.md',
      sourceContent: disk0,
      fileMtime: 1,
      isDirty: false,
    });
    setDiskSnapshot(tabId, disk0, 1);
    useStore.setState({ activeTabId: tabId, viewMode: 'source' });
    const active = installFakeHandle(disk0);
    ingestReviewChunks(tabId, disk1, 2);

    const cachedState = EditorState.create({
      doc: disk0,
      extensions: [reviewChunksField],
    }).update({ effects: setReviewChunks.of(active.getChunks()) }).state;
    editorStateCache.capture(tabId, 'source', disk0, cachedState);
    useStore.setState({ activeTabId: initialState.activeTabId, viewMode: 'wysiwyg' });
    sourceEditorHandle.current = null;

    ingestReviewChunks(tabId, disk2, 3);
    ingestReviewChunks(tabId, disk3, 4);

    useStore.setState({ activeTabId: tabId, viewMode: 'source' });
    const background = installFakeHandle(disk0);
    drainQueuedReviewChunks(tabId);
    expect(background.getChunks().map((chunk) => chunk.insertedText)).toEqual([
      '外部一\n',
      '外部二\n',
      '外部三\n',
    ]);
  });

  it('注入的块可直接驱动 CodeMirror 状态（set 效果）', () => {
    const state = EditorState.create({ doc: 'a\n', extensions: [reviewChunksField] });
    const chunk: ReviewChunk = {
      id: 1,
      anchor: 2,
      removedText: '',
      insertedText: 'inserted',
      beforeContext: 'a\n',
      afterContext: '',
      baseOffset: 2,
    };
    const next = state.update({ effects: setReviewChunks.of([chunk]) }).state;
    expect(next.field(reviewChunksField).chunks).toHaveLength(1);
  });

  it('退出审阅：会话结束、待决清零，编辑器收到全部拒绝', () => {
    const disk0 = '# 计划\n\n第一段正文内容。\n';
    const disk1 = disk0.replace('第一段正文内容。', '第一段被 AI 改写后的内容！');
    const { addTab, updateTab } = useStore.getState();
    const tabId = addTab({ startPage: false });
    updateTab(tabId, {
      filePath: 'D:/notes/d.md',
      sourceContent: disk0,
      fileMtime: 1,
      isDirty: false,
    });
    setDiskSnapshot(tabId, disk0, 1);
    useStore.setState({ activeTabId: tabId, viewMode: 'source' });
    const { applied } = installFakeHandle(disk0);

    ingestReviewChunks(tabId, disk1, 2);
    expect(useStore.getState().tabs.find((t) => t.id === tabId)!.reviewSession).toBe(true);
    expect(useStore.getState().tabs.find((t) => t.id === tabId)!.pendingReviewCount).toBe(1);

    exitReview(tabId);

    const tab = useStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.reviewSession).toBe(false);
    expect(tab.pendingReviewCount).toBe(0);
    expect(useStore.getState().viewMode).toBe('wysiwyg');
    // 未决块按拒绝处理，文档保持现状（这里只验证编辑器收到了全部拒绝）。
    expect(applied).toHaveLength(2);
  });

  it('逐项处理完最后一块后结束会话并切回所见即所得模式', () => {
    const { addTab, updateTab } = useStore.getState();
    const tabId = addTab({ startPage: false });
    updateTab(tabId, { reviewSession: true, pendingReviewCount: 0 });
    useStore.setState({ activeTabId: tabId, viewMode: 'source' });

    completeReview(tabId);

    expect(useStore.getState().viewMode).toBe('wysiwyg');
    expect(useStore.getState().tabs.find((tab) => tab.id === tabId)!.reviewSession).toBe(false);
  });
});
