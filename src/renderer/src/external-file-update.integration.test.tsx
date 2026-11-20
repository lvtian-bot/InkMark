// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { editorStateCache } from './editor-state-cache';
import { resolveConfirmDialog } from './confirm-dialog';
import { sourceEditorHandle } from './source-editor-ref';
import { useStore } from './stores/useStore';
import type { FileWatchEvent, InkMarkAPI } from './types';
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
vi.mock('./hooks/useOutline', () => ({
  useOutline: () => ({
    updateOutline: () => undefined,
    updateSourceOutline: () => undefined,
  }),
}));
vi.mock('./hooks/useWordCount', () => ({
  useWordCount: () => ({
    updateWordCount: () => undefined,
    updateSourceWordCount: () => undefined,
  }),
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
const base = '原正文\n';
const local = '人工编辑\n';
const external = '外部版本\n';

async function mountScenario() {
  let disk = base;
  let mtime = 1;
  let watch: ((event: FileWatchEvent) => void) | undefined;
  const saveFile = vi.fn<InkMarkAPI['saveFile']>(async () => ({ status: 'ok', mtime: 4 }));
  const target: Partial<InkMarkAPI> = {
    platform: 'win32',
    saveFile,
    openFilePath: async () => ({ path, content: disk, mtime }),
    getFileMtime: async () => ({ status: 'ok', mtime }),
    listRecoveryDrafts: async () => [],
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
    autoSave: false,
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
    tab: () => useStore.getState().tabs.find((item) => item.id === tabId),
    baseline: () => getDiskBaseline(tabId),
    writeExternally(content: string, version: number) {
      disk = content;
      mtime = version;
      watch?.({ path, status: 'changed', mtime });
    },
  };
}

afterEach(async () => {
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
  it('等待点击重新加载并读取最新版本，之后的编辑仍标记为未保存', async () => {
    const { host, saveFile, tab, baseline, writeExternally } = await mountScenario();
    await act(async () => writeExternally(external, 2));
    const banner = host.querySelector<HTMLElement>('.external-update-banner');
    expect(banner?.textContent).toContain('文件已被外部更新');
    expect(
      Array.from(banner?.querySelectorAll('button') ?? [], (button) => button.textContent),
    ).toEqual(['重新加载']);
    expect(tab()).toMatchObject({ sourceContent: base, fileMtime: 1, externalUpdatePending: true });
    expect(sourceEditorHandle.current?.getValue()).toBe(base);

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
    expect(baseline()).toBe(latest);

    await act(async () => sourceEditorHandle.current?.replaceRange(0, 0, '用户输入'));
    expect(tab()).toMatchObject({ sourceContent: '用户输入' + latest, isDirty: true });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it.each([
    {
      choice: '使用磁盘版本',
      sourceContent: external,
      fileMtime: 2,
      isDirty: false,
      disk: external,
    },
    {
      choice: '保留并在下次保存时覆盖',
      sourceContent: local,
      fileMtime: 2,
      isDirty: true,
      disk: external,
    },
    { choice: '取消', sourceContent: local, fileMtime: 1, isDirty: true, disk: base },
  ])(
    '有未保存编辑时，继续按“$choice”处理冲突',
    async ({ choice, sourceContent, fileMtime, isDirty, disk }) => {
      const { host, saveFile, tab, baseline, writeExternally } = await mountScenario();
      await act(async () => sourceEditorHandle.current?.replaceRange(0, base.length, local));
      expect(tab()).toMatchObject({ sourceContent: local, isDirty: true });
      await act(async () => writeExternally(external, 2));

      const dialog = host.querySelector<HTMLElement>('[role="alertdialog"]');
      expect(dialog?.textContent).toContain('文件已被外部修改');
      expect(dialog?.querySelector('.confirm-diff-content')?.textContent).toContain(
        external.trim(),
      );
      expect(
        Array.from(dialog?.querySelectorAll('button') ?? [], (button) => button.textContent),
      ).toEqual(['使用磁盘版本', '保留并在下次保存时覆盖', '取消']);
      expect(sourceEditorHandle.current?.getValue()).toBe(local);

      await act(async () => buttonByText(host, choice).click());
      expect(tab()).toMatchObject({ sourceContent, fileMtime, isDirty });
      expect(sourceEditorHandle.current?.getValue()).toBe(sourceContent);
      expect(baseline()).toBe(disk);
      expect(saveFile).not.toHaveBeenCalled();
    },
  );
});
