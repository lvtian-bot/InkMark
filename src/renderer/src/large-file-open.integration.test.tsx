// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LARGE_MARKDOWN_THRESHOLD_BYTES } from '../../shared/openable-document';
import { clearDiskBaseline } from './disk-baseline';
import { editorHandle, type EditorHandle } from './editor-ref';
import { editorStateCache } from './editor-state-cache';
import { sourceEditorHandle } from './source-editor-ref';
import { resetToggleViewModeThrottleForTesting, selectViewMode, useStore } from './stores/useStore';
import type { InkMarkAPI } from './types';

const editorSpies = vi.hoisted(() => ({
  setMarkdown: vi.fn(),
  clear: vi.fn(),
  getMarkdown: vi.fn(() => ''),
}));

vi.mock('./components/Editor', async () => {
  const ReactMod = await import('react');
  const { editorHandle: handleRef } = await import('./editor-ref');
  return {
    Editor: () => {
      ReactMod.useEffect(() => {
        let currentMd = '';
        const mockHandle: Partial<EditorHandle> = {
          getMarkdown: () => {
            editorSpies.getMarkdown();
            return currentMd;
          },
          getPendingMarkdown: () => null,
          getSelectedMarkdown: () => '',
          setMarkdown: (md: string) => {
            currentMd = md;
            editorSpies.setMarkdown(md);
          },
          clear: () => {
            currentMd = '';
            editorSpies.clear();
          },
          skipFrontmatterIfSelected: () => undefined,
          getEditorState: () => null,
          setEditorState: () => undefined,
          getScrollTop: () => 0,
          setScrollTop: () => undefined,
          focus: () => undefined,
        };
        handleRef.current = new Proxy(mockHandle, {
          get(target, prop) {
            if (prop in target) return target[prop as keyof EditorHandle];
            return () => undefined;
          },
        }) as EditorHandle;
        return () => {
          handleRef.current = null;
        };
      }, []);
      return null;
    },
  };
});
vi.mock('./components/TabBar', () => ({ TabBar: () => null }));
vi.mock('./components/Toolbar', () => ({ Toolbar: () => null }));
vi.mock('./components/Outline', () => ({ Outline: () => null }));
vi.mock('./components/FileTree', () => ({ FileTree: () => null }));
vi.mock('./components/StartPage', () => ({
  StartPage: ({ onCreateBlank }: { onCreateBlank: () => void }) => (
    <button type="button" onClick={onCreateBlank}>
      新建空白文档
    </button>
  ),
}));
vi.mock('./components/ExportProgressDialog', () => ({ ExportProgressDialog: () => null }));
vi.mock('./hooks/useEditorFont', () => ({ useEditorFont: () => undefined }));
vi.mock('./hooks/useFileTree', () => ({ useFileTree: () => ({ closeRoot: () => undefined }) }));
vi.mock('./hooks/useExport', () => ({ useExport: () => ({ exportDocument: () => undefined }) }));

import App from './App';
import { resolveConfirmDialog } from './confirm-dialog';

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
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (condition()) return;
    await settleReact();
  }
  throw new Error(message);
}

