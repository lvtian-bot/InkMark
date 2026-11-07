// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceEditor } from '../components/SourceEditor';
import { editorStateCache } from '../editor-state-cache';
import { resolveConfirmDialog, useConfirmDialogState } from '../confirm-dialog';
import { getDiskSnapshot, setDiskSnapshot } from '../review/review-store';
import { sourceEditorHandle } from '../source-editor-ref';
import { useStore } from '../stores/useStore';
import { I18nProvider } from '../i18n';
import type { InkMarkAPI, SaveAsResponse, ViewMode } from '../types';
import { useFile } from './useFile';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const initialState = useStore.getState();
const original = '# 纪要\n\n![图片](旧名称.assets/photo.png)\n';
const rewritten = '# 纪要\n\n![图片](副本.assets/photo.png)\n';
const originalPath = 'D:/notes/新名称.md';
const copiedPath = 'D:/copies/副本.md';
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let operations: ReturnType<typeof useFile> | undefined;

function fileOps(): ReturnType<typeof useFile> {
  if (!operations) throw new Error('文件操作未挂载');
  return operations;
}

async function mount(mode: ViewMode = 'source', path: string | null = originalPath) {
  useStore.setState({ ...initialState, autoSave: false, language: 'zh-CN', viewMode: mode });
  const tabId = useStore.getState().addTab({
    filePath: path,
    content: original,
    fileMtime: 1,
    startPage: false,
  });
  setDiskSnapshot(tabId, original, 1);
  const saveFileAs = vi.fn<InkMarkAPI['saveFileAs']>(async () => ({
    path: copiedPath,
    content: rewritten,
    mtime: 2,
  }));
  const saveReviewCopy = vi.fn<InkMarkAPI['saveReviewCopy']>(saveFileAs);
  const saveFile = vi.fn<InkMarkAPI['saveFile']>(async () => ({ status: 'ok', mtime: 3 }));
  const api: Partial<InkMarkAPI> = {
    platform: 'win32',
    saveFileAs,
    saveReviewCopy,
    saveFile,
    onFileWatchEvent: () => () => undefined,
    watchFile: () => undefined,
    unwatchFile: () => undefined,
  };
  Object.defineProperty(window, 'inkmark', { configurable: true, value: api });
  const setMarkdown = vi.fn(() => false);
  function Harness() {
    const viewMode = useStore((state) => state.viewMode);
    operations = useFile(setMarkdown, viewMode, () => undefined);
    const confirmation = useConfirmDialogState();
    return React.createElement(
      I18nProvider,
      null,
      React.createElement('p', { 'data-confirmation': true }, confirmation?.message),
      viewMode === 'source'
        ? React.createElement(SourceEditor, {
            onChange: () => undefined,
            onFollowLink: () => undefined,
          })
        : null,
    );
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(React.createElement(Harness)));
  return { tabId, saveFileAs, saveReviewCopy, saveFile, setMarkdown };
}

afterEach(async () => {
  resolveConfirmDialog(0);
  await act(async () => root?.unmount());
  host?.remove();
  for (const tab of useStore.getState().tabs) editorStateCache.dispose(tab.id);
  useStore.setState(initialState);
  root = undefined;
  host = undefined;
  operations = undefined;
  vi.restoreAllMocks();
});

