import { useCallback, useEffect, useMemo, useRef } from 'react';
import { selectViewMode, tabDocumentPath, useStore } from '../stores/useStore';
import { editorStateCache } from '../editor-state-cache';
import { editorHandle } from '../editor-ref';
import { confirmDialog } from '../confirm-dialog';
import { isImageUploadInProgress, waitForImageUploads } from '../image-upload';
import { sourceEditorHandle } from '../source-editor-ref';
import { buildConflictDiff } from '../conflict-diff';
import { t } from '../i18n';
import { tabDisplayName } from '../tab-name';
import { AUTO_SAVE_DELAY_MS, isAutoSaveEligible } from '../auto-save';
import { clearRecoveryDraftsBeforeExit } from './useDraftRecovery';
import { clearDiskBaseline, setDiskBaseline } from '../disk-baseline';
import {
  decideCloseDirty,
  decideExternalChange,
  resolveConflictChoice,
} from '../file-conflict-decision';
import { isPathInside } from '../../../shared/file-tree-follow';
import { isLargeMarkdownContent, resolveDocumentKind } from '../../../shared/openable-document';
import type { EditorState as SourceEditorState } from '@codemirror/state';
import type {
  FileResult,
  FileWatchEvent,
  OpenFileRejection,
  SaveAsResult,
  SaveResult,
  ViewMode,
} from '../types';

// 用户主动触发的读取（打开、重载、冲突比对）被守卫拒绝时，说明具体原因。
async function showOpenRejection(result: OpenFileRejection, path: string): Promise<void> {
  const reason =
    result.status === 'too-large'
      ? t('confirm.openPathTooLarge', { path })
      : result.status === 'unsupported-encoding'
        ? t('confirm.openPathUnsupportedEncoding', { path })
        : t('confirm.openPathSymlink', { path });
  await confirmDialog(t('confirm.openFailed'), reason, [t('common.ok')]);
}

function filePathKey(path: string): string {
  return window.inkmark.platform === 'win32' ? path.toLowerCase() : path;
}

async function saveWithAuthorization(
  path: string,
  save: () => Promise<SaveResult>,
  canConfirm: () => boolean,
): Promise<SaveResult> {
  const result = await save();
  if (
    result.status === 'authorization-required' &&
    canConfirm() &&
    (await window.inkmark.confirmFileSave(path)) &&
    canConfirm()
  ) {
    return save();
  }
  return result;
}

