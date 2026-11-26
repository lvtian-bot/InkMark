// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LARGE_MARKDOWN_THRESHOLD_BYTES } from '../../shared/openable-document';
import { clearDiskBaseline } from './disk-baseline';
import { editorHandle, type EditorHandle } from './editor-ref';
import { editorStateCache } from './editor-state-cache';
import { extractReadableMarkdownText } from './large-markdown-chunks';
import { clearLargeReaderScrollTop, largeReaderHandle } from './large-reader-ref';
import { sourceEditorHandle } from './source-editor-ref';
import { resetToggleViewModeThrottleForTesting, selectViewMode, useStore } from './stores/useStore';
import type { InkMarkAPI } from './types';

const editorSpies = vi.hoisted(() => ({
  setMarkdown: vi.fn(),
  clear: vi.fn(),
  getMarkdown: vi.fn(() => ''),
  replaceTextMatches: vi.fn(),
}));

const fileTreeMocks = vi.hoisted(() => ({
  onRenameFile: undefined as
    ((entry: { name: string; absolutePath: string; kind: 'file' }) => void) | undefined,
  renameEntry: vi.fn(async (_oldPath: string, parentDir: string, newName: string) => ({
    path: `${parentDir}/${newName}`,
    mtime: 9,
  })),
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
          getFindSegments: () => [{ from: 0, text: currentMd }],
          replaceTextMatches: () => {
            editorSpies.replaceTextMatches();
            return 1;
          },
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
vi.mock('./components/Toolbar', () => ({
  Toolbar: () => <div data-testid="mock-toolbar" />,
}));
vi.mock('./components/Outline', () => ({ Outline: () => null }));
vi.mock('./components/FileTree', () => ({
  FileTree: (props: {
    onRenameFile?: (entry: { name: string; absolutePath: string; kind: 'file' }) => void;
  }) => {
    if (props.onRenameFile) {
      fileTreeMocks.onRenameFile = props.onRenameFile;
    }
    return null;
  },
}));
vi.mock('./components/StartPage', () => ({
  StartPage: ({ onCreateBlank }: { onCreateBlank: () => void }) => (
    <button type="button" onClick={onCreateBlank}>
      新建空白文档
    </button>
  ),
}));
vi.mock('./components/ExportProgressDialog', () => ({ ExportProgressDialog: () => null }));
vi.mock('./hooks/useEditorFont', () => ({ useEditorFont: () => undefined }));
vi.mock('./hooks/useFileTree', () => ({
  useFileTree: () => ({
    closeRoot: () => undefined,
    isPathInCurrentRoot: () => true,
    renameEntry: fileTreeMocks.renameEntry,
  }),
}));
vi.mock('./hooks/useExport', () => ({ useExport: () => ({ exportDocument: () => undefined }) }));

import App from './App';
import { resolveConfirmDialog, resolvePromptDialog } from './confirm-dialog';

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
  toolbarVisible = false,
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
    resolveImageSource: async ({ source }) => ({ status: 'ok', url: source }),
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
    toolbarVisible,
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
        await import('./components/LargeMarkdownReader');
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

describe('大文档所见即所得只读预览与源码编辑切换', () => {
  beforeEach(() => {
    editorSpies.setMarkdown.mockClear();
    editorSpies.clear.mockClear();
    editorSpies.getMarkdown.mockClear();
    editorSpies.replaceTextMatches.mockClear();
    fileTreeMocks.onRenameFile = undefined;
    fileTreeMocks.renameEntry.mockClear();
    resetToggleViewModeThrottleForTesting();
  });

  afterEach(async () => {
    resolveConfirmDialog(-1);
    resolvePromptDialog(null);
    for (const root of mountedRoots) {
      await act(async () => root.unmount());
    }
    mountedRoots.clear();
    for (const tab of useStore.getState().tabs) {
      clearDiskBaseline(tab.id);
      clearLargeReaderScrollTop(tab.id);
      editorStateCache.dispose(tab.id);
    }
    document.body.replaceChildren();
    useStore.setState(initialStore);
  });

  it('超过 1 MB 的 Markdown 在所见即所得模式下使用分段只读预览、不加载 Milkdown、隐藏工具栏并同步大纲字数', async () => {
    const largePath = 'D:/docs/huge.md';
    const smallPath = 'D:/docs/small.md';
    const largeContent = `---\ntitle: MetadataOnly\n---\n\n# Big Title\n\nFirst [link](https://example.com/very-long-url) paragraph.\n\n## Second Section\n\n${'x'.repeat(LARGE_MARKDOWN_THRESHOLD_BYTES + 2048)}`;
    const smallContent = '# Small Title\n\nNormal body';

    const app = mountApp({ [largePath]: largeContent, [smallPath]: smallContent }, 'wysiwyg', true);
    await app.start();

    await app.openFile(largePath);
    await waitFor(
      () => !!app.host.querySelector('.large-reader-body') && !!largeReaderHandle.current,
      '大文档只读预览未挂载',
    );

    expect(editorSpies.setMarkdown).not.toHaveBeenCalled();
    expect(selectViewMode(useStore.getState())).toBe('wysiwyg');
    expect(app.host.textContent).toContain(
      '文档超过 1 MB，所见即所得模式仅支持流畅阅读；如需编辑请切到源码模式。',
    );
    expect(app.host.querySelector('[data-testid="mock-toolbar"]')).toBeNull();
    expect(app.host.querySelector('.large-reader-body h1')?.textContent).toBe('Big Title');

    const largeTab = useStore.getState().tabs.find((t) => t.filePath === largePath)!;
    expect(largeTab.outline.map((h) => h.text)).toEqual(['Big Title', 'Second Section']);
    expect(largeTab.charCount).toBe(extractReadableMarkdownText(largeContent).length);
    expect(largeTab.charCount).toBeLessThan(largeContent.length);

    // 打开普通大小文档时恢复可编辑的 Milkdown 与工具栏
    await app.openFile(smallPath);
    await waitFor(
      () => editorSpies.setMarkdown.mock.calls.some((call) => call[0] === smallContent),
      '普通文档未装载到所见即所得编辑器',
    );
    expect(app.host.querySelector('.large-reader-body')).toBeNull();
    expect(app.host.querySelector('[data-testid="mock-toolbar"]')).not.toBeNull();
  });

  it('点击切到源码编辑直接进入源码修改，切回所见即所得立即反映修改后的只读渲染', async () => {
    const largePath = 'D:/docs/huge-edit.md';
    const bodyLines = Array.from({ length: 1200 }, (_, i) => `Line ${i} ${'y'.repeat(900)}`).join(
      '\n',
    );
    const largeContent = `# Original Title\n\n${bodyLines}`;
    expect(Buffer.byteLength(largeContent, 'utf8')).toBeGreaterThan(LARGE_MARKDOWN_THRESHOLD_BYTES);

    const app = mountApp({ [largePath]: largeContent }, 'wysiwyg', true);
    await app.start();
    await app.openFile(largePath);
    await waitFor(() => !!app.host.querySelector('.large-reader-body'), '未进入大文档只读预览');

    await act(async () => {
      buttonByText(app.host, '切到源码编辑').click();
    });

    await waitFor(
      () =>
        selectViewMode(useStore.getState()) === 'source' &&
        sourceEditorHandle.current?.getValue() === largeContent,
      '未切换到源码模式',
    );
    expect(app.host.querySelector('.large-document-banner')).toBeNull();
    expect(app.host.querySelector('[data-testid="mock-toolbar"]')).not.toBeNull();

    const updatedContent = largeContent.replace('# Original Title', '# Edited In Source');
    await act(async () => {
      sourceEditorHandle.current?.setValue(updatedContent);
    });

    const modeBtn = app.host.querySelector('.status-mode-btn') as HTMLButtonElement;
    await act(async () => {
      modeBtn.click();
    });

    await waitFor(
      () =>
        selectViewMode(useStore.getState()) === 'wysiwyg' &&
        app.host.querySelector('.large-reader-body h1')?.textContent === 'Edited In Source',
      '切回阅读模式后未显示源码修改结果',
    );
    expect(editorSpies.setMarkdown).not.toHaveBeenCalled();
  }, 15_000);

  it('在只读预览中输入按键会高亮提示条，按下 Ctrl+F 会自动切到源码模式并打开查找栏', async () => {
    const largePath = 'D:/docs/huge-keys.md';
    const largeContent = `# Search Target\n\n${'k'.repeat(LARGE_MARKDOWN_THRESHOLD_BYTES + 1024)}`;

    const app = mountApp({ [largePath]: largeContent }, 'wysiwyg');
    await app.start();
    await app.openFile(largePath);
    await waitFor(() => !!app.host.querySelector('.large-reader-body'), '未进入大文档只读预览');

    const readerBody = app.host.querySelector('.large-reader-body') as HTMLElement;
    await act(async () => {
      readerBody.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    expect(app.host.querySelector('.large-document-banner')?.className).toContain('is-highlighted');

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
      );
    });

    await waitFor(
      () =>
        selectViewMode(useStore.getState()) === 'source' &&
        !!app.host.querySelector('.find-replace-bar'),
      '按下 Ctrl+F 后未切到源码模式并打开查找栏',
    );
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

  it('外部重载跨过 1 MB 边界时，大变小恢复可编辑所见即所得，小变大清空 Milkdown 并切入只读预览', async () => {
    const docPath = 'D:/docs/boundary.md';
    const largeContent = `# Old Big\n\n${'z'.repeat(LARGE_MARKDOWN_THRESHOLD_BYTES + 1024)}`;
    const smallContent = '# New Small\n\nEditable now';
    const hugeAgain = `# Huge Again\n\n${'w'.repeat(LARGE_MARKDOWN_THRESHOLD_BYTES + 2048)}`;
    const files: Record<string, string> = { [docPath]: largeContent };

    const app = mountApp(files, 'wysiwyg');
    await app.start();
    await app.openFile(docPath);
    await waitFor(() => !!app.host.querySelector('.large-reader-body'), '未进入大文档只读预览');

    // 大 -> 小：恢复 Milkdown
    await app.triggerExternalChange(docPath, smallContent, 2);
    await waitFor(
      () => app.host.textContent?.includes('重新加载') ?? false,
      '未显示外部更新提示条',
    );
    await act(async () => {
      buttonByText(app.host, '重新加载').click();
    });
    await waitFor(
      () =>
        editorHandle.current?.getMarkdown() === smallContent &&
        !app.host.querySelector('.large-reader-body'),
      '大变小重载后未恢复可编辑所见即所得',
    );

    // 小 -> 大：清空 Milkdown 并显示只读预览
    await app.triggerExternalChange(docPath, hugeAgain, 3);
    await waitFor(
      () => app.host.textContent?.includes('重新加载') ?? false,
      '未显示第二次外部更新提示条',
    );
    await act(async () => {
      buttonByText(app.host, '重新加载').click();
    });
    await waitFor(
      () =>
        app.host.querySelector('.large-reader-body h1')?.textContent === 'Huge Again' &&
        editorSpies.clear.mock.calls.length >= 1,
      '小变大重载后未清空旧编辑器并切换只读预览',
    );
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

  it('源码模式下打开替换栏后切回大文档只读阅读，自动关闭查找栏且不篡改正文与隐藏编辑器', async () => {
    const largePath = 'D:/docs/huge-replace.md';
    const largeContent = `# Keep Me Intact\n\n${'m'.repeat(LARGE_MARKDOWN_THRESHOLD_BYTES + 1024)}`;
    const app = mountApp({ [largePath]: largeContent }, 'source');
    await app.start();
    await app.openFile(largePath);
    await waitFor(
      () => sourceEditorHandle.current?.getValue() === largeContent,
      '未在源码模式加载大文档',
    );

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true }),
      );
    });
    await waitFor(() => !!app.host.querySelector('.find-replace-bar'), '未打开查找替换栏');

    await act(async () => {
      useStore.getState().setViewMode('wysiwyg');
    });

    await waitFor(
      () =>
        !!app.host.querySelector('.large-reader-body') &&
        !app.host.querySelector('.find-replace-bar'),
      '切入大文档只读阅读后未关闭替换栏',
    );
    expect(editorSpies.replaceTextMatches).not.toHaveBeenCalled();
    expect(useStore.getState().tabs[0].sourceContent).toBe(largeContent);
    expect(useStore.getState().tabs[0].isDirty).toBe(false);
  });

  it('大文档只读阅读器之间以及切往普通文档再切回，完整保留各自阅读滚动位置', async () => {
    const docA = 'D:/docs/big-a.md';
    const docB = 'D:/docs/big-b.md';
    const docSmall = 'D:/docs/small-c.md';
    const contentA = Array.from(
      { length: 400 },
      (_, i) => `- Entry A ${i} ${'a'.repeat(3000)}`,
    ).join('\n');
    const contentB = Array.from(
      { length: 400 },
      (_, i) => `- Entry B ${i} ${'b'.repeat(3000)}`,
    ).join('\n');
    const app = mountApp({ [docA]: contentA, [docB]: contentB, [docSmall]: '# Small' }, 'wysiwyg');
    await app.start();

    await app.openFile(docA);
    await waitFor(() => !!app.host.querySelector('.large-reader-body'), '未加载大文档 A');
    const tabAId = useStore.getState().tabs.find((t) => t.filePath === docA)!.id;

    await act(async () => {
      largeReaderHandle.current?.setScrollTop(520);
      app.host.querySelector('.large-reader-container')?.dispatchEvent(new Event('scroll'));
    });

    // 切到另一个大文档 B
    await app.openFile(docB);
    await waitFor(
      () => app.host.querySelector('.large-reader-body')?.textContent?.includes('Entry B') ?? false,
      '未切换到大文档 B',
    );
    expect(useStore.getState().tabs.find((t) => t.id === tabAId)!.wysiwygScrollTop).toBe(520);

    // 滚动大文档 B 后切换到普通小文档（卸载 LargeMarkdownReader）
    const tabBId = useStore.getState().tabs.find((t) => t.filePath === docB)!.id;
    await act(async () => {
      largeReaderHandle.current?.setScrollTop(840);
      app.host.querySelector('.large-reader-container')?.dispatchEvent(new Event('scroll'));
    });
    await app.openFile(docSmall);
    await waitFor(() => !app.host.querySelector('.large-reader-body'), '未切到普通文档');
    expect(useStore.getState().tabs.find((t) => t.id === tabBId)!.wysiwygScrollTop).toBe(840);

    // 切回大文档 A 时恢复 520 滚动位置
    await act(async () => {
      useStore.getState().setActiveTab(tabAId);
    });
    await waitFor(
      () => app.host.querySelector('.large-reader-body')?.textContent?.includes('Entry A') ?? false,
      '未切回大文档 A',
    );
    expect(app.host.querySelector('.large-reader-container')?.scrollTop).toBe(520);
  });

  it('在包含未挂载占位片段的大文档只读视图中全选并复制，输出完整原文而非仅首屏片段', async () => {
    const largePath = 'D:/docs/huge-copy-all.md';
    const lines = Array.from({ length: 400 }, (_, i) => `- Row ${i} ${'c'.repeat(3000)}`);
    const largeContent = `# Copy Full\n\n${lines.join('\n')}`;
    const twoChunkLines = Array.from({ length: 70 }, (_, i) => `- Item ${i} ${'d'.repeat(16000)}`);
    const twoChunkContent = twoChunkLines.join('\n\n');
    const twoChunkPath = 'D:/docs/two-chunks-partial.md';
    const app = mountApp({ [largePath]: largeContent, [twoChunkPath]: twoChunkContent }, 'wysiwyg');
    await app.start();
    await app.openFile(largePath);
    await waitFor(() => !!app.host.querySelector('.large-reader-body'), '未加载只读预览');
    // 确认确实存在未挂载占位片段
    expect(
      app.host.querySelectorAll('.large-reader-chunk[data-mounted="0"]').length,
    ).toBeGreaterThan(0);

    const readerBody = app.host.querySelector('.large-reader-body') as HTMLElement;
    await act(async () => {
      readerBody.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
      );
    });

    const setDataSpy = vi.fn();
    const copyEvent = Object.assign(new Event('copy', { bubbles: true, cancelable: true }), {
      clipboardData: { setData: setDataSpy },
    });
    await act(async () => {
      readerBody.dispatchEvent(copyEvent);
    });

    expect(copyEvent.defaultPrevented).toBe(true);
    expect(setDataSpy).toHaveBeenCalledWith('text/plain', largeContent);
    expect(largeReaderHandle.current?.getSelectedText()).toBe(largeContent);

    // 仅从首段某节点开头到末段中间位置的部分选区，不得被误判为整篇全选
    await app.openFile(twoChunkPath);
    await waitFor(() => !!app.host.querySelector('.large-reader-body'), '未加载两段文档');
    await act(async () => {
      largeReaderHandle.current?.setScrollTop(1600);
    });
    await waitFor(
      () =>
        app.host.querySelectorAll('.large-reader-chunk[data-mounted="1"]').length === 2 &&
        app.host.querySelectorAll('.large-reader-chunk[data-mounted="0"]').length === 0,
      '两段均应处于挂载状态以验证首末节点精确边界',
    );

    const mountedChunks = Array.from(
      app.host.querySelectorAll('.large-reader-body .large-reader-chunk'),
    );
    const firstChunkItems = mountedChunks[0].querySelectorAll('li');
    const lastChunkItems = mountedChunks[mountedChunks.length - 1].querySelectorAll('li');
    const firstTextNode = (root: Element): Text => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if ((node.textContent ?? '').trim().length >= 10) return node as Text;
        node = walker.nextNode();
      }
      throw new Error('未找到正文文本节点');
    };
    const startNode = firstTextNode(firstChunkItems[1]);
    const endNode = firstTextNode(lastChunkItems[0]);
    const partialRange = document.createRange();
    partialRange.setStart(startNode, 0);
    partialRange.setEnd(endNode, 4);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(partialRange);
    document.dispatchEvent(new Event('selectionchange'));

    const partialSetData = vi.fn();
    const partialCopy = Object.assign(new Event('copy', { bubbles: true, cancelable: true }), {
      clipboardData: { setData: partialSetData },
    });
    const updatedBody = app.host.querySelector('.large-reader-body') as HTMLElement;
    updatedBody.dispatchEvent(partialCopy);
    expect(partialCopy.defaultPrevented).toBe(false);
    expect(partialSetData).not.toHaveBeenCalled();
    expect(largeReaderHandle.current?.getSelectedText()).not.toBe(twoChunkContent);
  });

  it('源码切入大文档只读阅读模式后通过文件树重命名，保留完整正文且不读取隐藏 Milkdown', async () => {
    const docPath = 'D:/docs/rename-big.md';
    const largeContent = `# Keep Content\n\n${'r'.repeat(LARGE_MARKDOWN_THRESHOLD_BYTES + 1024)}`;
    const app = mountApp({ [docPath]: largeContent }, 'source');
    await app.start();
    await app.openFile(docPath);
    await waitFor(
      () => sourceEditorHandle.current?.getValue() === largeContent,
      '未在源码模式装载大文档',
    );

    await act(async () => {
      useStore.setState({ fileTreeVisible: true });
      useStore.getState().setViewMode('wysiwyg');
    });
    await waitFor(() => !!app.host.querySelector('.large-reader-body'), '未切入只读阅读模式');
    expect(fileTreeMocks.onRenameFile).toBeTypeOf('function');

    editorSpies.getMarkdown.mockClear();
    await act(async () => {
      fileTreeMocks.onRenameFile?.({
        name: 'rename-big.md',
        absolutePath: docPath,
        kind: 'file',
      });
    });
    await act(async () => {
      resolvePromptDialog('renamed-big.md');
    });
    await waitFor(
      () => useStore.getState().tabs[0].filePath === 'D:/docs/renamed-big.md',
      '文件树重命名未更新标签路径',
    );

    expect(fileTreeMocks.renameEntry).toHaveBeenCalledTimes(1);
    expect(editorSpies.getMarkdown).not.toHaveBeenCalled();
    expect(useStore.getState().tabs[0].sourceContent).toBe(largeContent);
    expect(useStore.getState().tabs[0].isDirty).toBe(false);
  });
});
