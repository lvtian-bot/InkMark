// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfirmDialog } from '../confirm-dialog';
import { setDiskSnapshot } from '../review/review-store';
import { selectViewMode, useStore } from '../stores/useStore';
import {
  clearRecoveryDraftsBeforeExit,
  resumeRecoveryDrafts,
  useDraftRecovery,
} from './useDraftRecovery';
import { requestUpdateInstall } from '../update-install';
import type { InkMarkAPI } from '../types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const initial = useStore.getState();
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({ ...initial, language: 'zh-CN' });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStore.setState(initial);
  vi.useRealTimers();
});

function Harness() {
  useDraftRecovery();
  return null;
}

describe('正文草稿恢复', () => {
  it('更新安装失败后，未保存正文重新进入草稿保存流程', async () => {
    const save = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const api: Partial<InkMarkAPI> = {
      listRecoveryDrafts: async () => [],
      saveRecoveryDraft: save,
      removeRecoveryDraft: remove,
    };
    Object.defineProperty(window, 'inkmark', { configurable: true, value: api });
    await act(async () => root.render(React.createElement(Harness)));
    const tabId = useStore.getState().addTab({ startPage: false });
    useStore.getState().updateTab(tabId, { isDirty: true, sourceContent: '尚未保存' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(
        await requestUpdateInstall({
          prepareToClose: async () => {
            await clearRecoveryDraftsBeforeExit();
            return true;
          },
          install: async () => false,
          resumeRecoveryDrafts,
        }),
      ).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ content: '尚未保存' }));
  });
  it('编辑时保存草稿，普通保存和进入审阅时清理', async () => {
    const save = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const api: Partial<InkMarkAPI> = {
      listRecoveryDrafts: async () => [],
      saveRecoveryDraft: save,
      removeRecoveryDraft: remove,
    };
    Object.defineProperty(window, 'inkmark', { configurable: true, value: api });
    await act(async () => root.render(React.createElement(Harness)));
    const id = useStore
      .getState()
      .addTab({ filePath: 'D:/note.md', content: '原文', fileMtime: 10 });
    setDiskSnapshot(id, '原文', 10);
    useStore.getState().updateTab(id, { sourceContent: '编辑后', isDirty: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'D:/note.md', baseContent: '原文', content: '编辑后' }),
    );
    useStore.getState().updateTab(id, { isDirty: false });
    await act(async () => {
      await Promise.resolve();
    });
    expect(remove).toHaveBeenCalledTimes(1);
    useStore.getState().updateTab(id, { isDirty: true, sourceContent: '下一次编辑' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    useStore.getState().updateTab(id, { reviewSession: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('原文件变更后恢复为新文档，保留草稿内容', async () => {
    const draft = {
      id: 'draft-1',
      filePath: 'D:/note.md',
      fileMtime: 10,
      baseContent: '原文',
      content: '未保存内容',
    };
    const api: Partial<InkMarkAPI> = {
      listRecoveryDrafts: async () => [draft],
      saveRecoveryDraft: async () => undefined,
      removeRecoveryDraft: async () => undefined,
      openFilePath: async () => ({ path: 'D:/note.md', mtime: 11, content: '外部修改' }),
    };
    Object.defineProperty(window, 'inkmark', { configurable: true, value: api });
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => {
      resolveConfirmDialog(0);
      await Promise.resolve();
    });
    await act(async () => {
      resolveConfirmDialog(0);
      await Promise.resolve();
    });
    const tab = useStore.getState().tabs.find((item) => item.sourceContent === draft.content);
    expect(tab).toMatchObject({
      filePath: null,
      recoveryOriginPath: draft.filePath,
      isDirty: true,
    });
  });

  it('恢复未命名草稿，正常退出前删除本次会话草稿', async () => {
    const draft = {
      id: 'draft-new',
      filePath: null,
      fileMtime: null,
      baseContent: null,
      content: '新文档内容',
    };
    const remove = vi.fn(async () => undefined);
    const api: Partial<InkMarkAPI> = {
      listRecoveryDrafts: async () => [draft],
      saveRecoveryDraft: async () => undefined,
      removeRecoveryDraft: remove,
    };
    Object.defineProperty(window, 'inkmark', { configurable: true, value: api });
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => {
      resolveConfirmDialog(0);
      await Promise.resolve();
    });
    expect(
      useStore.getState().tabs.find((tab) => tab.sourceContent === draft.content),
    ).toMatchObject({ filePath: null, isDirty: true });
    await act(async () => {
      await clearRecoveryDraftsBeforeExit();
    });
    expect(remove).toHaveBeenCalledWith(draft.id);
  });

  it('恢复发生外部变化的代码文件时保持源码模式', async () => {
    const draft = {
      id: 'code-1',
      filePath: 'D:/note.ts',
      fileMtime: 1,
      baseContent: 'old',
      content: 'const x = 1;',
    };
    const api: Partial<InkMarkAPI> = {
      listRecoveryDrafts: async () => [draft],
      saveRecoveryDraft: async () => undefined,
      removeRecoveryDraft: async () => undefined,
      openFilePath: async () => ({ path: draft.filePath, mtime: 2, content: 'changed' }),
    };
    Object.defineProperty(window, 'inkmark', { configurable: true, value: api });
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => {
      resolveConfirmDialog(0);
      await Promise.resolve();
    });
    await act(async () => {
      resolveConfirmDialog(0);
      await Promise.resolve();
    });
    const state = useStore.getState();
    expect(state.tabs.find((tab) => tab.id === state.activeTabId)).toMatchObject({
      filePath: null,
      recoveryOriginPath: draft.filePath,
      sourceContent: draft.content,
    });
    expect(selectViewMode(state)).toBe('source');
  });

  it('无关状态变化不会重复写草稿，清理失败后退出可重试', async () => {
    const save = vi.fn(async () => undefined);
    const remove = vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValue(undefined);
    const api: Partial<InkMarkAPI> = {
      listRecoveryDrafts: async () => [],
      saveRecoveryDraft: save,
      removeRecoveryDraft: remove,
    };
    Object.defineProperty(window, 'inkmark', { configurable: true, value: api });
    await act(async () => root.render(React.createElement(Harness)));
    const tabId = useStore.getState().addTab({ startPage: false });
    useStore.getState().updateTab(tabId, { sourceContent: 'text', isDirty: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    useStore.getState().updateTab(tabId, { wordCount: 8 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).toHaveBeenCalledTimes(1);
    useStore.getState().updateTab(tabId, { isDirty: false });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await clearRecoveryDraftsBeforeExit();
    });
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
