// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { editorStateCache } from './editor-state-cache';
import { editorHandle, type EditorHandle } from './editor-ref';
import { runEditorCommand } from './editor-commands';
import { resolveConfirmDialog } from './confirm-dialog';
import { sourceEditorHandle } from './source-editor-ref';
import { useStore } from './stores/useStore';
import type { FileWatchEvent, InkMarkAPI, SaveAsResponse, SaveResult } from './types';
import { clearDiskBaseline, getDiskBaseline, setDiskBaseline } from './disk-baseline';

// 走真实的文件监听、提示条、冲突弹窗和 CodeMirror，跳过无关的界面组件。

vi.mock('./components/Editor', () => ({ Editor: () => null }));
vi.mock('./components/StatusBar', () => ({ StatusBar: () => null }));
vi.mock('./components/TabBar', () => ({ TabBar: () => null }));
vi.mock('./components/Toolbar', () => ({ Toolbar: () => null }));
vi.mock('./components/Outline', () => ({ Outline: () => null }));
vi.mock('./components/FileTree', () => ({ FileTree: () => null }));
vi.mock('./components/StartPage', () => ({ StartPage: () => null }));
vi.mock('./components/ExportProgressDialog', () => ({ ExportProgressDialog: () => null }));
vi.mock('./hooks/useEditorFont', () => ({ useEditorFont: () => undefined }));
vi.mock('./hooks/useFileTree', () => ({ useFileTree: () => ({ closeRoot: () => undefined }) }));
const noop = () => undefined;
const outlineMock = { updateOutline: noop, updateSourceOutline: noop };
const wordCountMock = { updateWordCount: noop, updateSourceWordCount: noop };

