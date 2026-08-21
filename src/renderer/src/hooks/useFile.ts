import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { editorStateCache } from '../editor-state-cache';
import { confirmDialog } from '../confirm-dialog';
import { isImageUploadInProgress, waitForImageUploads } from '../image-upload';
import { sourceEditorHandle } from '../source-editor-ref';
import { buildConflictDiff } from '../conflict-diff';
import { t } from '../i18n';
import { tabDisplayName } from '../tab-name';
import { AUTO_SAVE_DELAY_MS, isAutoSaveEligible } from '../auto-save';
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
  const autoSave = useStore((s) => s.autoSave);

  const suppressDirtyRef = useRef(false);
  const checkingRef = useRef(false);
  const pendingFullCheckRef = useRef(false);
  const pendingWatchEventsRef = useRef(new Map<string, FileWatchEvent>());
  const watchedPathsRef = useRef(new Map<string, string>());
  const missingNotifiedTabIdsRef = useRef(new Set<string>());
  const autoSaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const prevActiveTabIdRef = useRef(activeTabId);

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
            t('confirm.saveFailed'),
            t('confirm.saveFailedHint1', { name: tabDisplayName(tab, t) }),
            [t('common.ok')],
          );
          return false;
        }
        if (result.status === 'conflict') {
          const diskVersion = await window.inkmark.openFilePath(tab.filePath);
          const choice = await confirmDialog(
            t('confirm.externalModified'),
            t('confirm.externalModifiedCoverHint'),
            [t('confirm.overwriteDisk'), t('common.cancel')],
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
            await confirmDialog(
              t('confirm.saveFailed'),
              t('confirm.saveFailedShort', { name: tabDisplayName(tab, t) }),
              [t('common.ok')],
            );
            return false;
          }
          if (forceResult.status === 'ok') {
            missingNotifiedTabIdsRef.current.delete(tabId);
            updateTab(tabId, {
              isDirty: false,
              fileMtime: forceResult.mtime,
              externalUpdatePending: false,
            });
            return true;
          }
          return false;
        }
        missingNotifiedTabIdsRef.current.delete(tabId);
        updateTab(tabId, {
          isDirty: false,
          fileMtime: result.mtime,
          externalUpdatePending: false,
        });
        return true;
      }

      let saveAsResult;
      try {
        saveAsResult = await window.inkmark.saveFileAs(content, tab.filePath);
      } catch {
        await confirmDialog(
          t('confirm.saveFailed'),
          t('confirm.saveFailedShort', { name: tabDisplayName(tab, t) }),
          [t('common.ok')],
        );
        return false;
      }
      if (saveAsResult) {
        missingNotifiedTabIdsRef.current.delete(tabId);
        updateTab(tabId, {
          filePath: saveAsResult.path,
          fileName: saveAsResult.path.split(/[/\\]/).pop()!,
          isDirty: false,
          fileMtime: saveAsResult.mtime,
          externalUpdatePending: false,
        });
        return true;
      }
      return false;
    },
    [getTabMarkdown, updateTab],
  );

  // —— 自动保存 ——
  // 停止编辑 3 秒后落盘；切换/关闭标签与退出窗口时立即补存。
  // 只处理已落盘文件，无路径的新文档仍走手动保存（isAutoSaveEligible）。
  const flushAutoSave = useCallback(
    async (tabId: string): Promise<void> => {
      autoSaveTimersRef.current.delete(tabId);
      const isEligible = (): boolean => {
        const state = useStore.getState();
        const tab = state.tabs.find((t) => t.id === tabId);
        return isAutoSaveEligible({
          enabled: state.autoSave,
          filePath: tab?.filePath ?? null,
          isDirty: tab?.isDirty ?? false,
        });
      };
      if (!isEligible()) return;
      // 图片上传完成前不落盘，避免把失效引用写进文件。
      await waitForImageUploads();
      // 等待上传期间内容可能已被保存或标签已关闭，保存前再校验一次。
      if (!isEligible()) return;
      await saveTab(tabId);
    },
    [saveTab],
  );

  const scheduleAutoSave = useCallback(
    (tabId: string): void => {
      const timers = autoSaveTimersRef.current;
      const existing = timers.get(tabId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        timers.delete(tabId);
        void flushAutoSave(tabId);
      }, AUTO_SAVE_DELAY_MS);
      timers.set(tabId, timer);
    },
    [flushAutoSave],
  );

  const newFile = useCallback(() => {
    addTab();
  }, [addTab]);

  const newBlankDoc = useCallback(() => {
    // 空白文档标签：跳过开始页，直接进入空编辑器（与开始页「新建空白文档」同语义）。
    addTab({ startPage: false });
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
      await confirmDialog(t('confirm.openFailed'), t('confirm.openDialogFailed'), [t('common.ok')]);
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
        await confirmDialog(t('confirm.openFailed'), t('confirm.openPathFailed', { path }), [
          t('common.ok'),
        ]);
        return;
      }
      if (!result) {
        await confirmDialog(t('confirm.openFailed'), t('confirm.openPathMissing', { path }), [
          t('common.ok'),
        ]);
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
      await confirmDialog(t('confirm.imageSaving'), t('confirm.imageSavingSaveAs'), [
        t('common.ok'),
      ]);
      return;
    }
    const currentState = useStore.getState();
    const content = getTabMarkdown(currentState.activeTabId);
    let result;
    try {
      const activeTab = currentState.tabs.find((tab) => tab.id === currentState.activeTabId);
      result = await window.inkmark.saveFileAs(content, activeTab?.filePath);
    } catch {
      await confirmDialog(t('confirm.saveFailed'), t('confirm.saveFailedGeneric'), [
        t('common.ok'),
      ]);
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
        await confirmDialog(t('confirm.imageSaving'), t('confirm.imageSavingCloseTab'), [
          t('common.ok'),
        ]);
        return false;
      }
      const tab = currentState.tabs.find((t) => t.id === id);
      if (!tab) return false;

      let dirty = tab.isDirty;
      // 自动保存开启时先补存：干净关闭不打扰；保存失败（如冲突被取消）仍走原有询问。
      if (dirty && useStore.getState().autoSave && tab.filePath) {
        await flushAutoSave(id);
        dirty = useStore.getState().tabs.find((t) => t.id === id)?.isDirty ?? false;
      }

      if (dirty) {
        const choice = await confirmDialog(
          t('confirm.unsavedChanges'),
          t('confirm.unsavedChangesBody', { name: tabDisplayName(tab, t) }),
          [t('common.save'), t('common.dontSave'), t('common.cancel')],
        );
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
    [saveTab, closeTabStore, flushAutoSave],
  );

  const prepareToClose = useCallback(async (): Promise<boolean> => {
    if (isImageUploadInProgress()) {
      await confirmDialog(t('confirm.imageSaving'), t('confirm.imageSavingCloseWindow'), [
        t('common.ok'),
      ]);
      return false;
    }
    const dirtyTabs = useStore.getState().tabs.filter((t) => t.isDirty);
    for (const tab of dirtyTabs) {
      let shouldAsk = true;
      if (useStore.getState().autoSave && tab.filePath) {
        await flushAutoSave(tab.id);
        shouldAsk = useStore.getState().tabs.find((t) => t.id === tab.id)?.isDirty ?? false;
      }
      if (!shouldAsk) continue;
      const choice = await confirmDialog(
        t('confirm.unsavedChanges'),
        t('confirm.unsavedChangesBody', { name: tabDisplayName(tab, t) }),
        [t('common.save'), t('common.dontSave'), t('common.cancel')],
      );
      const closeDecision = decideCloseDirty({ isDirty: true, choice });
      if (closeDecision === 'cancel') return false;
      if (closeDecision === 'save') {
        const saved = await saveTab(tab.id);
        if (!saved) return false;
      }
    }
    return true;
  }, [saveTab, flushAutoSave]);

  const closeWindow = useCallback(async (): Promise<boolean> => {
    if (!(await prepareToClose())) return false;
    await window.inkmark.closeWindow();
    return true;
  }, [prepareToClose]);

  const markDirty = useCallback(() => {
    if (suppressDirtyRef.current) {
      suppressDirtyRef.current = false;
      return;
    }
    setDirty(true);
    // 用户开始编辑后，等待重载的提示条不再有意义——继续显示会诱使用户点击
    // 而丢弃刚输入的未保存内容；之后的外部改动会走脏标签的冲突弹窗。
    updateTab(useStore.getState().activeTabId, { externalUpdatePending: false });
    const state = useStore.getState();
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
    if (state.autoSave && activeTab?.filePath) scheduleAutoSave(state.activeTabId);
  }, [setDirty, updateTab, scheduleAutoSave]);

  // 切换标签时立即补存上一个标签：自动保存开启时基本见不到未保存状态。
  useEffect(() => {
    const prevId = prevActiveTabIdRef.current;
    prevActiveTabIdRef.current = activeTabId;
    if (prevId === activeTabId) return;
    const state = useStore.getState();
    if (!state.autoSave) return;
    const prevTab = state.tabs.find((t) => t.id === prevId);
    if (
      prevTab &&
      isAutoSaveEligible({
        enabled: true,
        filePath: prevTab.filePath,
        isDirty: prevTab.isDirty,
      })
    ) {
      void flushAutoSave(prevId);
    }
  }, [activeTabId, flushAutoSave]);

  // 开启自动保存时把已积累的未保存内容立即落盘；关闭时清掉未触发的定时器。
  useEffect(() => {
    if (autoSave) {
      for (const tab of useStore.getState().tabs) {
        if (isAutoSaveEligible({ enabled: true, filePath: tab.filePath, isDirty: tab.isDirty })) {
          void flushAutoSave(tab.id);
        }
      }
      return;
    }
    for (const timer of autoSaveTimersRef.current.values()) clearTimeout(timer);
    autoSaveTimersRef.current.clear();
  }, [autoSave, flushAutoSave]);

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
        externalUpdatePending: false,
      });
      missingNotifiedTabIdsRef.current.delete(tabId);
      return true;
    },
    [updateTab],
  );

  const notifyMissingFile = useCallback(
    async (tabId: string, fileName: string): Promise<void> => {
      if (missingNotifiedTabIdsRef.current.has(tabId)) return;
      missingNotifiedTabIdsRef.current.add(tabId);
      // 文件已丢失，等待重载的提示条不再有意义。
      updateTab(tabId, { externalUpdatePending: false });
      await confirmDialog(t('confirm.fileGone'), t('confirm.fileGoneBody', { name: fileName }), [
        t('common.ok'),
      ]);
    },
    [updateTab],
  );

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
                t('confirm.externalModified'),
                t('confirm.externalModifiedChooseHint'),
                [t('confirm.useDisk'), t('confirm.keepAndOverride'), t('common.cancel')],
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
              // 干净标签页不静默刷新（change-review.md 默认状态）：仅标记待重载，
              // 由用户点击编辑区顶部的提示条后再加载磁盘版本。
              updateTab(currentTab.id, { externalUpdatePending: true });
            }
          }
        }
      } finally {
        checkingRef.current = false;
      }
    },
    [getTabMarkdown, notifyMissingFile, reloadTab, updateTab],
  );

  const reloadActiveTab = useCallback(async (): Promise<void> => {
    // 编辑区「文件已被外部更新」提示条的点击入口：加载磁盘上的最新版本
    //（提示期间文件再次被外部改动时，此处读到的就是最新版本）。
    const tabId = useStore.getState().activeTabId;
    const reloaded = await reloadTab(tabId);
    if (!reloaded) {
      const latestTab = useStore.getState().tabs.find((tab) => tab.id === tabId);
      // 仅对真实文件标签提示丢失；无路径标签（如开始页）不存在待重载场景。
      if (latestTab?.filePath) await notifyMissingFile(latestTab.id, latestTab.fileName);
    }
  }, [notifyMissingFile, reloadTab]);

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
      for (const timer of autoSaveTimersRef.current.values()) clearTimeout(timer);
      autoSaveTimersRef.current.clear();
    },
    [],
  );

  return useMemo(
    () => ({
      newFile,
      newBlankDoc,
      openFile,
      openFilePath,
      save,
      saveAs,
      closeTab,
      prepareToClose,
      closeWindow,
      markDirty,
      checkExternalChanges,
      reloadActiveTab,
    }),
    [
      newFile,
      newBlankDoc,
      openFile,
      openFilePath,
      save,
      saveAs,
      closeTab,
      prepareToClose,
      closeWindow,
      markDirty,
      checkExternalChanges,
      reloadActiveTab,
    ],
  );
}