describe('另存后的正文与标签同步', () => {
  it('恢复为新文档的内容另存时保留图片来源路径', async () => {
    const { tabId, saveFileAs } = await mount('source', null);
    await act(async () => {
      useStore.getState().updateTab(tabId, {
        recoveryOriginPath: originalPath,
        isDirty: true,
      });
      await fileOps().saveAs();
    });
    expect(saveFileAs).toHaveBeenCalledWith(original, originalPath);
    expect(useStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      filePath: copiedPath,
      recoveryOriginPath: null,
    });
  });

  it('普通另存将改写后的图片路径同步到真源、磁盘基线和真实源码编辑器，再次保存不写回旧路径', async () => {
    const { tabId, saveFile } = await mount();
    await act(async () => fileOps().saveAs());
    expect(useStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      filePath: copiedPath,
      sourceContent: rewritten,
      isDirty: false,
      fileMtime: 2,
    });
    expect(getDiskSnapshot(tabId)).toEqual({ content: rewritten, mtime: 2 });
    expect(sourceEditorHandle.current?.getValue()).toBe(rewritten);
    await act(async () => fileOps().save());
    expect(saveFile).toHaveBeenCalledWith(rewritten, copiedPath, 2);
  });

  it('所见即所得装载回调不能用重新序列化的排版覆盖实际落盘原文', async () => {
    const { tabId, setMarkdown } = await mount('wysiwyg');
    setMarkdown.mockImplementation(() => {
      // 对应 Editor.setMarkdown → App.handleDocChange 的同步回填接缝。
      useStore.getState().setSourceContent(rewritten.replaceAll('\n\n', '\n'));
      fileOps().markDirty();
      return true;
    });
    await act(async () => fileOps().saveAs());
    expect(setMarkdown).toHaveBeenCalledWith(rewritten);
    expect(useStore.getState().tabs.find((tab) => tab.id === tabId)?.sourceContent).toBe(rewritten);
  });

  it('首次保存的新标签也使用实际落盘正文', async () => {
    const { tabId } = await mount('source', null);
    await act(async () => fileOps().save());
    expect(useStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      sourceContent: rewritten,
      filePath: copiedPath,
      isDirty: false,
    });
    expect(sourceEditorHandle.current?.getValue()).toBe(rewritten);
  });

  it('审阅副本也接收实际落盘正文后再结束审阅', async () => {
    const { tabId, saveReviewCopy } = await mount();
    await act(async () => {
      useStore
        .getState()
        .updateTab(tabId, { reviewSession: true, pendingReviewCount: 0, isDirty: true });
    });
    await act(async () => fileOps().saveAs());
    expect(saveReviewCopy).toHaveBeenCalledWith(original, originalPath);
    expect(useStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      filePath: copiedPath,
      sourceContent: rewritten,
      reviewSession: false,
      isDirty: false,
    });
    expect(getDiskSnapshot(tabId)).toEqual({ content: rewritten, mtime: 2 });
  });

  it.each([false, true])('图片复制失败保留原正文与路径，审阅会话状态为 %s', async (reviewing) => {
    const { tabId, saveFileAs, saveReviewCopy } = await mount();
    const failure = {
      status: 'error',
      code: 'image-copy-failed',
      message: '找不到本地图片。',
    } as const;
    saveFileAs.mockResolvedValue(failure);
    saveReviewCopy.mockResolvedValue(failure);
    await act(async () => {
      useStore.getState().updateTab(tabId, { reviewSession: reviewing, isDirty: true });
    });
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = fileOps().saveAs();
    });
    expect(host?.textContent).toContain('找不到本地图片。');
    expect(useStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      filePath: originalPath,
      sourceContent: original,
      reviewSession: reviewing,
      isDirty: true,
      fileMtime: 1,
    });
    expect(getDiskSnapshot(tabId)).toEqual({ content: original, mtime: 1 });
    await act(async () => {
      resolveConfirmDialog(0);
      await pending;
    });
  });

  it('等待另存时修改了正文，不把旧快照的路径改写覆盖到新内容', async () => {
    const { tabId, saveFileAs } = await mount();
    let finish: ((response: SaveAsResponse) => void) | undefined;
    saveFileAs.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = fileOps().saveAs();
    });
    await act(async () => {
      useStore.getState().updateTab(tabId, { sourceContent: original + '新增正文', isDirty: true });
      finish?.({ path: copiedPath, content: rewritten, mtime: 2 });
      await pending;
    });
    expect(useStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      filePath: originalPath,
      sourceContent: original + '新增正文',
      isDirty: true,
    });
    expect(getDiskSnapshot(tabId)).toEqual({ content: original, mtime: 1 });
  });

  it('等待另存时切换标签，只更新原标签，不向当前编辑器装入另一份正文', async () => {
    const { tabId, saveFileAs, setMarkdown } = await mount('wysiwyg');
    let finish: ((response: SaveAsResponse) => void) | undefined;
    saveFileAs.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = fileOps().saveAs();
    });
    let secondTabId = '';
    await act(async () => {
      secondTabId = useStore.getState().addTab({ filePath: 'D:/other.md', content: '其他文档' });
      finish?.({ path: copiedPath, content: rewritten, mtime: 2 });
      await pending;
    });
    expect(useStore.getState().tabs.find((tab) => tab.id === tabId)?.sourceContent).toBe(rewritten);
    expect(useStore.getState().tabs.find((tab) => tab.id === secondTabId)?.sourceContent).toBe(
      '其他文档',
    );
    expect(setMarkdown).not.toHaveBeenCalled();
  });
});
