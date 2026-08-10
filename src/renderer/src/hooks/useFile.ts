import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { editorStateCache } from '../editor-state-cache';
import { confirmDialog } from '../confirm-dialog';
import { isImageUploadInProgress, waitForImageUploads } from '../image-upload';
import { sourceEditorHandle } from '../source-editor-ref';
import { buildConflictDiff } from '../conflict-diff';
import {
  decideCloseDirty,
  decideExternalChange,
  resolveConflictChoice,
} from '../file-conflict-decision';
import type { FileResult, FileWatchEvent, ViewMode } from '../types';

function filePathKey(path: string): string {
  return window.inkmark.platform === 'win32' ? path.toLowerCase() : path;
}

export function useFile(setMarkdown: (md: string) => boolean, viewMode: ViewMode) {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const addTab = useStore((s) => s.addTab);
  const closeTabStore = useStore((s) => s.closeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const updateTab = useStore((s) => s.updateTab);
  const setDirty = useStore((s) => s.setDirty);

  const suppressDirtyRef = useRef(false);
  const checkingRef = useRef(false);
  const pendingFullCheckRef = useRef(false);
  const pendingWatchEventsRef = useRef(new Map<string, FileWatchEvent>());
  const watchedPathsRef = useRef(new Map<string, string>());
  const missingNotifiedTabIdsRef = useRef(new Set<string>());

  const stateRef = useRef({ tabs, activeTabId, setMarkdown, viewMode });
  useEffect(() => {
    stateRef.current = { tabs, activeTabId, setMarkdown, viewMode };
  });

  const getTabMarkdown = useCallback((tabId: string): string => {
    const tab = useStore.getState().tabs.find((t) => t.id === tabId);
    return tab?.sourceContent ?? '';
  }, []);

  const saveTab = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = useStore.getState().tabs.find((t) => t.id === tabId);
      if (!tab) return false;

      const content = getTabMarkdown(tabId);

      if (tab.filePath) {
        let result;
        try {
          result = await window.inkmark.saveFile(content, tab.filePath, tab.fileMtime);
        } catch {
          await confirmDialog(
            '保存失败',
            `"${tab.fileName}" 保存失败，请检查文件是否被设为只读或磁盘空间是否充足。`,
            ['确定'],
          );
          return false;
        }
        if (result.status === 'conflict') {
          const diskVersion = await window.inkmark.openFilePath(tab.filePath);
          const choice = await confirmDialog(
            '文件已被外部修改',
            `下方显示磁盘版本与当前编辑版本的差异。覆盖后，磁盘上的外部修改将被替换。`,
            ['覆盖磁盘版本', '取消'],
            {
              defaultId: 1,
              cancelId: 1,
              diff: diskVersion ? buildConflictDiff(diskVersion.content, content) : undefined,
            },
          );
          if (choice !== 0) return false;
          let forceResult;
          try {
            forceResult = await window.inkmark.saveFile(content, tab.filePath, null, true);
          } catch {
            await confirmDialog('保存失败', `"${tab.fileName}" 保存失败。`, ['确定']);
            return false;
          }
          if (forceResult.status === 'ok') {
            missingNotifiedTabIdsRef.current.delete(tabId);
            updateTab(tabId, { isDirty: false, fileMtime: forceResult.mtime });
            return true;
          }
          return false;
        }
        missingNotifiedTabIdsRef.current.delete(tabId);
        updateTab(tabId, { isDirty: false, fileMtime: result.mtime });
        return true;
      }

      let saveAsResult;
      try {
        saveAsResult = await window.inkmark.saveFileAs(content, tab.filePath);
      } catch {
        await confirmDialog('保存失败', `"${tab.fileName}" 保存失败。`, ['确定']);
        return false;
      }
      if (saveAsResult) {
        missingNotifiedTabIdsRef.current.delete(tabId);
        updateTab(tabId, {
          filePath: saveAsResult.path,
          fileName: saveAsResult.path.split(/[/\\]/).pop()!,
          isDirty: false,
          fileMtime: saveAsResult.mtime,
        });
        return true;
      }
      return false;
    },
    [getTabMarkdown, updateTab],
  );

  const newFile = useCallback(() => {
    addTab();
  }, [addTab]);

  const openFileResult = useCallback(
    async (result: FileResult): Promise<void> => {
      const s = stateRef.current;
      const { tabs, activeTabId } = useStore.getState();
      const existing = tabs.find((t) => t.filePath === result.path);
      if (existing) {
        setActiveTab(existing.id);
        return;
      }

      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (
        activeTab &&
        !activeTab.filePath &&
        !activeTab.isDirty &&
        activeTab.sourceContent === ''
      ) {
        editorStateCache.dispose(activeTab.id);
        suppressDirtyRef.current = true;
        if (!s.setMarkdown(result.content)) {
          suppressDirtyRef.current = false;
        }
        if (s.viewMode === 'source') {
          sourceEditorHandle.current?.setValue(result.content);
        }
        updateTab(activeTab.id, {
          filePath: result.path,
          fileName: result.path.split(/[/\\]/).pop()!,
          sourceContent: result.content,
          fileMtime: result.mtime,
          isStartPage: false,
        });
        return;
      }

      addTab({ filePath: result.path, content: result.content, fileMtime: result.mtime });
    },
    [addTab, setActiveTab, updateTab],
  );

  const openFile = useCallback(async () => {
    let results;
    try {
      results = await window.inkmark.openFileDialog();
    } catch {
      await confirmDialog('打开失败', '无法打开文件对话框，请重试。', ['确定']);
      return;
    }
    if (!results || results.length === 0) return;
    for (const result of results) {
      await openFileResult(result);
    }
  }, [openFileResult]);

  const openFilePath = useCallback(
    async (path: string) => {
      let result;
      try {
        result = await window.inkmark.openFilePath(path);
      } catch {
        await confirmDialog('打开失败', `"${path}" 无法打开。`, ['确定']);
        return;
      }
      if (!result) {
        await confirmDialog('打开失败', `"${path}" 可能已被删除或移动。`, ['确定']);
        return;
      }
      await openFileResult(result);
    },
    [openFileResult],
  );

  const save = useCallback(async () => {
    await saveTab(useStore.getState().activeTabId);
  }, [saveTab]);

  const saveAs = useCallback(async () => {
    if (isImageUploadInProgress()) {
      await confirmDialog('图片正在保存', '请等待图片插入完成后再另存文档。', ['确定']);
      return;
    }
    const currentState = useStore.getState();
    const content = getTabMarkdown(currentState.activeTabId);
    let result;
    try {
      const activeTab = currentState.tabs.find((tab) => tab.id === currentState.activeTabId);
      result = await window.inkmark.saveFileAs(content, activeTab?.filePath);
    } catch {
      await confirmDialog('保存失败', '文件保存失败，请重试。', ['确定']);
      return;
    }
    if (result) {
      missingNotifiedTabIdsRef.current.delete(currentState.activeTabId);
      updateTab(currentState.activeTabId, {
        filePath: result.path,
        fileName: result.path.split(/[/\\]/).pop()!,
        isDirty: false,
        fileMtime: result.mtime,
      });
    }
  }, [getTabMarkdown, updateTab]);

  const closeTab = useCallback(
    async (tabId?: string): Promise<boolean> => {
      const currentState = useStore.getState();
      const id = tabId ?? currentState.activeTabId;
      if (id === currentState.activeTabId && isImageUploadInProgress()) {
        await confirmDialog('图片正在保存', '请等待图片插入完成后再关闭文档。', ['确定']);
        return false;
      }
      const tab = currentState.tabs.find((t) => t.id === id);
      if (!tab) return false;

      if (tab.isDirty) {
        const choice = await confirmDialog('未保存的更改', `是否保存"${tab.fileName}"的更改？`, [
          '保存',
          '不保存',
          '取消',
        ]);
        const closeDecision = decideCloseDirty({ isDirty: true, choice });
        if (closeDecision === 'cancel') return false;
        if (closeDecision === 'save') {
          const saved = await saveTab(id);
          if (!saved) return false;
        }
      }

      editorStateCache.dispose(id);

      // 关闭最后一个标签页时回到欢迎页，而非关闭整个窗口；
      // store 的 closeTab 会在标签页清空后自动新建一个欢迎页标签页。
      closeTabStore(id);
      return true;
    },
    [saveTab, closeTabStore],
  );

  const closeWindow = useCallback(async (): Promise<boolean> => {
    if (isImageUploadInProgress()) {
      await confirmDialog('图片正在保存', '请等待图片插入完成后再关闭窗口。', ['确定']);
      return false;
    }
    const dirtyTabs = useStore.getState().tabs.filter((t) => t.isDirty);
    for (const tab of dirtyTabs) {
      const choice = await confirmDialog('未保存的更改', `是否保存"${tab.fileName}"的更改？`, [
        '保存',
        '不保存',
        '取消',
      ]);
      const closeDecision = decideCloseDirty({ isDirty: true, choice });
      if (closeDecision === 'cancel') return false;
      if (closeDecision === 'save') {
        const saved = await saveTab(tab.id);
        if (!saved) return false;
      }
    }
    await window.inkmark.closeWindow();
    return true;
  }, [saveTab]);

  const markDirty = useCallback(() => {
    if (suppressDirtyRef.current) {
      suppressDirtyRef.current = false;
      return;
    }
    setDirty(true);
  }, [setDirty]);

  const reloadTab = useCallback(
    async (tabId: string): Promise<boolean> => {
      const s = stateRef.current;
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab?.filePath) return false;
      let result;
      try {
        result = await window.inkmark.openFilePath(tab.filePath);
      } catch {
        return false;
      }
      if (!result) return false;
      const current = stateRef.current;
      if (!current.tabs.some((currentTab) => currentTab.id === tabId)) return false;
      editorStateCache.dispose(tabId);
      suppressDirtyRef.current = true;
      if (tabId === current.activeTabId) {
        if (!current.setMarkdown(result.content)) {
          suppressDirtyRef.current = false;
        }
        if (current.viewMode === 'source') {
          sourceEditorHandle.current?.setValue(result.content);
        }
      } else {
        suppressDirtyRef.current = false;
      }
      updateTab(tabId, {
        sourceContent: result.content,
        fileMtime: result.mtime,
        isDirty: false,
      });
      missingNotifiedTabIdsRef.current.delete(tabId);
      return true;
    },
    [updateTab],
  );

  const notifyMissingFile = useCallback(async (tabId: string, fileName: string): Promise<void> => {
    if (missingNotifiedTabIdsRef.current.has(tabId)) return;
    missingNotifiedTabIdsRef.current.add(tabId);
    await confirmDialog(
      '文件已被删除或移动',
      `"${fileName}" 已不在原位置。你可以保留当前标签页，并使用“另存为”保存内容。`,
      ['确定'],
    );
  }, []);

  const checkExternalChanges = useCallback(
    async (watchEvent?: FileWatchEvent): Promise<void> => {
      if (watchEvent) {
        pendingWatchEventsRef.current.set(filePathKey(watchEvent.path), watchEvent);
      } else {
        pendingFullCheckRef.current = true;
      }
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        while (pendingFullCheckRef.current || pendingWatchEventsRef.current.size > 0) {
          await waitForImageUploads();
          const checkAll = pendingFullCheckRef.current;
          pendingFullCheckRef.current = false;
          const watchEvents = new Map(pendingWatchEventsRef.current);
          pendingWatchEventsRef.current.clear();
          const snapshot = stateRef.current.tabs;
          const tabsToCheck = checkAll
            ? snapshot
            : snapshot.filter((tab) => tab.filePath && watchEvents.has(filePathKey(tab.filePath)));

          for (const snapshotTab of tabsToCheck) {
            if (!snapshotTab.filePath || snapshotTab.fileMtime == null) continue;
            const event = watchEvents.get(filePathKey(snapshotTab.filePath));
            if (event?.status === 'missing') {
              await notifyMissingFile(snapshotTab.id, snapshotTab.fileName);
              continue;
            }

            const res =
              event?.mtime != null
                ? ({ status: 'ok', mtime: event.mtime } as const)
                : await window.inkmark.getFileMtime(snapshotTab.filePath);
            if (res.status === 'error') {
              await notifyMissingFile(snapshotTab.id, snapshotTab.fileName);
              continue;
            }

            missingNotifiedTabIdsRef.current.delete(snapshotTab.id);
            const currentTab = stateRef.current.tabs.find((tab) => tab.id === snapshotTab.id);
            if (!currentTab?.filePath) continue;
            const changeDecision = decideExternalChange({
              fileMtime: currentTab.fileMtime,
              diskMtime: res.mtime,
              isDirty: currentTab.isDirty,
            });
            if (changeDecision === 'noop') continue;

            if (changeDecision === 'conflict') {
              const diskVersion = await window.inkmark.openFilePath(currentTab.filePath);
              if (!diskVersion) {
                await notifyMissingFile(currentTab.id, currentTab.fileName);
                continue;
              }
              const choice = await confirmDialog(
                '文件已被外部修改',
                `下方显示磁盘版本与当前编辑版本的差异。请选择使用哪个版本。`,
                ['使用磁盘版本', '保留并在下次保存时覆盖', '取消'],
                {
                  defaultId: 2,
                  cancelId: 2,
                  diff: buildConflictDiff(diskVersion.content, getTabMarkdown(currentTab.id)),
                },
              );
              const conflictAction = resolveConflictChoice(choice);
              if (conflictAction === 'reload') {
                const reloaded = await reloadTab(currentTab.id);
                if (!reloaded) {
                  const latestTab = stateRef.current.tabs.find((tab) => tab.id === currentTab.id);
                  if (latestTab) await notifyMissingFile(latestTab.id, latestTab.fileName);
                }
              } else if (conflictAction === 'keep-and-override') {
                updateTab(currentTab.id, { fileMtime: diskVersion.mtime });
              }
            } else {
              const reloaded = await reloadTab(currentTab.id);
              if (!reloaded) {
                const latestTab = stateRef.current.tabs.find((tab) => tab.id === currentTab.id);
                if (latestTab) await notifyMissingFile(latestTab.id, latestTab.fileName);
              }
            }
          }
        }
      } finally {
        checkingRef.current = false;
      }
    },
    [getTabMarkdown, notifyMissingFile, reloadTab, updateTab],
  );

  useEffect(() => {
    return window.inkmark.onFileWatchEvent((event) => {
      void checkExternalChanges(event);
    });
  }, [checkExternalChanges]);

  useEffect(() => {
    const desiredPaths = new Map<string, string>();
    for (const tab of tabs) {
      if (tab.filePath) desiredPaths.set(filePathKey(tab.filePath), tab.filePath);
    }

    for (const [key, path] of watchedPathsRef.current) {
      if (!desiredPaths.has(key)) {
        window.inkmark.unwatchFile(path);
        watchedPathsRef.current.delete(key);
      }
    }
    for (const [key, path] of desiredPaths) {
      if (!watchedPathsRef.current.has(key)) {
        window.inkmark.watchFile(path);
        watchedPathsRef.current.set(key, path);
      }
    }

    const liveTabIds = new Set(tabs.map((tab) => tab.id));
    for (const tabId of missingNotifiedTabIdsRef.current) {
      if (!liveTabIds.has(tabId)) missingNotifiedTabIdsRef.current.delete(tabId);
    }
  }, [tabs]);

  useEffect(
    () => () => {
      for (const path of watchedPathsRef.current.values()) {
        window.inkmark.unwatchFile(path);
      }
      watchedPathsRef.current.clear();
    },
    [],
  );

  return useMemo(
    () => ({
      newFile,
      openFile,
      openFilePath,
      save,
      saveAs,
      closeTab,
      closeWindow,
      markDirty,
      checkExternalChanges,
    }),
    [
      newFile,
      openFile,
      openFilePath,
      save,
      saveAs,
      closeTab,
      closeWindow,
      markDirty,
      checkExternalChanges,
    ],
  );
}