function mountApp(
  files: Record<string, string>,
  initialViewMode: 'wysiwyg' | 'source' = 'wysiwyg',
) {
  let openFileCallback: ((path: string) => void) | undefined;
  let watchCallback:
    ((event: { path: string; status: 'changed' | 'missing'; mtime?: number }) => void) | undefined;
  const target: Partial<InkMarkAPI> = {
    platform: 'win32',
    openFilePath: async (path: string) =>
      path in files ? { path, content: files[path], mtime: 1 } : null,
    getFileMtime: async () => ({ status: 'ok', mtime: 1 }),
    listRecoveryDrafts: async () => [],
    getRecentFiles: async () => [],
    onFileWatchEvent: (cb) => {
      watchCallback = cb;
      return () => {
        watchCallback = undefined;
      };
    },
    onOpenFilePath: (cb) => {
      openFileCallback = cb;
    },
  };
  window.inkmark = new Proxy(target, {
    get(object, property: string | symbol) {
      if (property in object) return object[property as keyof typeof object];
      if (typeof property === 'string' && property.startsWith('on')) {
        return () => () => undefined;
      }
      return async () => undefined;
    },
  }) as InkMarkAPI;

  useStore.setState({
    autoSave: false,
    language: 'zh-CN',
    viewMode: initialViewMode,
    toolbarVisible: false,
    outlineVisible: false,
    fileTreeVisible: false,
  });

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.add(root);

  return {
    host,
    async start() {
      await act(async () => root.render(React.createElement(App)));
      await act(async () => {
        await import('./components/SourceEditor');
      });
      await waitFor(
        () => !!editorHandle.current && !!sourceEditorHandle.current && !!openFileCallback,
        '应用未完成初始化',
      );
    },
    async openFile(path: string) {
      await act(async () => {
        openFileCallback?.(path);
      });
    },
    async triggerExternalChange(path: string, nextContent: string, mtime = 2) {
      files[path] = nextContent;
      await act(async () => {
        watchCallback?.({ path, status: 'changed', mtime });
      });
    },
  };
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

describe('大文档自动源码模式与惰性所见即所得加载', () => {
  beforeEach(() => {
    editorSpies.setMarkdown.mockClear();
    editorSpies.clear.mockClear();
    editorSpies.getMarkdown.mockClear();
    resetToggleViewModeThrottleForTesting();
  });

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

  it('超过 1 MB 的 Markdown 文件自动用源码模式秒开、不触发所见即所得解析，且不影响其他普通标签', async () => {
    const largePath = 'D:/docs/huge.md';
    const smallPath = 'D:/docs/small.md';
    const largeContent = `# Big Title\n\n${'x'.repeat(LARGE_MARKDOWN_THRESHOLD_BYTES + 2048)}`;
    const smallContent = '# Small Title\n\nNormal body';

    const app = mountApp({ [largePath]: largeContent, [smallPath]: smallContent }, 'wysiwyg');
    await app.start();

    await app.openFile(largePath);
    await waitFor(
      () => sourceEditorHandle.current?.getValue() === largeContent,
      '大文档未加载到源码编辑器',
    );

    expect(editorSpies.setMarkdown).not.toHaveBeenCalled();
    expect(selectViewMode(useStore.getState())).toBe('source');
    expect(useStore.getState().viewMode).toBe('wysiwyg');
    expect(app.host.textContent).toContain('当前文档较大，已自动使用源码模式打开以保持流畅。');

    const largeTab = useStore.getState().tabs.find((t) => t.filePath === largePath)!;
    expect(largeTab.largeDocSourceForced).toBe(true);
    expect(largeTab.charCount).toBeGreaterThan(LARGE_MARKDOWN_THRESHOLD_BYTES);

    // 再打开普通大小 Markdown 文档，应自动恢复用户的所见即所得偏好
    await app.openFile(smallPath);
    await waitFor(
      () => editorSpies.setMarkdown.mock.calls.some((call) => call[0] === smallContent),
      '普通文档未切回所见即所得并装载正文',
    );
    expect(selectViewMode(useStore.getState())).toBe('wysiwyg');
    expect(app.host.textContent).not.toContain('当前文档较大，已自动使用源码模式打开以保持流畅。');
  });

  it('点击仍用所见即所得打开时弹出确认框：取消留在源码，确认后才装载所见即所得', async () => {
    const largePath = 'D:/docs/huge-switch.md';
    const largeContent = `# Big\n\n${'y'.repeat(LARGE_MARKDOWN_THRESHOLD_BYTES + 1024)}`;

    const app = mountApp({ [largePath]: largeContent }, 'wysiwyg');
    await app.start();
    await app.openFile(largePath);
    await waitFor(
      () => sourceEditorHandle.current?.getValue() === largeContent,
      '大文档未加载到源码编辑器',
    );

    // 点击提示条按钮后选择「保持源码模式」
    await act(async () => {
      buttonByText(app.host, '仍用所见即所得打开').click();
    });
    await waitFor(
      () => app.host.textContent?.includes('切换到所见即所得模式') ?? false,
      '未弹出大文档切换确认框',
    );
    await act(async () => {
      buttonByText(app.host, '保持源码模式').click();
    });

    expect(editorSpies.setMarkdown).not.toHaveBeenCalled();
    expect(selectViewMode(useStore.getState())).toBe('source');
    expect(useStore.getState().tabs[0].largeDocSourceForced).toBe(true);

    // 通过状态栏切换按钮再次触发并确认「继续切换」
    const modeBtn = app.host.querySelector('.status-mode-btn') as HTMLButtonElement;
    await act(async () => {
      modeBtn.click();
    });
    await waitFor(
      () => app.host.textContent?.includes('切换到所见即所得模式') ?? false,
      '状态栏按钮未触发确认框',
    );
    await act(async () => {
      buttonByText(app.host, '继续切换').click();
    });

    await waitFor(() => editorSpies.setMarkdown.mock.calls.length === 1, '确认后未装载所见即所得');
    expect(editorSpies.setMarkdown).toHaveBeenCalledWith(largeContent);
    expect(selectViewMode(useStore.getState())).toBe('wysiwyg');
    expect(useStore.getState().tabs[0].largeDocSourceForced).toBe(false);
  });

  it('源码模式下打开和切换普通 Markdown 文档不会在后台装载所见即所得编辑器', async () => {
    const aPath = 'D:/docs/a.md';
    const bPath = 'D:/docs/b.md';
    const app = mountApp({ [aPath]: '# A', [bPath]: '# B' }, 'source');
    await app.start();

    await app.openFile(aPath);
    await waitFor(() => sourceEditorHandle.current?.getValue() === '# A', '文件 A 未加载到源码');
    await app.openFile(bPath);
    await waitFor(() => sourceEditorHandle.current?.getValue() === '# B', '文件 B 未加载到源码');

    const aTabId = useStore.getState().tabs.find((t) => t.filePath === aPath)!.id;
    await act(async () => {
      useStore.getState().setActiveTab(aTabId);
    });
    await waitFor(() => sourceEditorHandle.current?.getValue() === '# A', '未切回文件 A');

    expect(editorSpies.setMarkdown).not.toHaveBeenCalled();
  });

  it('大文档在外部修改缩小到 1 MB 以下后点击重新加载，不会恢复旧源码正文', async () => {
    const docPath = 'D:/docs/shrunk.md';
    const largeContent = `# Old\n\n${'z'.repeat(LARGE_MARKDOWN_THRESHOLD_BYTES + 1024)}`;
    const smallContent = '# New Small\n\nUpdated body';
    const files: Record<string, string> = { [docPath]: largeContent };

    const app = mountApp(files, 'wysiwyg');
    await app.start();
    await app.openFile(docPath);
    await waitFor(
      () => sourceEditorHandle.current?.getValue() === largeContent,
      '大文档未加载到源码编辑器',
    );

    await app.triggerExternalChange(docPath, smallContent, 2);
    await waitFor(
      () => app.host.textContent?.includes('重新加载') ?? false,
      '未显示外部更新提示条',
    );

    await act(async () => {
      buttonByText(app.host, '重新加载').click();
    });

    await waitFor(
      () => selectViewMode(useStore.getState()) === 'wysiwyg',
      '重载缩小文档后未解除源码限制',
    );
    await waitFor(
      () => editorHandle.current?.getMarkdown() === smallContent,
      '重载后所见即所得编辑器未同步为新正文',
    );
    expect(useStore.getState().tabs[0].sourceContent).toBe(smallContent);
    expect(useStore.getState().tabs[0].largeDocSourceForced).toBe(false);
  });

  it('从普通所见即所得标签切到开始页并新建空白文档时，会清空上一标签编辑状态', async () => {
    const docPath = 'D:/docs/prev.md';
    const prevContent = '# Previous\n\nShould not leak';
    const app = mountApp({ [docPath]: prevContent }, 'wysiwyg');
    await app.start();

    await app.openFile(docPath);
    await waitFor(
      () => editorHandle.current?.getMarkdown() === prevContent,
      '前置文档未装载到所见即所得编辑器',
    );

    // 新建开始页标签，再点「新建空白文档」
    await act(async () => {
      useStore.getState().addTab();
    });
    await waitFor(() => editorSpies.clear.mock.calls.length >= 1, '切入开始页未清空旧编辑器');

    await act(async () => {
      buttonByText(app.host, '新建空白文档').click();
    });
    await waitFor(() => !useStore.getState().tabs[1].isStartPage, '未能从开始页进入空白文档');

    expect(editorHandle.current?.getMarkdown()).toBe('');
    expect(useStore.getState().tabs[1].sourceContent).toBe('');
  });
});
