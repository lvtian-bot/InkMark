import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { editorStateCache } from '../editor-state-cache';
import { confirmDialog } from '../confirm-dialog';

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
        const result = await window.inkmark.saveFile(content, tab.filePath, tab.fileMtime);
        if (result.status === 'conflict') {
          const choice = await confirmDialog(
            '文件已被外部修改',
            `"${tab.fileName}" 已被其他程序修改，是否覆盖？`,
            ['覆盖', '取消'],
          );
          if (choice !== 0) return false;
          const forceResult = await window.inkmark.saveFile(content, tab.filePath, null, true);
          if (forceResult.status === 'ok') {
            updateTab(tabId, { isDirty: false, fileMtime: forceResult.mtime });
            return true;
          }
          return false;
        }
        updateTab(tabId, { isDirty: false, fileMtime: result.mtime });
        return true;
      }

      const saveAsResult = await window.inkmark.saveFileAs(content);
      if (saveAsResult) {
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

  const openFile = useCallback(async () => {
    const result = await window.inkmark.openFileDialog();
    if (!result) return;
    const s = stateRef.current;
    const existing = s.tabs.find((t) => t.filePath === result.path);
    if (existing) {
      setActiveTab(existing.id);
      return;
    }

    const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
    if (activeTab && !activeTab.filePath && !activeTab.isDirty && activeTab.sourceContent === '') {
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
 }, [addTab, setActiveTab, updateTab]);

  const openFilePath = useCallback(
    async (path: string) => {
      const s = stateRef.current;
      const existing = s.tabs.find((t) => t.filePath === path);
      if (existing) {
        setActiveTab(existing.id);
        return;
      }

   const result = await window.inkmark.openFilePath(path);
   if (!result) return;

   const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
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

  const save = useCallback(async () => {
    await saveTab(stateRef.current.activeTabId);
  }, [saveTab]);

  const saveAs = useCallback(async () => {
    const s = stateRef.current;
    const content = getTabMarkdown(s.activeTabId);
    const result = await window.inkmark.saveFileAs(content);
    if (result) {
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
    async (tabId: string): Promise<void> => {
      const s = stateRef.current;
      const tab = s.tabs.find((t) => t.id === tabId);
     if (!tab?.filePath) return;
     const result = await window.inkmark.openFilePath(tab.filePath);
     if (!result) return;
      editorStateCache.delete(tabId);
     suppressDirtyRef.current = true;
      if (tabId === s.activeTabId) {
        if (!s.setMarkdown(result.content)) {
          suppressDirtyRef.current = false;
        }
        if (s.viewMode === 'source' && s.sourceRef.current) {
          s.sourceRef.current.value = result.content;
        }
      }
      updateTab(tabId, {
        sourceContent: result.content,
        fileMtime: result.mtime,
        isDirty: false,
      });
    },
    [updateTab],
  );

  const checkExternalChanges = useCallback(async (): Promise<void> => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const s = stateRef.current;
      await Promise.all(
        s.tabs.map(async (tab) => {
          if (!tab.filePath || tab.fileMtime == null) return;
          const res = await window.inkmark.getFileMtime(tab.filePath);
          if (res.status === 'ok' && res.mtime !== tab.fileMtime) {
            if (tab.isDirty) {
              const choice = await confirmDialog(
                '文件已被外部修改',
                `"${tab.fileName}" 已被其他程序修改，是否放弃当前未保存的改动并重载？`,
                ['重载', '保留我的改动'],
              );
              if (choice === 0) {
                await reloadTab(tab.id);
              } else {
                updateTab(tab.id, { fileMtime: res.mtime });
              }
            } else {
              await reloadTab(tab.id);
            }
          }
        }),
      );
    } finally {
      checkingRef.current = false;
    }
  }, [reloadTab, updateTab]);

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
    [newFile, openFile, openFilePath, save, saveAs, closeTab, closeWindow, markDirty, checkExternalChanges],
  );
}