vi.mock('./hooks/useOutline', () => ({
  useOutline: () => outlineMock,
}));
vi.mock('./hooks/useWordCount', () => ({
  useWordCount: () => wordCountMock,
}));
vi.mock('./hooks/useExport', () => ({ useExport: () => ({ exportDocument: () => undefined }) }));
vi.mock('./hooks/useFindReplace', () => ({
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

const initialStore = useStore.getState();
const mountedRoots = new Set<Root>();

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

const path = 'D:/probe.md';
const savedAsPath = 'D:/probe-copy.md';
const base = '原正文\n';
const local = '人工编辑\n';
const external = '外部版本\n';

async function mountScenario(options?: { autoSave?: boolean }) {
  let disk = base;
  let mtime = 1;
  let watch: ((event: FileWatchEvent) => void) | undefined;
  let menuSave: (() => void) | undefined;
  let menuCloseTab: (() => void) | undefined;
  const saveFile = vi.fn<InkMarkAPI['saveFile']>(async () => ({ status: 'ok', mtime: 4 }));
  const saveFileAs = vi.fn<InkMarkAPI['saveFileAs']>(async (content): Promise<SaveAsResponse> => ({
    path: savedAsPath,
    content,
    mtime: 5,
  }));
  const target: Partial<InkMarkAPI> = {
    platform: 'win32',
    saveFile,
    saveFileAs,
    openFilePath: async () => ({ path, content: disk, mtime }),
    getFileMtime: async () => ({ status: 'ok', mtime }),
    listRecoveryDrafts: async () => [],
    onMenuSave: (callback) => {
      menuSave = callback;
    },
    onMenuCloseTab: (callback) => {
      menuCloseTab = callback;
    },
    onFileWatchEvent: (callback) => {
      watch = callback;
      return () => {
        watch = undefined;
      };
    },
  };
  window.inkmark = new Proxy(target, {
    get(object, property: string | symbol) {
      if (property in object) return object[property as keyof typeof object];
      return () => undefined;
    },
  }) as InkMarkAPI;
  useStore.setState({
    autoSave: options?.autoSave ?? false,
    language: 'zh-CN',
    viewMode: 'source',
    toolbarVisible: false,
    outlineVisible: false,
    fileTreeVisible: false,
  });
  const tabId = useStore.getState().addTab({
    filePath: path,
    content: base,
    fileMtime: 1,
    startPage: false,
  });
  setDiskBaseline(tabId, base);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.add(root);
  await act(async () => root.render(React.createElement(App)));
  await act(async () => {
    await import('./components/SourceEditor');
  });
  await waitFor(() => sourceEditorHandle.current?.getValue() === base, '源码编辑器未加载原文');

  return {
    host,
    saveFile,
    saveFileAs,
    tab: () => useStore.getState().tabs.find((item) => item.id === tabId),
    baseline: () => getDiskBaseline(tabId),
    triggerMenuSave: () => menuSave?.(),
    triggerMenuCloseTab: () => menuCloseTab?.(),
    writeExternally(content: string, version: number) {
      disk = content;
      mtime = version;
      watch?.({ path, status: 'changed', mtime });
    },
    setDiskState(content: string, version: number) {
      disk = content;
      mtime = version;
    },
  };
}

afterEach(async () => {
  vi.useRealTimers();
  editorHandle.current = null;
  resolveConfirmDialog(-1);
  for (const root of mountedRoots) {
    await act(async () => root.unmount());
  }
  mountedRoots.clear();
  for (const tab of useStore.getState().tabs) {
    clearDiskBaseline(tab.id);
    editorStateCache.dispose(tab.id);
  }
  document.body.replaceChildren();
  useStore.setState(initialStore);
});

describe('外部文件更新', () => {
  it('干净文档等待手动重新加载期间锁定编辑，点击重新加载后恢复可编辑', async () => {
    const { host, saveFile, tab, baseline, writeExternally } = await mountScenario();
    await act(async () => writeExternally(external, 2));
    const banner = host.querySelector<HTMLElement>('.external-update-banner');
    expect(banner?.textContent).toContain('文件已被外部更新，请先重新加载后再编辑');
    expect(
      Array.from(banner?.querySelectorAll('button') ?? [], (button) => button.textContent),
    ).toEqual(['重新加载']);
    expect(tab()).toMatchObject({
      sourceContent: base,
      fileMtime: 1,
      externalUpdatePending: true,
      isDirty: false,
    });
    expect(sourceEditorHandle.current?.getEditorState().readOnly).toBe(true);

    // 锁定期间尝试编辑或格式命令不会改写正文，也不会吃掉提示条。
    await act(async () => {
      sourceEditorHandle.current?.replaceRange(0, 0, '误编辑');
      runEditorCommand('bold');
    });
    expect(sourceEditorHandle.current?.getValue()).toBe(base);
    expect(tab()).toMatchObject({
      sourceContent: base,
      externalUpdatePending: true,
      isDirty: false,
    });

    const latest = '外部再次更新\n';
    await act(async () => writeExternally(latest, 3));
    expect(sourceEditorHandle.current?.getValue()).toBe(base);
    await act(async () => buttonByText(host, '重新加载').click());

    expect(tab()).toMatchObject({
      sourceContent: latest,
      fileMtime: 3,
      externalUpdatePending: false,
      isDirty: false,
    });
    expect(sourceEditorHandle.current?.getValue()).toBe(latest);
    expect(sourceEditorHandle.current?.getEditorState().readOnly).toBe(false);
    expect(baseline()).toBe(latest);

    await act(async () => sourceEditorHandle.current?.replaceRange(0, 0, '用户输入'));
    expect(tab()).toMatchObject({ sourceContent: '用户输入' + latest, isDirty: true });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('有未保存修改遇到外部更新时提供四个完整选项并支持「另存为新文件…」', async () => {
    const { host, saveFile, saveFileAs, tab, baseline, writeExternally } = await mountScenario();
    await act(async () => sourceEditorHandle.current?.replaceRange(0, base.length, local));
    expect(tab()).toMatchObject({ sourceContent: local, isDirty: true });
    await act(async () => writeExternally(external, 2));

    const dialog = host.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('文件已被外部修改');
    expect(dialog?.querySelector('.confirm-diff-content')?.textContent).toContain(external.trim());
    expect(
      Array.from(dialog?.querySelectorAll('button') ?? [], (button) => button.textContent),
    ).toEqual(['另存为新文件…', '使用磁盘版本', '覆盖磁盘版本', '取消']);
    expect(sourceEditorHandle.current?.getEditorState().readOnly).toBe(true);

    await act(async () => buttonByText(host, '另存为新文件…').click());
    await settleReact();
    expect(saveFileAs).toHaveBeenCalledWith(local, path);
    expect(saveFile).not.toHaveBeenCalled();
    expect(tab()).toMatchObject({
      filePath: savedAsPath,
      sourceContent: local,
      fileMtime: 5,
      isDirty: false,
      externalUpdatePending: false,
    });
    expect(baseline()).toBe(local);
    expect(sourceEditorHandle.current?.getEditorState().readOnly).toBe(false);
  });

  it('冲突弹窗取消另存为时保留冲突状态与只读锁定', async () => {
    const { host, saveFileAs, tab, writeExternally } = await mountScenario();
    saveFileAs.mockResolvedValueOnce(null);
    await act(async () => sourceEditorHandle.current?.replaceRange(0, base.length, local));
    await act(async () => writeExternally(external, 2));

    await act(async () => buttonByText(host, '另存为新文件…').click());
    await settleReact();
    expect(tab()).toMatchObject({
      filePath: path,
      sourceContent: local,
      isDirty: true,
      externalUpdatePending: true,
    });
    expect(sourceEditorHandle.current?.getEditorState().readOnly).toBe(true);
    expect(host.querySelector('.external-update-banner')?.textContent).toContain(
      '文件已被外部修改，已暂停编辑与自动保存',
    );
  });

  it('冲突弹窗选择「使用磁盘版本」会重新加载并解锁编辑', async () => {
    const { host, saveFile, tab, baseline, writeExternally } = await mountScenario();
    await act(async () => sourceEditorHandle.current?.replaceRange(0, base.length, local));
    await act(async () => writeExternally(external, 2));

    await act(async () => buttonByText(host, '使用磁盘版本').click());
    expect(tab()).toMatchObject({
      sourceContent: external,
      fileMtime: 2,
      isDirty: false,
      externalUpdatePending: false,
    });
    expect(sourceEditorHandle.current?.getValue()).toBe(external);
    expect(sourceEditorHandle.current?.getEditorState().readOnly).toBe(false);
    expect(baseline()).toBe(external);
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('冲突弹窗选择「覆盖磁盘版本」按最新修改时间写入，并在写入瞬间再冲突时刷新差异', async () => {
    const { host, saveFile, tab, baseline, writeExternally, setDiskState } = await mountScenario();
    const newerExternal = '写盘前又被修改\n';
    saveFile
      .mockImplementationOnce(async () => {
        setDiskState(newerExternal, 3);
        return { status: 'conflict' } satisfies SaveResult;
      })
      .mockResolvedValueOnce({ status: 'ok', mtime: 4 });

    await act(async () => sourceEditorHandle.current?.replaceRange(0, base.length, local));
    await act(async () => writeExternally(external, 2));

    await act(async () => buttonByText(host, '覆盖磁盘版本').click());
    expect(saveFile).toHaveBeenNthCalledWith(1, local, path, 2, false);

    const retryDialog = host.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(retryDialog?.querySelector('.confirm-diff-content')?.textContent).toContain(
      newerExternal.trim(),
    );

    await act(async () => buttonByText(host, '覆盖磁盘版本').click());
    expect(saveFile).toHaveBeenNthCalledWith(2, local, path, 3, false);
    expect(tab()).toMatchObject({
      sourceContent: local,
      fileMtime: 4,
      isDirty: false,
      externalUpdatePending: false,
    });
    expect(baseline()).toBe(local);
    expect(sourceEditorHandle.current?.getEditorState().readOnly).toBe(false);
  });

  it('冲突弹窗点「取消」后保持只读与常驻冲突条，聚焦不重复弹窗且可再次查看差异', async () => {
    const { host, saveFile, tab, baseline, writeExternally } = await mountScenario();
    await act(async () => sourceEditorHandle.current?.replaceRange(0, base.length, local));
    await act(async () => writeExternally(external, 2));

    await act(async () => buttonByText(host, '取消').click());
    expect(tab()).toMatchObject({
      sourceContent: local,
      fileMtime: 1,
      isDirty: true,
      externalUpdatePending: true,
    });
    expect(baseline()).toBe(base);
    expect(saveFile).not.toHaveBeenCalled();
    expect(sourceEditorHandle.current?.getEditorState().readOnly).toBe(true);

    const banner = host.querySelector<HTMLElement>('.external-update-banner');
    expect(banner?.textContent).toContain('文件已被外部修改，已暂停编辑与自动保存');
    expect(
      Array.from(banner?.querySelectorAll('button') ?? [], (button) => button.textContent),
    ).toEqual(['另存为新文件…', '查看差异并处理']);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();

    await act(async () => buttonByText(host, '查看差异并处理').click());
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('文件已被外部修改');
    await act(async () => buttonByText(host, '使用磁盘版本').click());
    expect(tab()).toMatchObject({
      sourceContent: external,
      isDirty: false,
      externalUpdatePending: false,
    });
  });

  it('手动保存撞上修改时间冲突时进入完整的四选项冲突流程', async () => {
    const { host, saveFile, tab, triggerMenuSave, setDiskState } = await mountScenario();
    saveFile.mockResolvedValueOnce({ status: 'conflict' });
    setDiskState(external, 2);

    await act(async () => sourceEditorHandle.current?.replaceRange(0, base.length, local));
    await act(async () => {
      triggerMenuSave();
    });

    const dialog = host.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('文件已被外部修改');
    expect(
      Array.from(dialog?.querySelectorAll('button') ?? [], (button) => button.textContent),
    ).toEqual(['另存为新文件…', '使用磁盘版本', '覆盖磁盘版本', '取消']);
    expect(sourceEditorHandle.current?.getEditorState().readOnly).toBe(true);

    await act(async () => buttonByText(host, '使用磁盘版本').click());
    expect(tab()).toMatchObject({
      sourceContent: external,
      fileMtime: 2,
      isDirty: false,
      externalUpdatePending: false,
    });
  });

  it('开启自动保存时遇到外部冲突立即暂停自动保存，关闭标签也不静默补存', async () => {
    const { host, saveFile, tab, writeExternally, triggerMenuCloseTab } = await mountScenario({
      autoSave: true,
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await act(async () => {
      sourceEditorHandle.current?.replaceRange(0, base.length, local);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(tab()).toMatchObject({ sourceContent: local, isDirty: true });
    await act(async () => {
      writeExternally(external, 2);
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(tab()).toMatchObject({ externalUpdatePending: true });
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('文件已被外部修改');
    await act(async () => buttonByText(host, '取消').click());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(saveFile).not.toHaveBeenCalled();

    await act(async () => {
      triggerMenuCloseTab();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(saveFile).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('未保存的更改');
    await act(async () => buttonByText(host, '取消').click());
    expect(tab()).toMatchObject({
      sourceContent: local,
      isDirty: true,
      externalUpdatePending: true,
    });
  });

  it('所见即所得防抖窗口内保存撞上冲突时，先刷新待同步正文再锁只读与对比', async () => {
    const { host, saveFile, saveFileAs, tab, triggerMenuSave, setDiskState } =
      await mountScenario();
    const pendingLocal = '尚未同步的所见即所得编辑\n';
    saveFile.mockResolvedValueOnce({ status: 'conflict' });
    setDiskState(external, 2);

    await act(async () => {
      useStore.setState({ viewMode: 'wysiwyg' });
      editorHandle.current = {
        getMarkdown: () => pendingLocal,
        getPendingMarkdown: () => pendingLocal,
        getSelectedMarkdown: () => '',
        setMarkdown: noop,
        clear: noop,
        replaceDocumentUndoable: noop,
        skipFrontmatterIfSelected: noop,
        getEditorState: () => null,
        setEditorState: noop,
        getMarkdownFromState: () => '',
        scrollToPos: noop,
        getScrollContainer: () => null,
        getScrollTop: () => 0,
        setScrollTop: noop,
        undo: noop,
        redo: noop,
        toggleBold: noop,
        toggleItalic: noop,
        toggleStrike: noop,
        toggleInlineCode: noop,
        wrapHeading: noop,
        wrapBulletList: noop,
        wrapOrderedList: noop,
        wrapTaskList: noop,
        insertCodeBlock: noop,
        insertLink: noop,
        insertTable: noop,
        insertText: noop,
        deleteLine: noop,
        addTableLine: noop,
        deleteTableLine: noop,
        selectTable: noop,
        copyTable: noop,
        findTextMatches: () => [],
        getFindSegments: () => [],
        getSelection: () => ({ from: 0, to: 0 }),
        showFindScope: noop,
        replaceTextMatches: () => 0,
        showTextMatches: noop,
        replaceTextMatch: () => false,
        replaceAllTextMatches: () => 0,
        focus: noop,
      } satisfies EditorHandle;
    });

    await act(async () => {
      triggerMenuSave();
    });
    expect(saveFile).toHaveBeenCalledWith(pendingLocal, path, 1);

    const dialog = host.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog?.querySelector('.confirm-diff-content')?.textContent).toContain(
      pendingLocal.trim(),
    );

    await act(async () => buttonByText(host, '另存为新文件…').click());
    await settleReact();
    expect(saveFileAs).toHaveBeenCalledWith(pendingLocal, path);
    expect(tab()).toMatchObject({
      filePath: savedAsPath,
      sourceContent: pendingLocal,
      isDirty: false,
      externalUpdatePending: false,
    });
  });
});