export function useFile(
  setMarkdown: (md: string) => boolean,
  viewMode: ViewMode,
  refreshSourceMetadata: (state: SourceEditorState) => void,
) {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const addTab = useStore((s) => s.addTab);
  const closeTabStore = useStore((s) => s.closeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const updateTab = useStore((s) => s.updateTab);
  const setDirty = useStore((s) => s.setDirty);
  const autoSave = useStore((s) => s.autoSave);

  const checkingRef = useRef(false);
  const pendingFullCheckRef = useRef(false);
  const pendingWatchEventsRef = useRef(new Map<string, FileWatchEvent>());
  const watchedPathsRef = useRef(new Map<string, string>());
  const missingNotifiedTabIdsRef = useRef(new Set<string>());
  const conflictDialogTabIdsRef = useRef(new Set<string>());
  // 自动保存抑制中的标签:文件树删除执行期间暂停(取消既有定时器且不再排期),
  // 删除被拒后恢复并为仍脏的标签重新排期。
  const autoSaveSuppressedTabIdsRef = useRef(new Set<string>());
  const autoSaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const prevActiveTabIdRef = useRef(activeTabId);
  const prevAutoSaveRef = useRef(autoSave);

  const cancelAutoSaveTimer = useCallback((tabId: string): void => {
    const timer = autoSaveTimersRef.current.get(tabId);
    if (timer) {
      clearTimeout(timer);
      autoSaveTimersRef.current.delete(tabId);
    }
  }, []);

  const stateRef = useRef({ tabs, activeTabId, setMarkdown, viewMode, refreshSourceMetadata });
  useEffect(() => {
    stateRef.current = { tabs, activeTabId, setMarkdown, viewMode, refreshSourceMetadata };
  });

  const getTabMarkdown = useCallback((tabId: string): string => {
    const tab = useStore.getState().tabs.find((t) => t.id === tabId);
    return tab?.sourceContent ?? '';
  }, []);

  // 附件复制可能改写图片路径，磁盘正文、标签真源与可见编辑器必须一起接收。
  // 对话框期间改过正文时，不能把旧快照的路径改写覆盖到新内容或另一个文档上。
  const applySavedCopy = useCallback(
    (
      tabId: string,
      originalPath: string | null,
      requestedContent: string,
      result: SaveAsResult,
    ): boolean => {
      const state = useStore.getState();
      const current = state.tabs.find((item) => item.id === tabId);
      if (!current || current.filePath !== originalPath) {
        return false;
      }
      const rewritten = result.content !== requestedContent;
      const editedWhileSaving = current.sourceContent !== requestedContent;
      if (rewritten && editedWhileSaving) return false;
      updateTab(tabId, {
        filePath: result.path,
        recoveryOriginPath: null,
        fileName: result.path.split(/[/\\]/).pop()!,
        sourceContent: editedWhileSaving ? current.sourceContent : result.content,
        isDirty: editedWhileSaving,
        fileMtime: result.mtime,
        externalUpdatePending: false,
      });
      setDiskBaseline(tabId, result.content);
      missingNotifiedTabIdsRef.current.delete(tabId);
      autoSaveSuppressedTabIdsRef.current.delete(tabId);
      if (rewritten) {
        editorStateCache.dispose(tabId);
        const isTextDoc = resolveDocumentKind(result.path) === 'text';
        const largeDocSourceForced =
          !isTextDoc && current.largeDocSourceForced && isLargeMarkdownContent(result.content);
        if (largeDocSourceForced !== current.largeDocSourceForced) {
          updateTab(tabId, { largeDocSourceForced });
        }
        if (state.activeTabId === tabId) {
          const prevMode = selectViewMode(state);
          const activeMode = selectViewMode(useStore.getState());
          if (prevMode === 'source') {
            sourceEditorHandle.current?.setValue(result.content, {
              preserveLineSeparator: isTextDoc,
              plainText: isTextDoc,
            });
            if (activeMode === 'source') {
              const loaded = sourceEditorHandle.current?.getEditorState();
              if (loaded) stateRef.current.refreshSourceMetadata(loaded);
            }
          } else if (activeMode === 'wysiwyg') {
            stateRef.current.setMarkdown(result.content);
          }
        }
        updateTab(tabId, { sourceContent: result.content, isDirty: false });
      }
      return true;
    },
    [updateTab],
  );

  const saveTabAs = useCallback(
    async (tabId: string): Promise<boolean> => {
      if (isImageUploadInProgress()) {
        await confirmDialog(t('confirm.imageSaving'), t('confirm.imageSavingSaveAs'), [
          t('common.ok'),
        ]);
        return false;
      }
      const currentState = useStore.getState();
      const targetTab = currentState.tabs.find((tab) => tab.id === tabId);
      if (!targetTab) return false;
      const content = getTabMarkdown(tabId);
      let result;
      try {
        result = await window.inkmark.saveFileAs(content, tabDocumentPath(targetTab));
      } catch {
        await confirmDialog(t('confirm.saveFailed'), t('confirm.saveFailedGeneric'), [
          t('common.ok'),
        ]);
        return false;
      }
      if (result) {
        if ('status' in result) {
          await confirmDialog(t('confirm.saveFailed'), result.message, [t('common.ok')]);
          return false;
        }
        const applied = applySavedCopy(targetTab.id, targetTab.filePath, content, result);
        if (applied) cancelAutoSaveTimer(targetTab.id);
        return applied;
      }
      return false;
    },
    [applySavedCopy, cancelAutoSaveTimer, getTabMarkdown],
  );

  const reloadTab = useCallback(
    async (tabId: string): Promise<'ok' | 'missing' | 'rejected'> => {
      const s = stateRef.current;
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab?.filePath) return 'missing';
      let result;
      try {
        result = await window.inkmark.openFilePath(tab.filePath);
      } catch {
        return 'missing';
      }
      // 磁盘版本被守卫拒绝（过大/非 UTF-8）时给出具体原因，不按文件丢失处理。
      if (result && 'status' in result) {
        await showOpenRejection(result, tab.filePath);
        return 'rejected';
      }
      if (!result) return 'missing';
      const current = stateRef.current;
      const liveTab = useStore.getState().tabs.find((item) => item.id === tabId);
      if (!liveTab || liveTab.filePath !== tab.filePath) return 'missing';
      editorStateCache.dispose(tabId);
      cancelAutoSaveTimer(tabId);
      const isTextDoc = resolveDocumentKind(tab.filePath) === 'text';
      const nextLarge = !isTextDoc && isLargeMarkdownContent(result.content);
      const nextLargeForced =
        nextLarge &&
        (liveTab.largeDocSourceForced ||
          current.viewMode === 'source' ||
          !isLargeMarkdownContent(liveTab.sourceContent));
      updateTab(tabId, {
        sourceContent: result.content,
        fileMtime: result.mtime,
        isDirty: false,
        externalUpdatePending: false,
        largeDocSourceForced: nextLargeForced,
      });
      if (tabId === current.activeTabId) {
        const nextMode = selectViewMode(useStore.getState());
        if (current.viewMode === 'source') {
          // 无论重载后留在源码还是因缩小而切回所见即所得，都先同步源码编辑器，
          // 防止随后的模式切换 effect 读回旧正文覆盖磁盘最新版本。
          sourceEditorHandle.current?.setValue(result.content, {
            preserveLineSeparator: isTextDoc,
            plainText: isTextDoc,
          });
          if (nextMode === 'source') {
            const loaded = sourceEditorHandle.current?.getEditorState();
            if (loaded) current.refreshSourceMetadata(loaded);
          }
        } else if (nextMode === 'wysiwyg') {
          current.setMarkdown(result.content);
        }
      }
      setDiskBaseline(tabId, result.content);
      missingNotifiedTabIdsRef.current.delete(tabId);
      return 'ok';
    },
    [cancelAutoSaveTimer, updateTab],
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

  // 统一处理外部修改冲突（监听触发、保存撞上冲突、点击冲突提示条共用）。
  // 进入即暂停自动保存并锁定只读，提供「另存为新文件…」「使用磁盘版本」「覆盖磁盘版本」「取消」。
  const resolveExternalConflict = useCallback(
    async (tabId: string): Promise<'saved' | 'reloaded' | 'unresolved'> => {
      if (conflictDialogTabIdsRef.current.has(tabId)) return 'unresolved';
      conflictDialogTabIdsRef.current.add(tabId);
      cancelAutoSaveTimer(tabId);
      updateTab(tabId, { externalUpdatePending: true });
      try {
        for (;;) {
          const liveTab = useStore.getState().tabs.find((item) => item.id === tabId);
          if (!liveTab?.filePath) return 'unresolved';
          const path = liveTab.filePath;
          let diskRead: FileResult | OpenFileRejection | null;
          try {
            diskRead = await window.inkmark.openFilePath(path);
          } catch {
            diskRead = null;
          }
          if (diskRead && 'status' in diskRead) {
            // 磁盘版本已过大或非 UTF-8：说明原因并终止；不带差异对比的
            // 覆盖选项会让用户在不知情下毁掉无法读取的外部新版本。
            await showOpenRejection(diskRead, path);
            return 'unresolved';
          }
          if (!diskRead) {
            await notifyMissingFile(liveTab.id, liveTab.fileName);
            return 'unresolved';
          }
          const diskVersion = diskRead;
          const afterRead = useStore.getState().tabs.find((tab) => tab.id === tabId);
          if (!afterRead || afterRead.filePath !== path) return 'unresolved';
          const content = getTabMarkdown(tabId);
          const choices = [
            t('confirm.saveAsNewFile'),
            t('confirm.useDisk'),
            t('confirm.overwriteDisk'),
            t('common.cancel'),
          ];
          const choice = await confirmDialog(
            t('confirm.externalModified'),
            t('confirm.externalModifiedChooseHint'),
            choices,
            {
              defaultId: 0,
              cancelId: 3,
              diff: buildConflictDiff(diskVersion.content, content),
            },
          );
          const afterDialog = useStore.getState().tabs.find((tab) => tab.id === tabId);
          if (!afterDialog || afterDialog.filePath !== path) return 'unresolved';
          const conflictAction = resolveConflictChoice(choice);
          if (conflictAction === 'save-as') {
            const savedAs = await saveTabAs(tabId);
            return savedAs ? 'saved' : 'unresolved';
          }
          if (conflictAction === 'reload') {
            const reloaded = await reloadTab(tabId);
            if (reloaded === 'missing') {
              const latestTab = useStore.getState().tabs.find((tab) => tab.id === tabId);
              if (latestTab) await notifyMissingFile(latestTab.id, latestTab.fileName);
              return 'unresolved';
            }
            return reloaded === 'ok' ? 'reloaded' : 'unresolved';
          }
          if (conflictAction === 'overwrite') {
            let overwriteResult: SaveResult;
            try {
              overwriteResult = await saveWithAuthorization(
                path,
                () => window.inkmark.saveFile(content, path, diskVersion.mtime, false),
                () => {
                  const current = useStore.getState().tabs.find((item) => item.id === tabId);
                  return current?.filePath === path && getTabMarkdown(tabId) === content;
                },
              );
            } catch {
              await confirmDialog(
                t('confirm.saveFailed'),
                t('confirm.saveFailedHint1', { name: tabDisplayName(afterDialog, t) }),
                [t('common.ok')],
              );
              return 'unresolved';
            }
            const afterOverwrite = useStore.getState().tabs.find((item) => item.id === tabId);
            if (!afterOverwrite || afterOverwrite.filePath !== path) return 'unresolved';
            if (overwriteResult.status === 'authorization-required') return 'unresolved';
            if (overwriteResult.status === 'conflict') continue;
            missingNotifiedTabIdsRef.current.delete(tabId);
            updateTab(tabId, {
              isDirty: getTabMarkdown(tabId) !== content,
              fileMtime: overwriteResult.mtime,
              externalUpdatePending: false,
            });
            setDiskBaseline(tabId, content);
            return 'saved';
          }
          return 'unresolved';
        }
      } finally {
        conflictDialogTabIdsRef.current.delete(tabId);
      }
    },
    [cancelAutoSaveTimer, getTabMarkdown, notifyMissingFile, reloadTab, saveTabAs, updateTab],
  );

  const saveTab = useCallback(
    async (tabId: string, automatic = false): Promise<boolean> => {
      const tab = useStore.getState().tabs.find((t) => t.id === tabId);
      if (!tab) return false;

      const content = getTabMarkdown(tabId);

      const path = tab.filePath;
      if (path) {
        if (tab.externalUpdatePending) {
          if (!tab.isDirty) return false;
          const outcome = await resolveExternalConflict(tabId);
          return outcome === 'saved';
        }
        let result;
        try {
          result = await saveWithAuthorization(
            path,
            () => window.inkmark.saveFile(content, path, tab.fileMtime),
            () => {
              if (automatic) return false;
              const current = useStore.getState().tabs.find((item) => item.id === tabId);
              return (
                current?.filePath === path &&
                current.fileMtime === tab.fileMtime &&
                getTabMarkdown(tabId) === content
              );
            },
          );
        } catch {
          await confirmDialog(
            t('confirm.saveFailed'),
            t('confirm.saveFailedHint1', { name: tabDisplayName(tab, t) }),
            [t('common.ok')],
          );
          return false;
        }
        const afterSave = useStore.getState().tabs.find((item) => item.id === tabId);
        if (!afterSave || afterSave.filePath !== path) {
          return false;
        }
        if (result.status === 'authorization-required') return false;
        if (result.status === 'conflict') {
          const outcome = await resolveExternalConflict(tabId);
          return outcome === 'saved';
        }
        missingNotifiedTabIdsRef.current.delete(tabId);
        updateTab(tabId, {
          isDirty: getTabMarkdown(tabId) !== content,
          fileMtime: result.mtime,
          externalUpdatePending: false,
        });
        setDiskBaseline(tabId, content);
        return true;
      }

      let saveAsResult;
      try {
        saveAsResult = await window.inkmark.saveFileAs(content, tabDocumentPath(tab));
      } catch {
        await confirmDialog(
          t('confirm.saveFailed'),
          t('confirm.saveFailedShort', { name: tabDisplayName(tab, t) }),
          [t('common.ok')],
        );
        return false;
      }
      if (saveAsResult) {
        if ('status' in saveAsResult) {
          await confirmDialog(t('confirm.saveFailed'), saveAsResult.message, [t('common.ok')]);
          return false;
        }
        return applySavedCopy(tabId, tab.filePath, content, saveAsResult);
      }
      return false;
    },
    [applySavedCopy, getTabMarkdown, resolveExternalConflict, updateTab],
  );

  // —— 自动保存 ——
  // 停止编辑 3 秒后落盘；切换/关闭标签与退出窗口时立即补存。
  // 只处理已落盘且没有待处理外部更新的文档（isAutoSaveEligible）。
  const flushAutoSave = useCallback(
    async (tabId: string): Promise<void> => {
      autoSaveTimersRef.current.delete(tabId);
      const isEligible = (): boolean => {
        // 删除执行中(回收站可能较慢)的标签暂停自动保存,期间的编辑保持
        // 未保存状态,保留的标签才能经「另存为」救回
        if (autoSaveSuppressedTabIdsRef.current.has(tabId)) return false;
        const state = useStore.getState();
        const tab = state.tabs.find((t) => t.id === tabId);
        return isAutoSaveEligible({
          enabled: state.autoSave,
          filePath: tab?.filePath ?? null,
          isDirty: tab?.isDirty ?? false,
          externalUpdatePending: tab?.externalUpdatePending ?? false,
        });
      };
      if (!isEligible()) return;
      // 图片上传完成前不落盘，避免把失效引用写进文件。
      await waitForImageUploads();
      // 等待上传期间内容可能已被保存或标签已关闭，保存前再校验一次。
      if (!isEligible()) return;
      await saveTab(tabId, true);
    },
    [saveTab],
  );

  const scheduleAutoSave = useCallback(
    (tabId: string): void => {
      if (autoSaveSuppressedTabIdsRef.current.has(tabId)) return;
      const tab = useStore.getState().tabs.find((t) => t.id === tabId);
      if (tab?.externalUpdatePending) return;
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
        const isTextDoc = resolveDocumentKind(result.path) === 'text';
        const largeDocSourceForced = !isTextDoc && isLargeMarkdownContent(result.content);
        const nextMode =
          isTextDoc || largeDocSourceForced ? 'source' : useStore.getState().viewMode;
        updateTab(activeTab.id, {
          filePath: result.path,
          fileName: result.path.split(/[/\\]/).pop()!,
          sourceContent: result.content,
          fileMtime: result.mtime,
          isStartPage: false,
          largeDocSourceForced,
        });
        if (nextMode === 'wysiwyg') {
          s.setMarkdown(result.content);
        } else if (s.viewMode === 'source') {
          // 偏好已是源码模式时必须在此处直接装载：复用标签不改变活动标签，
          // 生效模式不会翻转，模式切换 effect 不会运行。
          sourceEditorHandle.current?.setValue(result.content, {
            preserveLineSeparator: isTextDoc,
            plainText: isTextDoc,
          });
          // 程序化装载抑制了变更回调：字数与大纲在此主动刷新一次。
          const loaded = sourceEditorHandle.current?.getEditorState();
          if (loaded) refreshSourceMetadata(loaded);
        }
        setDiskBaseline(activeTab.id, result.content);
        return;
      }

      const newTabId = addTab({
        filePath: result.path,
        content: result.content,
        fileMtime: result.mtime,
      });
      setDiskBaseline(newTabId, result.content);
    },
    [addTab, refreshSourceMetadata, setActiveTab, updateTab],
  );

  const openFilePath = useCallback(
    async (path: string): Promise<boolean> => {
      let result;
      try {
        result = await window.inkmark.openFilePath(path);
      } catch {
        await confirmDialog(t('confirm.openFailed'), t('confirm.openPathFailed', { path }), [
          t('common.ok'),
        ]);
        return false;
      }
      if (!result) {
        await confirmDialog(t('confirm.openFailed'), t('confirm.openPathMissing', { path }), [
          t('common.ok'),
        ]);
        return false;
      }
      // 主进程的守卫结论：文件过大或编码不是 UTF-8，拒绝打开并说明原因。
      // 返回 true：文件仍然存在且原因已说明，调用方（如开始页）不得把
      // 它当作「已删除或移动」从最近记录里清掉。
      if ('status' in result) {
        await showOpenRejection(result, path);
        return true;
      }
      await openFileResult(result);
      return true;
    },
    [openFileResult],
  );

  const openFile = useCallback(async () => {
    let paths;
    try {
      paths = await window.inkmark.openFileDialog();
    } catch {
      await confirmDialog(t('confirm.openFailed'), t('confirm.openDialogFailed'), [t('common.ok')]);
      return;
    }
    if (!paths || paths.length === 0) return;
    for (const path of paths) {
      await openFilePath(path);
    }
  }, [openFilePath]);

  const save = useCallback(async () => {
    await saveTab(useStore.getState().activeTabId);
  }, [saveTab]);

  const saveAs = useCallback(async () => {
    await saveTabAs(useStore.getState().activeTabId);
  }, [saveTabAs]);

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
      // 自动保存开启时先补存：干净关闭不打扰；冲突或保存失败仍走原有询问。
      if (
        isAutoSaveEligible({
          enabled: useStore.getState().autoSave,
          filePath: tab.filePath,
          isDirty: dirty,
          externalUpdatePending: tab.externalUpdatePending,
        })
      ) {
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

      cancelAutoSaveTimer(id);
      editorStateCache.dispose(id);
      clearDiskBaseline(id);

      // 关闭最后一个标签页时回到欢迎页，而非关闭整个窗口；
      // store 的 closeTab 会在标签页清空后自动新建一个欢迎页标签页。
      closeTabStore(id);
      return true;
    },
    [cancelAutoSaveTimer, closeTabStore, flushAutoSave, saveTab],
  );

  // 文件树重命名后同步标签身份：路径、文件名与磁盘基线一起切换，未保存
  // 修改保留，后续保存写入新路径。重命名不改变磁盘正文，草稿仍以原正文为基线。
  // 待触发的自动保存定时器保留：回调按标签 id 触发并重新读取标签状态，
  // 会按新路径正常保存，提前取消反而让重命名瞬间的待存修改延后。
  const renameTabFile = useCallback(
    (oldPath: string, newPath: string, mtime: number): void => {
      const key = filePathKey(oldPath);
      const kindChanged = resolveDocumentKind(oldPath) !== resolveDocumentKind(newPath);
      for (const tab of useStore.getState().tabs) {
        if (!tab.filePath || filePathKey(tab.filePath) !== key) continue;
        missingNotifiedTabIdsRef.current.delete(tab.id);
        // 跨类型重命名（后台标签同样命中）：缓存快照按内容匹配，不含文档
        // 类型维度，不清理会恢复出旧类型的编辑器配置（Markdown 高亮、丢失
        // CRLF 分隔符），继续编辑保存会整篇改写换行。清掉后切回时按新类型
        // 重新装载。
        if (kindChanged) editorStateCache.dispose(tab.id);
        updateTab(tab.id, {
          filePath: newPath,
          fileName: newPath.split(/[/\\]/).pop()!,
          fileMtime: mtime,
          externalUpdatePending: false,
        });
      }
    },
    [updateTab],
  );

  // 文件树删除后静默关闭落在目标（文件或目录）之内的标签：磁盘文件已进
  // 回收站，不再走保存询问。调用方已在删除确认中警示过未保存修改的丢失。
  // contentBefore 为发起删除时的正文快照：删除执行期间（回收站可能较慢）
  // 正文发生变化的标签——无论是新编辑还是已脏标签上的追加输入——都不随
  // 删除静默关闭，内容可经「另存为」救回；返回保留的标签名供调用方提示。
  const forceCloseTabsUnderPath = useCallback(
    (targetPath: string, contentBefore?: ReadonlyMap<string, string>): string[] => {
      const kept: string[] = [];
      for (const tab of useStore.getState().tabs) {
        if (!tab.filePath || !isPathInside(tab.filePath, targetPath)) continue;
        const before = contentBefore?.get(tab.id);
        if (before !== undefined && tab.sourceContent !== before) {
          // 保留的标签维持自动保存抑制:文件已进回收站,向死路径自动保存
          // 只会反复弹保存失败;「另存为」成功后由用户继续编辑驱动新排期
          kept.push(tab.fileName);
          continue;
        }
        const timer = autoSaveTimersRef.current.get(tab.id);
        if (timer) {
          clearTimeout(timer);
          autoSaveTimersRef.current.delete(tab.id);
        }
        autoSaveSuppressedTabIdsRef.current.delete(tab.id);
        missingNotifiedTabIdsRef.current.delete(tab.id);
        editorStateCache.dispose(tab.id);
        clearDiskBaseline(tab.id);
        closeTabStore(tab.id);
      }
      return kept;
    },
    [closeTabStore],
  );

  // 暂停指定标签的自动保存:取消既有定时器并阻止期间重新排期(删除执行中
  // 的编辑保持未保存),由调用方在删除 settle 后恢复。
  const suppressAutoSaveForTabs = useCallback((tabIds: Iterable<string>): void => {
    for (const id of tabIds) {
      autoSaveSuppressedTabIdsRef.current.add(id);
      const timer = autoSaveTimersRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        autoSaveTimersRef.current.delete(id);
      }
    }
  }, []);

  // 恢复自动保存并为仍脏、仍符合条件的标签重新排期——被取消的待存不至于
  // 一直悬空;标签已关闭或已干净的恢复为无操作。
  const restoreAutoSaveForTabs = useCallback(
    (tabIds: Iterable<string>): void => {
      for (const id of tabIds) {
        autoSaveSuppressedTabIdsRef.current.delete(id);
        const state = useStore.getState();
        const tab = state.tabs.find((t) => t.id === id);
        if (
          tab &&
          isAutoSaveEligible({
            enabled: state.autoSave,
            filePath: tab.filePath,
            isDirty: tab.isDirty,
            externalUpdatePending: tab.externalUpdatePending,
          })
        ) {
          scheduleAutoSave(id);
        }
      }
    },
    [scheduleAutoSave],
  );

  const prepareToClose = useCallback(async (): Promise<boolean> => {
    if (isImageUploadInProgress()) {
      await confirmDialog(t('confirm.imageSaving'), t('confirm.imageSavingCloseWindow'), [
        t('common.ok'),
      ]);
      return false;
    }
    const tabsToClose = useStore.getState().tabs;
    for (const tab of tabsToClose) {
      const liveTab = useStore.getState().tabs.find((t) => t.id === tab.id);
      if (!liveTab) continue;

      if (!liveTab.isDirty) continue;

      let shouldAsk = true;
      if (
        isAutoSaveEligible({
          enabled: useStore.getState().autoSave,
          filePath: liveTab.filePath,
          isDirty: liveTab.isDirty,
          externalUpdatePending: liveTab.externalUpdatePending,
        })
      ) {
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
    for (;;) {
      try {
        await clearRecoveryDraftsBeforeExit();
        break;
      } catch {
        const choice = await confirmDialog(t('confirm.saveFailed'), t('recovery.cleanupFailed'), [
          t('recovery.retry'),
          t('recovery.cancelClose'),
        ]);
        if (choice !== 0) return false;
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
    const state = useStore.getState();
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
    if (activeTab?.externalUpdatePending) return;
    setDirty(true);
    if (state.autoSave && activeTab?.filePath) scheduleAutoSave(state.activeTabId);
  }, [setDirty, scheduleAutoSave]);

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
        externalUpdatePending: prevTab.externalUpdatePending,
      })
    ) {
      void flushAutoSave(prevId);
    }
  }, [activeTabId, flushAutoSave]);

  // 开启自动保存时把已积累的未保存内容立即落盘；关闭时清掉未触发的定时器。
  useEffect(() => {
    const prevAutoSave = prevAutoSaveRef.current;
    prevAutoSaveRef.current = autoSave;
    if (autoSave) {
      if (!prevAutoSave) {
        for (const tab of useStore.getState().tabs) {
          if (
            isAutoSaveEligible({
              enabled: true,
              filePath: tab.filePath,
              isDirty: tab.isDirty,
              externalUpdatePending: tab.externalUpdatePending,
            })
          ) {
            void flushAutoSave(tab.id);
          }
        }
      }
      return;
    }
    for (const timer of autoSaveTimersRef.current.values()) clearTimeout(timer);
    autoSaveTimersRef.current.clear();
  }, [autoSave, flushAutoSave]);

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
            const currentTab = useStore.getState().tabs.find((tab) => tab.id === snapshotTab.id);
            if (!currentTab?.filePath || currentTab.filePath !== snapshotTab.filePath) continue;
            let liveDirty = currentTab.isDirty;
            if (
              currentTab.id === useStore.getState().activeTabId &&
              selectViewMode(useStore.getState()) === 'wysiwyg'
            ) {
              const pendingMd = editorHandle.current?.getPendingMarkdown();
              if (pendingMd != null && pendingMd !== currentTab.sourceContent) {
                updateTab(currentTab.id, { sourceContent: pendingMd, isDirty: true });
                liveDirty = true;
              }
            }
            const changeDecision = decideExternalChange({
              fileMtime: currentTab.fileMtime,
              diskMtime: res.mtime,
              isDirty: liveDirty,
              externalUpdatePending: currentTab.externalUpdatePending,
            });
            if (changeDecision === 'noop') continue;

            if (changeDecision === 'conflict') {
              await resolveExternalConflict(currentTab.id);
            } else {
              // 保持当前正文并锁定只读，等用户点击顶部提示条上的「重新加载」。
              cancelAutoSaveTimer(currentTab.id);
              updateTab(currentTab.id, { externalUpdatePending: true });
            }
          }
        }
      } finally {
        checkingRef.current = false;
      }
    },
    [cancelAutoSaveTimer, notifyMissingFile, resolveExternalConflict, updateTab],
  );

  const reloadActiveTab = useCallback(async (): Promise<void> => {
    // 编辑区「文件已被外部更新」提示条的点击入口：加载磁盘上的最新版本
    //（提示期间文件再次被外部改动时，此处读到的就是最新版本）。
    const tabId = useStore.getState().activeTabId;
    const reloaded = await reloadTab(tabId);
    if (reloaded === 'missing') {
      const latestTab = useStore.getState().tabs.find((tab) => tab.id === tabId);
      // 仅对真实文件标签提示丢失；无路径标签（如开始页）不存在待重载场景。
      if (latestTab?.filePath) await notifyMissingFile(latestTab.id, latestTab.fileName);
    }
  }, [notifyMissingFile, reloadTab]);

  const resolveActiveConflict = useCallback(async (): Promise<void> => {
    const tabId = useStore.getState().activeTabId;
    await resolveExternalConflict(tabId);
  }, [resolveExternalConflict]);

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
      resolveActiveConflict,
      renameTabFile,
      forceCloseTabsUnderPath,
      suppressAutoSaveForTabs,
      restoreAutoSaveForTabs,
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
      resolveActiveConflict,
      renameTabFile,
      forceCloseTabsUnderPath,
      suppressAutoSaveForTabs,
      restoreAutoSaveForTabs,
    ],
  );
}
