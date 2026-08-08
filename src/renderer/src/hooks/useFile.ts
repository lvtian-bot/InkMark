import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { editorStateCache } from '../editor-state-cache';
import { confirmDialog } from '../confirm-dialog';
import type { FileResult, FileWatchEvent } from '../types';

function filePathKey(path: string): string {
  return window.inkmark.platform === 'win32' ? path.toLowerCase() : path;
}

export function useFile(
  getMarkdown: () => string,
  setMarkdown: (md: string) => boolean,
  sourceRef: React.RefObject<HTMLTextAreaElement | null>,
  viewMode: 'wysiwyg' | 'source',
) {
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

  const stateRef = useRef({ tabs, activeTabId, getMarkdown, setMarkdown, sourceRef, viewMode });
  useEffect(() => {
    stateRef.current = { tabs, activeTabId, getMarkdown, setMarkdown, sourceRef, viewMode };
  });

  const getTabMarkdown = useCallback((tabId: string): string => {
    const s = stateRef.current;
    if (tabId === s.activeTabId) {
      if (s.viewMode === 'source' && s.sourceRef.current) {
        return s.sourceRef.current.value;
      }
      return s.getMarkdown();
    }
    const tab = s.tabs.find((t) => t.id === tabId);
    return tab?.sourceContent ?? '';
  }, []);

  const saveTab = useCallback(
    async (tabId: string): Promise<boolean> => {
      const s = stateRef.current;
      const tab = s.tabs.find((t) => t.id === tabId);
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
          const choice = await confirmDialog(
            '文件已被外部修改',
            `"${tab.fileName}" 已被其他程序修改，是否覆盖？`,
            ['覆盖', '取消'],
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
        saveAsResult = await window.inkmark.saveFileAs(content);
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
        editorStateCache.delete(activeTab.id);
        suppressDirtyRef.current = true;
        if (!s.setMarkdown(result.content)) {
          suppressDirtyRef.current = false;
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
    await saveTab(stateRef.current.activeTabId);
  }, [saveTab]);

  const saveAs = useCallback(async () => {
    const s = stateRef.current;
    const content = getTabMarkdown(s.activeTabId);
    let result;
    try {
      result = await window.inkmark.saveFileAs(content);
    } catch {
      await confirmDialog('保存失败', '文件保存失败，请重试。', ['确定']);
      return;
    }
    if (result) {
      missingNotifiedTabIdsRef.current.delete(s.activeTabId);
      updateTab(s.activeTabId, {
        filePath: result.path,
        fileName: result.path.split(/[/\\]/).pop()!,
        isDirty: false,
        fileMtime: result.mtime,
      });
    }
  }, [getTabMarkdown, updateTab]);

  const closeTab = useCallback(
    async (tabId?: string): Promise<boolean> => {
      const s = stateRef.current;
      const id = tabId ?? s.activeTabId;
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return false;

      if (tab.isDirty) {
        const choice = await confirmDialog('未保存的更改', `是否保存"${tab.fileName}"的更改？`, [
          '保存',
          '不保存',
          '取消',
        ]);
        if (choice === 2) return false;
        if (choice === 0) {
          const saved = await saveTab(id);
          if (!saved) return false;
        }
      }

      editorStateCache.delete(id);

      if (s.tabs.length <= 1) {
        await window.inkmark.closeWindow();
        return true;
      }

      closeTabStore(id);
      return true;
    },
    [saveTab, closeTabStore],
  );

  const closeWindow = useCallback(async (): Promise<boolean> => {
    const s = stateRef.current;
    const dirtyTabs = s.tabs.filter((t) => t.isDirty);
    for (const tab of dirtyTabs) {
      const choice = await confirmDialog('未保存的更改', `是否保存"${tab.fileName}"的更改？`, [
        '保存',
        '不保存',
        '取消',
      ]);
      if (choice === 2) return false;
      if (choice === 0) {
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
      editorStateCache.delete(tabId);
      suppressDirtyRef.current = true;
      if (tabId === current.activeTabId) {
        if (!current.setMarkdown(result.content)) {
          suppressDirtyRef.current = false;
        }
        if (current.viewMode === 'source' && current.sourceRef.current) {
          current.sourceRef.current.value = result.content;
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
            if (!currentTab?.filePath || res.mtime === currentTab.fileMtime) continue;

            if (currentTab.isDirty) {
              const choice = await confirmDialog(
                '文件已被外部修改',
                `"${currentTab.fileName}" 已被其他程序修改，是否放弃当前未保存的改动并重载？`,
                ['重载', '保留我的改动'],
              );
              if (choice === 0) {
                const reloaded = await reloadTab(currentTab.id);
                if (!reloaded) {
                  const latestTab = stateRef.current.tabs.find((tab) => tab.id === currentTab.id);
                  if (latestTab) await notifyMissingFile(latestTab.id, latestTab.fileName);
                }
              } else {
                updateTab(currentTab.id, { fileMtime: res.mtime });
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
    [notifyMissingFile, reloadTab, updateTab],
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
