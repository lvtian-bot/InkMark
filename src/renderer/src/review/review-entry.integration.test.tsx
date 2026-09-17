// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { editorHandle, type EditorHandle } from '../editor-ref';
import { editorStateCache } from '../editor-state-cache';
import { resolveConfirmDialog } from '../confirm-dialog';
import { sourceEditorHandle } from '../source-editor-ref';
import { useStore } from '../stores/useStore';
import type { FileWatchEvent, InkMarkAPI, SaveAsResult, SaveResult } from '../types';
import { clearReviewForTab, getDiskSnapshot, setDiskSnapshot } from './review-store';

// App 的入口测试只保留与审阅链路有关的真实组件。Editor 由测试句柄提供已经验证过的
// Milkdown parse→serialize 结果：CRLF 文件经过所见即所得序列化后变为 LF，LF 文件保持 LF。
// 真实 SourceEditor、useFile、review-store 和 App 均不替换，避免只测到拼装后的假路径。
vi.mock('../components/Editor', () => ({ Editor: () => null }));
vi.mock('../components/StatusBar', () => ({ StatusBar: () => null }));
vi.mock('../components/TabBar', () => ({ TabBar: () => null }));
vi.mock('../components/Toolbar', () => ({ Toolbar: () => null }));
vi.mock('../components/Outline', () => ({ Outline: () => null }));
vi.mock('../components/FileTree', () => ({ FileTree: () => null }));
vi.mock('../components/StartPage', () => ({ StartPage: () => null }));
vi.mock('../components/ExportProgressDialog', () => ({ ExportProgressDialog: () => null }));
vi.mock('../hooks/useEditorFont', () => ({ useEditorFont: () => undefined }));
vi.mock('../hooks/useFileTree', () => ({ useFileTree: () => ({ closeRoot: () => undefined }) }));
vi.mock('../hooks/useOutline', () => ({
  useOutline: () => ({
    updateOutline: () => undefined,
    updateSourceOutline: () => undefined,
  }),
}));
vi.mock('../hooks/useWordCount', () => ({
  useWordCount: () => ({
    updateWordCount: () => undefined,
    updateSourceWordCount: () => undefined,
  }),
}));
vi.mock('../hooks/useExport', () => ({ useExport: () => ({ exportDocument: () => undefined }) }));
vi.mock('../hooks/useFindReplace', () => ({
  useFindReplace: () => ({
    close: () => undefined,
    open: () => undefined,
    notifyContentChanged: () => undefined,
    isOpen: false,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.requestIdleCallback = (callback: IdleRequestCallback): number => {
  callback({ didTimeout: false, timeRemaining: () => 50 });
  return 1;
};
window.cancelIdleCallback = () => undefined;

type SaveReviewedFile = (
  content: string,
  path: string,
  expectedContent: string,
  expectedMtime: number,
) => Promise<SaveResult>;
type SaveReviewCopy = (content: string, sourcePath: string) => Promise<SaveAsResult | null>;

interface ScenarioState {
  originalPath: string;
  disk: string;
  mtime: number;
  copyPath: string;
  copyMtime: number;
  copyDisk: string | null;
  copyResult: SaveAsResult | null;
  onWatchEvent: ((event: FileWatchEvent) => void) | null;
  onMenuSave: (() => void) | null;
  onMenuSaveAs: (() => void) | null;
  reviewedSaveGate: Promise<SaveResult> | null;
  resolveReviewedSave: ((result: SaveResult) => void) | null;
}

interface Scenario {
  base: string;
  serialized: string;
  external: string;
  state: ScenarioState;
  saveFile: ReturnType<typeof vi.fn<InkMarkAPI['saveFile']>>;
  saveReviewedFile: ReturnType<typeof vi.fn<SaveReviewedFile>>;
  saveReviewCopy: ReturnType<typeof vi.fn<SaveReviewCopy>>;
  tabId: string;
  emitWatchEvent: (event: FileWatchEvent) => void;
  invokeMenuSave: () => void;
  invokeMenuSaveAs: () => void;
}

const initialStore = useStore.getState();
const mountedRoots = new Set<Root>();

function createEditorHandle(
  markdown: () => string,
  pendingMarkdown: () => string | null = () => null,
): EditorHandle & { getPendingMarkdown: () => string | null } {
  return {
    getMarkdown: markdown,
    getPendingMarkdown: pendingMarkdown,
    getSelectedMarkdown: () => '',
    setMarkdown: () => undefined,
    skipFrontmatterIfSelected: () => undefined,
    getEditorState: () => null,
    setEditorState: () => undefined,
    getMarkdownFromState: () => markdown(),
    scrollToPos: () => undefined,
    getScrollContainer: () => null,
    getScrollTop: () => 0,
    setScrollTop: () => undefined,
    undo: () => undefined,
    redo: () => undefined,
    toggleBold: () => undefined,
    toggleItalic: () => undefined,
    toggleStrike: () => undefined,
    toggleInlineCode: () => undefined,
    wrapHeading: () => undefined,
    wrapBulletList: () => undefined,
    wrapOrderedList: () => undefined,
    wrapTaskList: () => undefined,
    insertCodeBlock: () => undefined,
    insertLink: () => undefined,
    insertTable: () => undefined,
    deleteLine: () => undefined,
    addTableLine: () => undefined,
    deleteTableLine: () => undefined,
    selectTable: () => undefined,
    copyTable: () => undefined,
    findTextMatches: () => [],
    showTextMatches: () => undefined,
    replaceTextMatch: () => false,
    replaceAllTextMatches: () => 0,
    focus: () => undefined,
  };
}

interface TestInkmarkAPI extends Partial<InkMarkAPI> {
  saveReviewedFile: SaveReviewedFile;
  saveReviewCopy: SaveReviewCopy;
}

function installInkmarkApi(
  state: ScenarioState,
): Pick<Scenario, 'saveFile' | 'saveReviewedFile' | 'saveReviewCopy'> {
  const saveFile = vi.fn<InkMarkAPI['saveFile']>(
    async (content: string, path: string, knownMtime?: number | null): Promise<SaveResult> => {
      if (path !== state.originalPath) return { status: 'conflict' };
      if (knownMtime !== state.mtime) return { status: 'conflict' };
      state.disk = content;
      state.mtime += 1;
      return { status: 'ok', mtime: state.mtime };
    },
  );
  const saveReviewedFile = vi.fn<SaveReviewedFile>(
    async (
      content: string,
      path: string,
      expectedContent: string,
      expectedMtime: number,
    ): Promise<SaveResult> => {
      if (
        path !== state.originalPath ||
        state.disk !== expectedContent ||
        state.mtime !== expectedMtime
      ) {
        return { status: 'conflict' };
      }
      if (state.reviewedSaveGate) {
        const result = await state.reviewedSaveGate;
        state.reviewedSaveGate = null;
        state.resolveReviewedSave = null;
        return result;
      }
      state.disk = content;
      state.mtime += 1;
      return { status: 'ok', mtime: state.mtime };
    },
  );
  const saveReviewCopy = vi.fn<SaveReviewCopy>(
    async (content: string, sourcePath: string): Promise<SaveAsResult | null> => {
      if (sourcePath !== state.originalPath || !state.copyResult) return null;
      state.copyDisk = content;
      return state.copyResult;
    },
  );
  const target: TestInkmarkAPI = {
    platform: 'win32',
    saveFile,
    saveReviewedFile,
    saveReviewCopy,
    openFilePath: vi.fn<InkMarkAPI['openFilePath']>(async (path: string) => ({
      path,
      content: path === state.copyPath && state.copyDisk !== null ? state.copyDisk : state.disk,
      mtime: path === state.copyPath && state.copyDisk !== null ? state.copyMtime : state.mtime,
    })),
    getFileMtime: vi.fn<InkMarkAPI['getFileMtime']>(async () => ({
      status: 'ok',
      mtime: state.mtime,
    })),
    onFileWatchEvent: (callback: (event: FileWatchEvent) => void) => {
      state.onWatchEvent = callback;
      return () => {
        if (state.onWatchEvent === callback) state.onWatchEvent = null;
      };
    },
    onMenuSave: (callback: () => void) => {
      state.onMenuSave = callback;
    },
    onMenuSaveAs: (callback: () => void) => {
      state.onMenuSaveAs = callback;
    },
  };
  const api = new Proxy(target, {
    get(object, property: string | symbol) {
      if (property in object) return object[property as keyof typeof object];
      return () => undefined;
    },
  });
  window.inkmark = api as unknown as InkMarkAPI;
  return { saveFile, saveReviewedFile, saveReviewCopy };
}

async function settleReact(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (condition()) return;
    await settleReact();
  }
  throw new Error(message);
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent === text,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`未找到按钮：${text}`);
  }
  return button;
}

async function mountScenario(
  base: string,
  serialized: string,
  external: string,
  pendingMarkdown: string | null = null,
  autoSave = false,
): Promise<{ host: HTMLDivElement; root: Root; scenario: Scenario }> {
  const state: ScenarioState = {
    originalPath: 'D:/probe.md',
    disk: external,
    mtime: 2,
    copyPath: 'D:/probe-copy.md',
    copyMtime: 4,
    copyDisk: null,
    copyResult: { path: 'D:/probe-copy.md', mtime: 4 },
    onWatchEvent: null,
    onMenuSave: null,
    onMenuSaveAs: null,
    reviewedSaveGate: null,
    resolveReviewedSave: null,
  };
  const values = {
    base,
    serialized,
    external,
    state,
  };
  const { saveFile, saveReviewedFile, saveReviewCopy } = installInkmarkApi(state);
  useStore.setState({
    autoSave,
    language: 'zh-CN',
    viewMode: 'wysiwyg',
    toolbarVisible: false,
    outlineVisible: false,
    fileTreeVisible: false,
  });
  const tabId = useStore.getState().addTab({
    filePath: 'D:/probe.md',
    content: base,
    fileMtime: 1,
    startPage: false,
  });
  useStore.getState().updateTab(tabId, { externalUpdatePending: true });
  setDiskSnapshot(tabId, base, 1);

  let wysiwygMarkdown = serialized;
  editorHandle.current = createEditorHandle(
    () => wysiwygMarkdown,
    () => pendingMarkdown,
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.add(root);
  await act(async () => {
    root.render(React.createElement(App));
  });
  // 确保 lazy SourceEditor 已解析并实际挂载，测试覆盖真实 CodeMirror 句柄。
  await act(async () => {
    await import('../components/SourceEditor');
  });
  await waitFor(() => sourceEditorHandle.current !== null, '源码编辑器未挂载');
  // 防止测试句柄被 React 的 setMarkdown 逻辑误认为是用户编辑；这里只需要暴露稳定序列化值。
  wysiwygMarkdown = serialized;
  return {
    host,
    root,
    scenario: {
      ...values,
      saveFile,
      saveReviewedFile,
      saveReviewCopy,
      tabId,
      emitWatchEvent: (event) => state.onWatchEvent?.(event),
      invokeMenuSave: () => state.onMenuSave?.(),
      invokeMenuSaveAs: () => state.onMenuSaveAs?.(),
    },
  };
}

async function enterReview(host: HTMLElement, tabId: string): Promise<void> {
  await act(async () => buttonByText(host, '逐项审阅').click());
  await waitFor(
    () =>
      (useStore.getState().tabs.find((tab) => tab.id === tabId)?.pendingReviewCount ?? 0) > 0 &&
      (sourceEditorHandle.current?.getReviewChunks().length ?? 0) > 0,
    '逐项审阅后未保留待审块',
  );
}

afterEach(async () => {
  // 先销毁真实 CodeMirror，再清理审阅快照和所有本测试新增标签，避免跨 case 残留。
  for (const root of mountedRoots) {
    await act(async () => root.unmount());
  }
  mountedRoots.clear();
  sourceEditorHandle.current = null;
  editorHandle.current = null;
  for (const tab of useStore.getState().tabs) {
    clearReviewForTab(tab.id);
    editorStateCache.dispose(tab.id);
  }
  document.body.replaceChildren();
  useStore.setState(initialStore);
  resolveConfirmDialog(1);
});

describe('外部修改审阅入口', () => {
  it.each([
    ['CRLF', '原正文\r\n', '原正文\n', '外部新正文\r\n'],
    ['LF', '原正文\n', '原正文\n', '外部新正文\n'],
  ])('进入逐项审阅后不应因序列化差异写盘：%s', async (_label, base, serialized, external) => {
    const { host, root, scenario } = await mountScenario(base, serialized, external);
    try {
      await enterReview(host, scenario.tabId);

      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(scenario.state.disk).toBe(scenario.external);
      expect(sourceEditorHandle.current?.getReviewChunks()).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
      mountedRoots.delete(root);
    }
  });

  it('逐项决定后的保存确认取消时保留会话，普通保存也不能绕过专用路径', async () => {
    const { host, root, scenario } = await mountScenario('原正文\n', '原正文\n', '外部新正文\n');
    try {
      await enterReview(host, scenario.tabId);
      const action = host.querySelector('.review-btn.is-accept');
      expect(action).toBeInstanceOf(HTMLButtonElement);
      if (!(action instanceof HTMLButtonElement)) throw new Error('逐项接受按钮类型错误');
      await act(async () => action.click());
      await waitFor(
        () => host.querySelector('[role="alertdialog"]') !== null,
        '逐项决定后未弹保存确认框',
      );

      await act(async () => buttonByText(host, '取消').click());
      await waitFor(() => host.querySelector('[role="alertdialog"]') === null, '保存确认框未关闭');
      expect(scenario.saveReviewedFile).not.toHaveBeenCalled();
      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(useStore.getState().tabs.find((tab) => tab.id === scenario.tabId)).toMatchObject({
        pendingReviewCount: 0,
        reviewSession: true,
        isDirty: true,
      });
      expect(buttonByText(host, '保存审阅结果')).toBeInstanceOf(HTMLButtonElement);

      await act(async () => scenario.invokeMenuSave());
      await waitFor(
        () => host.querySelector('[role="alertdialog"]') !== null,
        '普通保存未复用审阅结果确认框',
      );
      expect(scenario.saveReviewedFile).not.toHaveBeenCalled();
      expect(scenario.saveFile).not.toHaveBeenCalled();
      await act(async () => buttonByText(host, '取消').click());
      await waitFor(() => host.querySelector('[role="alertdialog"]') === null, '重试确认框未关闭');
      expect(scenario.saveReviewedFile).not.toHaveBeenCalled();
      expect(scenario.state.disk).toBe(scenario.external);
    } finally {
      await act(async () => root.unmount());
      mountedRoots.delete(root);
    }
  });

  it('最终确认取消后开启自动保存也不能写回原文件', async () => {
    const { host, root, scenario } = await mountScenario(
      '原正文\n',
      '原正文\n',
      '外部新正文\n',
      null,
      true,
    );
    try {
      await enterReview(host, scenario.tabId);
      const action = host.querySelector('.review-btn.is-accept');
      expect(action).toBeInstanceOf(HTMLButtonElement);
      if (!(action instanceof HTMLButtonElement)) throw new Error('逐项接受按钮类型错误');
      await act(async () => action.click());
      await waitFor(
        () => host.querySelector('[role="alertdialog"]') !== null,
        '逐项决定后未弹保存确认框',
      );
      await act(async () => buttonByText(host, '取消').click());
      await waitFor(() => host.querySelector('[role="alertdialog"]') === null, '保存确认框未关闭');

      vi.useFakeTimers();
      await act(async () => sourceEditorHandle.current?.replaceRange(0, 0, '自动保存输入'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_100);
        await Promise.resolve();
      });

      expect(scenario.saveReviewedFile).not.toHaveBeenCalled();
      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(scenario.state.disk).toBe(scenario.external);
      expect(useStore.getState().tabs.find((tab) => tab.id === scenario.tabId)).toMatchObject({
        reviewSession: true,
        pendingReviewCount: 0,
        isDirty: true,
      });
      if (host.querySelector('[role="alertdialog"]')) {
        await act(async () => buttonByText(host, '取消').click());
      }
    } finally {
      vi.useRealTimers();
      await act(async () => root.unmount());
      mountedRoots.delete(root);
    }
  });

  it('进入审阅前先吸收尚未上报的所见即所得编辑，并保留该编辑作为审阅正文', async () => {
    const base = '原正文\n第二行\n';
    const userContent = '用户已改正文\n第二行\n';
    const external = '原正文\n外部第二行\n';
    const { host, root, scenario } = await mountScenario(base, userContent, external, userContent);
    try {
      await enterReview(host, scenario.tabId);
      const tab = useStore.getState().tabs.find((item) => item.id === scenario.tabId);
      const chunk = sourceEditorHandle.current?.getReviewChunks()[0];

      expect(tab).toMatchObject({ sourceContent: userContent, isDirty: true });
      expect(sourceEditorHandle.current?.getValue()).toBe(userContent);
      expect(chunk?.removedText).toBe('第二行\n');
      expect(chunk?.insertedText).toBe('外部第二行\n');
      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(scenario.state.disk).toBe(external);
    } finally {
      await act(async () => root.unmount());
      mountedRoots.delete(root);
    }
  });

  it('审阅期间外部出现新版本只提示，不合并内容也不前推审阅快照', async () => {
    const { host, root, scenario } = await mountScenario('原正文\n', '原正文\n', '外部新正文\n');
    try {
      await enterReview(host, scenario.tabId);
      const reviewedBefore = sourceEditorHandle.current?.getReviewChunks()[0];
      expect(reviewedBefore?.insertedText).toBe('外部新正文\n');

      scenario.state.disk = '后续外部版本\n';
      scenario.state.mtime = 3;
      await act(async () =>
        scenario.emitWatchEvent({
          path: scenario.state.originalPath,
          status: 'changed',
          mtime: 3,
        }),
      );
      await waitFor(
        () =>
          useStore.getState().tabs.find((tab) => tab.id === scenario.tabId)
            ?.externalUpdatePending === true,
        '审阅期间新外部版本未提示',
      );

      const tab = useStore.getState().tabs.find((item) => item.id === scenario.tabId);
      const reviewedAfter = sourceEditorHandle.current?.getReviewChunks()[0];
      expect(tab).toMatchObject({
        fileMtime: 2,
        sourceContent: '原正文\n',
        pendingReviewCount: 1,
        reviewSession: true,
      });
      expect(reviewedAfter?.insertedText).toBe('外部新正文\n');
      expect(scenario.saveReviewedFile).not.toHaveBeenCalled();
      expect(scenario.saveFile).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      mountedRoots.delete(root);
    }
  });

  it.each(['使用磁盘版本', '保留并在下次保存时覆盖'])(
    '冲突弹窗等待期间进入审阅后，旧决定“%s”不再覆盖正文或推进固定基线',
    async (staleChoice) => {
      const { host, root, scenario } = await mountScenario('原正文\n', '原正文\n', '外部新正文\n');
      try {
        const tabId = scenario.tabId;
        await act(async () =>
          useStore.getState().updateTab(tabId, {
            externalUpdatePending: false,
            isDirty: true,
          }),
        );
        scenario.state.disk = '冲突外部版本\n';
        scenario.state.mtime = 3;
        await act(async () =>
          scenario.emitWatchEvent({
            path: scenario.state.originalPath,
            status: 'changed',
            mtime: 3,
          }),
        );
        await waitFor(
          () =>
            host
              .querySelector('[role="alertdialog"]')
              ?.textContent?.includes('文件已被外部修改') === true,
          '脏文档外部冲突未弹窗',
        );

        // 模拟另一个入口在旧冲突决定返回前已进入审阅会话。
        await act(async () =>
          useStore.getState().updateTab(tabId, {
            sourceContent: '当前审阅正文\n',
            reviewSession: true,
            pendingReviewCount: 0,
            isDirty: true,
          }),
        );
        await act(async () => buttonByText(host, staleChoice).click());
        await waitFor(
          () => host.querySelector('[role="alertdialog"]') === null,
          '旧冲突弹窗未关闭',
        );

        const tab = useStore.getState().tabs.find((item) => item.id === tabId);
        const snapshot = getDiskSnapshot(tabId);
        expect(tab).toMatchObject({
          sourceContent: '当前审阅正文\n',
          fileMtime: 1,
          reviewSession: true,
          pendingReviewCount: 0,
          isDirty: true,
        });
        expect(snapshot).toMatchObject({ content: '原正文\n', mtime: 1 });
        expect(scenario.saveFile).not.toHaveBeenCalled();
        expect(scenario.saveReviewedFile).not.toHaveBeenCalled();
      } finally {
        await act(async () => root.unmount());
        mountedRoots.delete(root);
      }
    },
  );

  it('同一 mtime 但正文已变化时不覆盖原件，确认后另存审阅结果副本', async () => {
    const { host, root, scenario } = await mountScenario('原正文\n', '原正文\n', '外部新正文\n');
    try {
      await enterReview(host, scenario.tabId);
      const action = host.querySelector('.review-btn.is-accept');
      expect(action).toBeInstanceOf(HTMLButtonElement);
      if (!(action instanceof HTMLButtonElement)) throw new Error('逐项接受按钮类型错误');
      await act(async () => action.click());
      await waitFor(
        () => host.querySelector('[role="alertdialog"]') !== null,
        '逐项决定后未弹保存确认框',
      );

      // 外部程序改了正文但保持原 mtime，专用保存接口仍需以正文快照判定冲突。
      scenario.state.disk = '同一时间的后续外部版本\n';
      scenario.state.mtime = 2;
      await act(async () => buttonByText(host, '保存并结束审阅').click());
      await waitFor(
        () =>
          host.querySelector('[role="alertdialog"]')?.textContent?.includes('原文件已再次修改') ===
          true,
        '同 mtime 正文变化未弹副本确认框',
      );
      expect(scenario.saveReviewedFile).toHaveBeenCalledTimes(1);
      expect(scenario.saveFile).not.toHaveBeenCalled();

      await act(async () => buttonByText(host, '另存新版本').click());
      await waitFor(
        () => scenario.saveReviewCopy.mock.calls.length === 1,
        '确认另存后未调用审阅副本接口',
      );
      const tab = useStore.getState().tabs.find((item) => item.id === scenario.tabId);
      expect(scenario.state.disk).toBe('同一时间的后续外部版本\n');
      expect(scenario.state.copyDisk).toBe('外部新正文\n');
      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(tab).toMatchObject({
        filePath: scenario.state.copyPath,
        fileMtime: scenario.state.copyMtime,
        sourceContent: '外部新正文\n',
        pendingReviewCount: 0,
        reviewSession: false,
        isDirty: false,
        externalUpdatePending: false,
      });
    } finally {
      await act(async () => root.unmount());
      mountedRoots.delete(root);
    }
  });

  it('最终确认等待专用保存时外部正文变化，冲突只能另存或取消', async () => {
    const { host, root, scenario } = await mountScenario('原正文\n', '原正文\n', '外部新正文\n');
    try {
      await enterReview(host, scenario.tabId);
      const action = host.querySelector('.review-btn.is-accept');
      expect(action).toBeInstanceOf(HTMLButtonElement);
      if (!(action instanceof HTMLButtonElement)) throw new Error('逐项接受按钮类型错误');
      await act(async () => action.click());
      await waitFor(
        () => host.querySelector('[role="alertdialog"]') !== null,
        '逐项决定后未弹保存确认框',
      );

      scenario.state.reviewedSaveGate = new Promise<SaveResult>((resolve) => {
        scenario.state.resolveReviewedSave = resolve;
      });
      await act(async () => buttonByText(host, '保存并结束审阅').click());
      await waitFor(
        () => scenario.saveReviewedFile.mock.calls.length === 1,
        '最终确认后未进入专用保存调用',
      );

      scenario.state.disk = '最终确认期间外部版本\n';
      scenario.state.mtime = 3;
      await act(async () =>
        scenario.emitWatchEvent({
          path: scenario.state.originalPath,
          status: 'changed',
          mtime: 3,
        }),
      );
      await waitFor(
        () =>
          useStore.getState().tabs.find((tab) => tab.id === scenario.tabId)
            ?.externalUpdatePending === true,
        '最终确认期间的外部版本未被标记',
      );
      scenario.state.resolveReviewedSave?.({ status: 'conflict' });
      await waitFor(
        () =>
          host.querySelector('[role="alertdialog"]')?.textContent?.includes('原文件已再次修改') ===
          true,
        '专用保存冲突后未弹另存确认框',
      );

      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(scenario.saveReviewCopy).not.toHaveBeenCalled();
      expect(useStore.getState().tabs.find((tab) => tab.id === scenario.tabId)).toMatchObject({
        filePath: scenario.state.originalPath,
        fileMtime: 2,
        sourceContent: '外部新正文\n',
        pendingReviewCount: 0,
        reviewSession: true,
        isDirty: true,
      });

      await act(async () => buttonByText(host, '取消').click());
      await waitFor(() => host.querySelector('[role="alertdialog"]') === null, '冲突确认框未关闭');
      expect(scenario.state.disk).toBe('最终确认期间外部版本\n');
      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(scenario.saveReviewCopy).not.toHaveBeenCalled();
    } finally {
      scenario.state.resolveReviewedSave = null;
      await act(async () => root.unmount());
      mountedRoots.delete(root);
    }
  });

  it('副本确认取消后保留会话，另存为也不能绕过审阅专用路径', async () => {
    const { host, root, scenario } = await mountScenario('原正文\n', '原正文\n', '外部新正文\n');
    try {
      await enterReview(host, scenario.tabId);
      const action = host.querySelector('.review-btn.is-accept');
      expect(action).toBeInstanceOf(HTMLButtonElement);
      if (!(action instanceof HTMLButtonElement)) throw new Error('逐项接受按钮类型错误');
      await act(async () => action.click());
      await waitFor(
        () => host.querySelector('[role="alertdialog"]') !== null,
        '逐项决定后未弹保存确认框',
      );

      scenario.state.disk = '后续外部版本\n';
      scenario.state.mtime = 3;
      await act(async () => buttonByText(host, '保存并结束审阅').click());
      await waitFor(
        () =>
          host.querySelector('[role="alertdialog"]')?.textContent?.includes('原文件已再次修改') ===
          true,
        '外部版本变化未弹副本确认框',
      );
      await act(async () => buttonByText(host, '取消').click());
      await waitFor(() => host.querySelector('[role="alertdialog"]') === null, '副本确认框未关闭');

      expect(scenario.saveReviewedFile).toHaveBeenCalledTimes(1);
      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(useStore.getState().tabs.find((tab) => tab.id === scenario.tabId)).toMatchObject({
        pendingReviewCount: 0,
        reviewSession: true,
        isDirty: true,
      });
      expect(buttonByText(host, '保存审阅结果')).toBeInstanceOf(HTMLButtonElement);

      // 另存为只能走副本接口；模拟用户取消文件选择，不应清理审阅会话。
      scenario.state.copyResult = null;
      await act(async () => scenario.invokeMenuSaveAs());
      await waitFor(
        () => scenario.saveReviewCopy.mock.calls.length === 1,
        '普通另存为未走审阅副本接口',
      );
      expect(scenario.saveReviewedFile).toHaveBeenCalledTimes(1);
      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(useStore.getState().tabs.find((tab) => tab.id === scenario.tabId)).toMatchObject({
        filePath: scenario.state.originalPath,
        pendingReviewCount: 0,
        reviewSession: true,
        isDirty: true,
      });
      expect(scenario.state.disk).toBe('后续外部版本\n');
    } finally {
      await act(async () => root.unmount());
      mountedRoots.delete(root);
    }
  });

  it.each([
    ['接受', 'accept', '外部新正文\n'],
    ['拒绝', 'reject', '原正文\n'],
  ] as const)(
    '逐项%s最后一处改动后先确认，再通过专用接口保存一次',
    async (_label, decision, expectedDisk) => {
      const { host, root, scenario } = await mountScenario('原正文\n', '原正文\n', '外部新正文\n');
      try {
        await enterReview(host, scenario.tabId);
        const selector = decision === 'accept' ? '.review-btn.is-accept' : '.review-btn.is-reject';
        const action = host.querySelector(selector);
        expect(action).toBeInstanceOf(HTMLButtonElement);
        if (!(action instanceof HTMLButtonElement)) throw new Error('逐项操作按钮类型错误');
        await act(async () => action.click());
        await waitFor(
          () => host.querySelector('[role="alertdialog"]') !== null,
          '逐项决定后未弹保存确认框',
        );

        expect(scenario.saveReviewedFile).not.toHaveBeenCalled();
        expect(scenario.saveFile).not.toHaveBeenCalled();

        await act(async () => buttonByText(host, '保存并结束审阅').click());
        await waitFor(
          () => scenario.saveReviewedFile.mock.calls.length === 1,
          '确认逐项决定后未通过专用接口保存',
        );

        expect(scenario.state.disk).toBe(expectedDisk);
        expect(scenario.saveReviewedFile).toHaveBeenCalledTimes(1);
        expect(scenario.saveFile).not.toHaveBeenCalled();
        expect(useStore.getState().tabs.find((tab) => tab.id === scenario.tabId)).toMatchObject({
          pendingReviewCount: 0,
          reviewSession: false,
          isDirty: false,
        });
      } finally {
        await act(async () => root.unmount());
        mountedRoots.delete(root);
      }
    },
  );

  it.each([
    ['全部接受', '接受并保存', '外部新正文\n'],
    ['全部拒绝', '拒绝并保存', '原正文\n'],
  ])('%s在确认前不写盘，确认后只保存一次', async (bulkLabel, confirmLabel, expectedDisk) => {
    const { host, root, scenario } = await mountScenario('原正文\n', '原正文\n', '外部新正文\n');
    try {
      await enterReview(host, scenario.tabId);
      await act(async () => buttonByText(host, bulkLabel).click());
      await waitFor(
        () => host.querySelector('[role="alertdialog"]') !== null,
        `${bulkLabel}未弹确认框`,
      );
      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(scenario.state.disk).toBe(scenario.external);

      await act(async () => buttonByText(host, confirmLabel).click());
      await waitFor(
        () => scenario.saveReviewedFile.mock.calls.length === 1,
        `确认${bulkLabel}后未通过专用接口保存`,
      );
      expect(scenario.saveReviewedFile).toHaveBeenCalledTimes(1);
      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(host.querySelector('[role="alertdialog"]')).toBeNull();
      expect(scenario.state.disk).toBe(expectedDisk);
    } finally {
      await act(async () => root.unmount());
      mountedRoots.delete(root);
    }
  });

  it('全部拒绝取消时不写盘并保留待审状态', async () => {
    const { host, root, scenario } = await mountScenario('原正文\n', '原正文\n', '外部新正文\n');
    try {
      await enterReview(host, scenario.tabId);
      await act(async () => buttonByText(host, '全部拒绝').click());
      await waitFor(
        () => host.querySelector('[role="alertdialog"]') !== null,
        '全部拒绝未弹确认框',
      );
      expect(scenario.saveFile).not.toHaveBeenCalled();

      await act(async () => buttonByText(host, '取消').click());
      await waitFor(() => host.querySelector('[role="alertdialog"]') === null, '取消确认框未关闭');
      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(scenario.state.disk).toBe(scenario.external);
      expect(
        useStore.getState().tabs.find((tab) => tab.id === scenario.tabId)?.pendingReviewCount,
      ).toBe(1);
    } finally {
      await act(async () => root.unmount());
      mountedRoots.delete(root);
    }
  });

  it('源码模式重新加载后，第一次真实输入会标记脏且不写盘', async () => {
    const { host, root, scenario } = await mountScenario('原正文\n', '原正文\n', '外部新正文\n');
    try {
      await act(async () => useStore.setState({ viewMode: 'source' }));
      await waitFor(
        () =>
          useStore.getState().viewMode === 'source' &&
          sourceEditorHandle.current?.getValue() === '原正文\n',
        '源码模式未加载原正文',
      );

      await act(async () => buttonByText(host, '重新加载').click());
      await waitFor(
        () => sourceEditorHandle.current?.getValue() === scenario.external,
        '重新加载后源码编辑器未加载外部版本',
      );
      expect(scenario.saveFile).not.toHaveBeenCalled();

      await act(async () => sourceEditorHandle.current?.replaceRange(0, 0, '用户输入'));
      await waitFor(() => {
        const tab = useStore.getState().tabs.find((item) => item.id === scenario.tabId);
        return tab?.isDirty === true && tab.sourceContent.startsWith('用户输入');
      }, '重新加载后的第一次源码输入未标记脏');

      expect(scenario.saveFile).not.toHaveBeenCalled();
      expect(scenario.state.disk).toBe(scenario.external);
    } finally {
      await act(async () => root.unmount());
      mountedRoots.delete(root);
    }
  });
});
