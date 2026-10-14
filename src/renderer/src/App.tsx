import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EditorState as SourceEditorState } from '@codemirror/state';
import { MilkdownProvider } from '@milkdown/react';
import { Editor } from './components/Editor';
import { StatusBar } from './components/StatusBar';
import { Outline } from './components/Outline';
import { FileTree } from './components/FileTree';
import { TabBar } from './components/TabBar';
import { Toolbar } from './components/Toolbar';
import { StartPage } from './components/StartPage';
import { ConfirmDialog } from './components/ConfirmDialog';
import { FindReplaceBar } from './components/FindReplaceBar';
import { ExternalUpdateBanner } from './components/ExternalUpdateBanner';
import { ReviewToolbar } from './components/ReviewToolbar';
import { ExportProgressDialog } from './components/ExportProgressDialog';
import { useTheme } from './hooks/useTheme';
import { useEditorFont } from './hooks/useEditorFont';
import { useEditorWidth } from './hooks/useEditorWidth';
import { useFile } from './hooks/useFile';
import { useExport } from './hooks/useExport';
import { useFileTree } from './hooks/useFileTree';
import { useResizablePanel } from './hooks/useResizablePanel';
import { useFindReplace } from './hooks/useFindReplace';
import { useOutline } from './hooks/useOutline';
import { useWordCount } from './hooks/useWordCount';
import { useStore } from './stores/useStore';
import { I18nProvider, t as tt, useI18n } from './i18n';
import { tabDisplayName } from './tab-name';
import { isThemeId } from './types';
import type { WorkspaceEntry } from './types';
import { editorHandle } from './editor-ref';
import { readTabScrollTop, scrollPositionUpdate } from './editor-position';
import { sourceEditorHandle } from './source-editor-ref';
import { editorStateCache } from './editor-state-cache';
import { drainQueuedReviewChunks } from './review/review-store';
import { resolveAllReviewChunks } from './review/review-resolution';
import { confirmDialog, promptDialog } from './confirm-dialog';
import { isImageUploadInProgress } from './image-upload';
import { followDocumentLinkHref } from './document-link';
import { comboMatchesEvent } from './shortcut-recorder';
import { EDITOR_BUILTIN_COMBOS, EDITOR_SHORTCUT_ACTIONS } from '../../shared/shortcuts';
import { runEditorCommand } from './editor-commands';
import type { MessageKey } from '../../shared/i18n';
import {
  findTabsUnderPath,
  findTabsWithActiveReview,
  findTabsWithPendingExternalUpdate,
  decideDeleteWarning,
} from './file-tree-actions';
import { parentDirectory } from '../../shared/file-tree-follow';
import {
  ensureUniqueFileName,
  validateWorkspaceDocumentName,
  type WorkspaceFileNameIssue,
} from '../../shared/workspace-file-name';
import type { WorkspaceFileOpError } from '../../shared/workspace-file-name';

// 源码模式与低频对话框拆成独立 chunk，避免它们的代码（CodeMirror 全家桶等）
// 拖慢启动首帧；首次使用时按需加载。查找替换等高频路径不懒加载。
const SourceEditor = lazy(() =>
  import('./components/SourceEditor').then((m) => ({ default: m.SourceEditor })),
);
const SettingsDialog = lazy(() =>
  import('./components/SettingsDialog').then((m) => ({ default: m.SettingsDialog })),
);
const UpdateDialog = lazy(() =>
  import('./components/UpdateDialog').then((m) => ({ default: m.UpdateDialog })),
);

// 文件树操作失败原因 → 提示文案键
const FILE_NAME_ISSUE_MESSAGE: Record<WorkspaceFileNameIssue, MessageKey> = {
  empty: 'fileTree.errorNameEmpty',
  'invalid-chars': 'fileTree.errorNameInvalidChars',
  'reserved-name': 'fileTree.errorNameReserved',
  'trailing-dot-or-space': 'fileTree.errorNameTrailing',
  'hidden-name': 'fileTree.errorNameHidden',
  'unsupported-extension': 'fileTree.errorNameExtension',
};

const FILE_OP_ERROR_MESSAGE: Record<WorkspaceFileOpError, MessageKey> = {
  'invalid-name': 'fileTree.errorNameInvalidChars',
  exists: 'fileTree.errorNameExists',
  'parent-missing': 'fileTree.errorOpFailed',
  'source-missing': 'fileTree.errorOpFailed',
  // conflict 在重命名入口有带文件名的专门提示，此处仅为类型完备的兜底
  conflict: 'fileTree.errorOpFailed',
  'io-error': 'fileTree.errorOpFailed',
};

function AppContent() {
  const { themeId, setThemeId } = useTheme();
  const { t } = useI18n();
  useEditorFont();
  useEditorWidth();
  const { updateOutline, updateSourceOutline } = useOutline();
  const { updateWordCount, updateSourceWordCount } = useWordCount();

  const activeTabId = useStore((s) => s.activeTabId);
  const isDirty = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.isDirty ?? false);
  const isStartPage = useStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.isStartPage ?? false,
  );
  const outlineWidth = useStore((s) => s.outlineWidth);
  const toolbarVisible = useStore((s) => s.toolbarVisible);
  const toolbarWidth = useStore((s) => s.toolbarWidth);
  const outlineVisible = useStore((s) => s.outlineVisible);
  const fileTreeVisible = useStore((s) => s.fileTreeVisible);
  const panelLayout = useStore((s) => s.panelLayout);
  const fileTreeWidth = useStore((s) => s.fileTreeWidth);
  const shortcuts = useStore((s) => s.shortcuts);
  const editorShortcuts = useStore((s) => s.editorShortcuts);
  const setFileTreeVisible = useStore((s) => s.setFileTreeVisible);
  const setFileTreeWidth = useStore((s) => s.setFileTreeWidth);
  // 单一布局字段派生两侧位置:outline-left → 大纲左/文件树右;outline-right 反之。
  // 两侧天然互斥,不会出现同侧并列。
  const outlineSide = panelLayout === 'outline-left' ? 'left' : 'right';
  const fileTreeSide = panelLayout === 'outline-left' ? 'right' : 'left';
  const activeFilePath = useStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.filePath ?? null,
  );
  const externalUpdatePending = useStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.externalUpdatePending ?? false,
  );
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const activeReviewSession = useStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.reviewSession ?? false,
  );
  const pendingReviewCount = useStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.pendingReviewCount ?? 0,
  );
  const setOutlineWidth = useStore((s) => s.setOutlineWidth);
  const toggleViewMode = useStore((s) => s.toggleViewMode);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const updateTab = useStore((s) => s.updateTab);
  const setSourceContent = useStore((s) => s.setSourceContent);
  const setStartPage = useStore((s) => s.setStartPage);
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const switchingRef = useRef(false);
  const prevTabIdRef = useRef(activeTabId);
  const viewModeRef = useRef(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    // 首帧后空闲时预取源码模式 chunk：与上面的 lazy() 同一 import 说明符，
    // 模块已缓存后用户首次切换源码模式无需等待加载。
    const idleId = window.requestIdleCallback(() => {
      void import('./components/SourceEditor');
    });
    return () => window.cancelIdleCallback(idleId);
  }, []);

  const setMarkdown = useCallback((md: string) => {
    if (!editorHandle.current) return false;
    editorHandle.current.setMarkdown(md);
    // useFile 以返回值判断加载通知是否已消费 suppressDirty。隐藏模式的
    // 通知被拦下时返回 false，不能让下一次真实源码输入被误当成加载事件。
    return useStore.getState().viewMode === 'wysiwyg' && !switchingRef.current;
  }, []);

  const fileOps = useFile(setMarkdown, viewMode);
  const { finishReview } = fileOps;
  const { exportDocument: runExport } = useExport();
  const fileTree = useFileTree(activeFilePath);

  // 文档内链接跳转：以链接所在文档的磁盘路径为基准解析相对地址；
  // 文件读取、同文件去重激活与丢失提示复用 openFilePath 全套流程。
  const handleFollowLink = useCallback(
    (href: string) => {
      const state = useStore.getState();
      const sourceFilePath =
        state.tabs.find((tab) => tab.id === state.activeTabId)?.filePath ?? null;
      void followDocumentLinkHref(href, sourceFilePath, {
        resolveDocumentLink: (request) => window.inkmark.resolveDocumentLink(request),
        openFilePath: async (path) => {
          await fileOps.openFilePath(path);
        },
        openExternalUrl: (url) => {
          window.inkmark.openExternalUrl(url);
        },
      });
    },
    [fileOps],
  );

  // 文件树基础操作：名称输入与删除确认在此编排，目录刷新由 useFileTree
  // 的操作方法负责；操作成功后同步已打开标签并打开新建的文档。
  const handleFileTreeCreateDocument = useCallback(
    async (dirPath: string): Promise<void> => {
      const folderName = dirPath.split(/[/\\]/).pop() ?? dirPath;
      const siblingNames = (fileTree.dirCache.get(dirPath) ?? []).map((entry) => entry.name);
      const defaultName = ensureUniqueFileName(t('fileTree.newDocumentDefaultName'), siblingNames);
      const name = await promptDialog(
        t('fileTree.createDocumentTitle'),
        t('fileTree.createDocumentPrompt', { folder: folderName }),
        { defaultValue: defaultName, confirmLabel: t('fileTree.createAction') },
      );
      if (name === null) return;
      // 对话框打开期间用户可能已切换到其他文件夹(跟随换根),在已看不见的
      // 目录里创建还会把用户拽回去;静默中止
      if (!fileTree.isPathInCurrentRoot(dirPath)) return;
      const issue = validateWorkspaceDocumentName(name);
      if (issue) {
        await confirmDialog(t('fileTree.createDocumentTitle'), t(FILE_NAME_ISSUE_MESSAGE[issue]), [
          t('common.ok'),
        ]);
        return;
      }
      const result = await fileTree.createDocumentInDir(dirPath, name);
      if ('error' in result) {
        await confirmDialog(
          t('fileTree.createDocumentTitle'),
          t(FILE_OP_ERROR_MESSAGE[result.error]),
          [t('common.ok')],
        );
        return;
      }
      await fileOps.openFilePath(result.path);
    },
    [fileTree, fileOps, t],
  );

  const handleFileTreeRenameFile = useCallback(
    async (entry: WorkspaceEntry): Promise<void> => {
      // 图片上传已捕获当前文档路径,重命名会让附件写入旧位置,须等待完成
      if (isImageUploadInProgress()) {
        await confirmDialog(t('confirm.imageSaving'), t('confirm.imageSavingFileOps'), [
          t('common.ok'),
        ]);
        return;
      }
      const affectedTabs = findTabsUnderPath(useStore.getState().tabs, entry.absolutePath);
      if (findTabsWithActiveReview(affectedTabs).length > 0) {
        await confirmDialog(
          t('fileTree.renameTitle'),
          t('fileTree.reviewInProgress', { name: entry.name }),
          [t('common.ok')],
        );
        return;
      }
      if (findTabsWithPendingExternalUpdate(affectedTabs).length > 0) {
        await confirmDialog(
          t('fileTree.renameTitle'),
          t('fileTree.pendingExternalUpdate', { name: entry.name }),
          [t('common.ok')],
        );
        return;
      }
      const newName = await promptDialog(
        t('fileTree.renameTitle'),
        t('fileTree.renamePrompt', { name: entry.name }),
        { defaultValue: entry.name, confirmLabel: t('fileTree.renameAction') },
      );
      if (newName === null || newName === entry.name) return;
      // 对话框打开期间用户可能已切换到其他文件夹(跟随换根),目标就此从树中
      // 消失;静默中止,不再作用于不可见目标
      if (!fileTree.isPathInCurrentRoot(entry.absolutePath)) return;
      // 对话框打开期间磁盘可能已被外部改动,执行前以最新标签状态复核,
      // 避免重命名沿用旧基线后静默覆盖未见过的外部版本;期间用户也可能
      // 在弹出的冲突选择中进入了审阅,需一并拦截
      const liveAffected = findTabsUnderPath(useStore.getState().tabs, entry.absolutePath);
      if (findTabsWithActiveReview(liveAffected).length > 0) {
        await confirmDialog(
          t('fileTree.renameTitle'),
          t('fileTree.reviewInProgress', { name: entry.name }),
          [t('common.ok')],
        );
        return;
      }
      if (findTabsWithPendingExternalUpdate(liveAffected).length > 0) {
        await confirmDialog(
          t('fileTree.renameTitle'),
          t('fileTree.pendingExternalUpdate', { name: entry.name }),
          [t('common.ok')],
        );
        return;
      }
      const issue = validateWorkspaceDocumentName(newName);
      if (issue) {
        await confirmDialog(t('fileTree.renameTitle'), t(FILE_NAME_ISSUE_MESSAGE[issue]), [
          t('common.ok'),
        ]);
        return;
      }
      const parentDir = parentDirectory(entry.absolutePath);
      if (!parentDir) return;
      // 带上打开标签的磁盘基线：编辑过的标签会清掉外部更新标志但故意保留
      // 旧基线（让下次保存冲突），只有主进程核对磁盘修改时间一致才放行，
      // 否则存在未处理的外部版本，重命名会把基线洗掉导致静默覆盖
      const baselineTab = liveAffected.find((tab) => tab.fileMtime != null);
      const renameTabIds = liveAffected.map((tab) => tab.id);
      // 重命名执行期间抑制自动保存:主进程已移动文件而标签路径尚未更新时,
      // 待存定时器若触发会把内容写回旧路径、重新创建旧文件
      fileOps.suppressAutoSaveForTabs(renameTabIds);
      const result = await fileTree.renameEntry(
        entry.absolutePath,
        parentDir,
        newName,
        baselineTab?.fileMtime ?? null,
      );
      if ('error' in result) {
        // 未发生重命名,恢复排期继续按原路径自动保存
        fileOps.restoreAutoSaveForTabs(renameTabIds);
        if (result.error === 'conflict') {
          await confirmDialog(
            t('fileTree.renameTitle'),
            t('fileTree.pendingExternalUpdate', { name: entry.name }),
            [t('common.ok')],
          );
          return;
        }
        await confirmDialog(t('fileTree.renameTitle'), t(FILE_OP_ERROR_MESSAGE[result.error]), [
          t('common.ok'),
        ]);
        return;
      }
      fileOps.renameTabFile(entry.absolutePath, result.path, result.mtime);
      // 标签已指向新路径,解除抑制——仍脏的标签恢复排期后按新路径自动保存
      fileOps.restoreAutoSaveForTabs(renameTabIds);
    },
    [fileTree, fileOps, t],
  );

  const handleFileTreeDeleteEntry = useCallback(
    async (entry: WorkspaceEntry): Promise<void> => {
      // 图片上传依赖目录中的旧路径,删除会中断写入甚至留下空目录,须等待完成
      if (isImageUploadInProgress()) {
        await confirmDialog(t('confirm.imageSaving'), t('confirm.imageSavingFileOps'), [
          t('common.ok'),
        ]);
        return;
      }
      const warning = decideDeleteWarning(useStore.getState().tabs, entry.absolutePath);
      if (warning === 'review-blocked') {
        await confirmDialog(
          t('fileTree.deleteTitle'),
          t('fileTree.reviewInProgress', { name: entry.name }),
          [t('common.ok')],
        );
        return;
      }
      if (warning === 'external-pending') {
        await confirmDialog(
          t('fileTree.deleteTitle'),
          t('fileTree.pendingExternalUpdate', { name: entry.name }),
          [t('common.ok')],
        );
        return;
      }
      const body =
        warning === 'dirty-open'
          ? t('fileTree.deleteDirtyConfirm', { name: entry.name })
          : t('fileTree.deleteConfirm', { name: entry.name });
      // 危险操作默认聚焦取消，确认键统一放在第二位
      const choice = await confirmDialog(
        t('fileTree.deleteTitle'),
        body,
        [
          t('common.cancel'),
          warning === 'dirty-open' ? t('fileTree.deleteAnyway') : t('fileTree.deleteAction'),
        ],
        { defaultId: 0, cancelId: 0 },
      );
      if (choice !== 1) return;
      // 确认框打开期间状态可能已变化，执行删除前以最新标签状态复核:
      // 外部改动/审阅到达时终止;刚输入的编辑延迟上报把标签变为未保存时,
      // 原确认没有警示内容丢失，必须补一次强确认
      const liveWarning = decideDeleteWarning(useStore.getState().tabs, entry.absolutePath);
      if (liveWarning === 'review-blocked' || liveWarning === 'external-pending') {
        await confirmDialog(
          t('fileTree.deleteTitle'),
          t(
            liveWarning === 'review-blocked'
              ? 'fileTree.reviewInProgress'
              : 'fileTree.pendingExternalUpdate',
            { name: entry.name },
          ),
          [t('common.ok')],
        );
        return;
      }
      if (liveWarning === 'dirty-open' && warning !== 'dirty-open') {
        const reconfirm = await confirmDialog(
          t('fileTree.deleteTitle'),
          t('fileTree.deleteDirtyConfirm', { name: entry.name }),
          [t('common.cancel'), t('fileTree.deleteAnyway')],
          { defaultId: 0, cancelId: 0 },
        );
        if (reconfirm !== 1) return;
      }
      // 切根核验放在全部确认框之后、执行之前:任一对话框打开期间用户都可
      // 能经 Ctrl+Tab 切换活动文档使跟随换根,目标就此从树中消失,静默中止
      if (!fileTree.isPathInCurrentRoot(entry.absolutePath)) return;
      const parentDir = parentDirectory(entry.absolutePath);
      if (!parentDir) return;
      const affectedTabs = findTabsUnderPath(useStore.getState().tabs, entry.absolutePath);
      const affectedIds = affectedTabs.map((tab) => tab.id);
      // 暂停受影响标签的自动保存(取消既有定时器且期间不再排期):移入回收站
      // 期间(网络盘可能数秒)的编辑保持未保存状态,保留的标签才能经「另存为」救回
      fileOps.suppressAutoSaveForTabs(affectedIds);
      // 记录此刻受影响标签的正文快照:期间正文发生变化的部分未经过警示,
      // 删除完成后保留不关
      const contentBefore = new Map(
        affectedTabs.map((tab) => [tab.id, tab.sourceContent] as const),
      );
      // 携带全部受影响打开文档的磁盘基线(目录删除时其内文档同样受保护):
      // 任一存在未处理的外部版本即拒绝,不让"只警示了用户自己修改"的确认
      // 连带丢弃未见过的外部内容
      const baselines = affectedTabs
        .filter((tab) => tab.filePath !== null && tab.fileMtime !== null)
        .map((tab) => ({ path: tab.filePath!, mtime: tab.fileMtime! }));
      const outcome = await fileTree.trashEntry(entry.absolutePath, parentDir, baselines);
      if (outcome !== 'ok') {
        // 删除未发生,恢复自动保存并为仍脏的标签重新排期
        fileOps.restoreAutoSaveForTabs(affectedIds);
        if (outcome === 'conflict') {
          await confirmDialog(
            t('fileTree.deleteTitle'),
            t('fileTree.pendingExternalUpdate', { name: entry.name }),
            [t('common.ok')],
          );
        } else {
          await confirmDialog(t('fileTree.deleteTitle'), t('fileTree.errorOpFailed'), [
            t('common.ok'),
          ]);
        }
        return;
      }
      const keptTabs = fileOps.forceCloseTabsUnderPath(entry.absolutePath, contentBefore);
      if (keptTabs.length > 0) {
        await confirmDialog(t('fileTree.deleteTitle'), t('fileTree.deleteKeptDirty'), [
          t('common.ok'),
        ]);
      }
    },
    [fileTree, fileOps, t],
  );

  const { closeRoot: closeFileTreeRoot } = fileTree;
  const findReplace = useFindReplace({ activeTabId, viewMode });
  const {
    close: closeFindReplace,
    isOpen: isFindReplaceOpen,
    notifyContentChanged: notifyFindContentChanged,
    open: openFindReplace,
  } = findReplace;

  const handleDocChange = useCallback(
    (doc: unknown) => {
      // 所见即所得编辑器隐藏后，延迟到达的旧通知不能覆盖源码审阅正文。
      if (useStore.getState().viewMode !== 'wysiwyg') return;
      notifyFindContentChanged();
      if (switchingRef.current) return;
      setSourceContent(editorHandle.current?.getMarkdown() ?? '');
      fileOps.markDirty();
      updateOutline(doc);
      updateWordCount(doc);
    },
    [fileOps, notifyFindContentChanged, setSourceContent, updateOutline, updateWordCount],
  );

  const handleDocInit = useCallback(
    (doc: unknown) => {
      updateOutline(doc);
      updateWordCount(doc, true);
    },
    [updateOutline, updateWordCount],
  );

  const handleSourceChange = useCallback(
    (state: SourceEditorState) => {
      setSourceContent(state.doc.toString());
      fileOps.markDirty();
      notifyFindContentChanged();
      updateSourceOutline(state);
      updateSourceWordCount(state);
    },
    [
      fileOps,
      notifyFindContentChanged,
      setSourceContent,
      updateSourceOutline,
      updateSourceWordCount,
    ],
  );

  useLayoutEffect(() => {
    if (prevTabIdRef.current === activeTabId) return;
    if (isImageUploadInProgress()) {
      setActiveTab(prevTabIdRef.current);
      void confirmDialog(tt('confirm.imageSaving'), tt('confirm.imageSavingSwitchTab'), [
        tt('common.ok'),
      ]);
      return;
    }
    if (!editorHandle.current) {
      prevTabIdRef.current = activeTabId;
      return;
    }

    const oldTabId = prevTabIdRef.current;
    const newTabId = activeTabId;
    const newTab = useStore.getState().tabs.find((t) => t.id === newTabId);
    if (!newTab) {
      prevTabIdRef.current = newTabId;
      return;
    }

    const targetMode = viewModeRef.current;

    if (oldTabId) {
      const scrollTop =
        targetMode === 'source'
          ? (sourceEditorHandle.current?.getScrollTop() ?? 0)
          : editorHandle.current.getScrollTop();
      const sourceContent =
        targetMode === 'source'
          ? (sourceEditorHandle.current?.getValue() ?? '')
          : editorHandle.current.getMarkdown();
      if (targetMode === 'source') {
        const state = sourceEditorHandle.current?.getEditorState();
        if (state) editorStateCache.capture(oldTabId, 'source', sourceContent, state);
      } else {
        const state = editorHandle.current.getEditorState();
        if (state) editorStateCache.capture(oldTabId, 'wysiwyg', sourceContent, state);
      }
      updateTab(oldTabId, { sourceContent, ...scrollPositionUpdate(targetMode, scrollTop) });
    }

    switchingRef.current = true;

    const savedState = editorStateCache.restore(newTabId, 'wysiwyg', newTab.sourceContent);
    if (savedState) {
      editorHandle.current.setEditorState(savedState);
    } else {
      editorHandle.current.setMarkdown(newTab.sourceContent);
    }
    editorHandle.current.skipFrontmatterIfSelected();

    if (targetMode === 'source') {
      const savedSourceState = editorStateCache.restore(newTabId, 'source', newTab.sourceContent);
      if (savedSourceState) {
        sourceEditorHandle.current?.setEditorState(savedSourceState);
      } else {
        sourceEditorHandle.current?.setValue(newTab.sourceContent);
      }
    }

    switchingRef.current = false;

    if (targetMode === 'source') {
      const sourceState = sourceEditorHandle.current?.getEditorState();
      if (sourceState) {
        updateSourceOutline(sourceState);
        updateSourceWordCount(sourceState, true);
      }
    } else {
      const doc = editorHandle.current.getEditorState()?.doc;
      if (doc) {
        updateOutline(doc);
        updateWordCount(doc, true);
      }
    }

    requestAnimationFrame(() => {
      if (viewModeRef.current !== targetMode) return;
      const scrollTop = readTabScrollTop(newTab, targetMode);
      if (targetMode === 'source') {
        sourceEditorHandle.current?.setScrollTop(scrollTop);
      } else {
        editorHandle.current?.setScrollTop(scrollTop);
      }
    });

    prevTabIdRef.current = newTabId;
  }, [
    activeTabId,
    setActiveTab,
    updateTab,
    updateOutline,
    updateSourceOutline,
    updateSourceWordCount,
    updateWordCount,
  ]);

  const prevModeRef = useRef(viewMode);
  useEffect(() => {
    const prev = prevModeRef.current;
    if (prev === viewMode) return;
    prevModeRef.current = viewMode;
    const tabId = useStore.getState().activeTabId;
    const scrollTop =
      prev === 'source'
        ? (sourceEditorHandle.current?.getScrollTop() ?? 0)
        : (editorHandle.current?.getScrollTop() ?? 0);
    updateTab(tabId, scrollPositionUpdate(prev, scrollTop));
    switchingRef.current = true;
    if (viewMode === 'source') {
      const tab = useStore.getState().tabs.find((item) => item.id === tabId);
      // 审阅块按 sourceContent 定位。进入审阅不得用所见即所得的重新
      // 序列化结果替换原文，否则换行/格式变化会使待审块失效。
      const md = tab?.reviewSession
        ? tab.sourceContent
        : (editorHandle.current?.getMarkdown() ?? '');
      const state = editorHandle.current?.getEditorState();
      if (state) editorStateCache.capture(tabId, 'wysiwyg', md, state);
      setSourceContent(md);
      const sourceState = editorStateCache.restore(tabId, 'source', md);
      if (sourceState) {
        sourceEditorHandle.current?.setEditorState(sourceState);
      } else {
        sourceEditorHandle.current?.setValue(md);
      }
    } else {
      const md = sourceEditorHandle.current?.getValue() ?? '';
      const state = sourceEditorHandle.current?.getEditorState();
      if (state) editorStateCache.capture(tabId, 'source', md, state);
      setSourceContent(md);
      const wysiwygState = editorStateCache.restore(tabId, 'wysiwyg', md);
      if (wysiwygState) {
        editorHandle.current?.setEditorState(wysiwygState);
      } else {
        editorHandle.current?.setMarkdown(md);
      }
    }
    switchingRef.current = false;
    if (viewMode === 'source') {
      const state = sourceEditorHandle.current?.getEditorState();
      if (state) {
        updateSourceOutline(state);
        updateSourceWordCount(state, true);
      }
    } else {
      const doc = editorHandle.current?.getEditorState()?.doc;
      if (doc) {
        updateOutline(doc);
        updateWordCount(doc, true);
      }
    }

    const activeTab = useStore.getState().tabs.find((tab) => tab.id === tabId);
    const targetScrollTop = activeTab ? readTabScrollTop(activeTab, viewMode) : 0;
    requestAnimationFrame(() => {
      if (viewModeRef.current !== viewMode) return;
      if (viewMode === 'source') {
        sourceEditorHandle.current?.setScrollTop(targetScrollTop);
      } else {
        editorHandle.current?.setScrollTop(targetScrollTop);
      }
    });
  }, [
    setSourceContent,
    updateTab,
    updateOutline,
    updateSourceOutline,
    updateSourceWordCount,
    updateWordCount,
    viewMode,
  ]);

  useEffect(() => {
    if (window.inkmark.syncSourceMode) {
      window.inkmark.syncSourceMode(viewMode === 'source');
    }
  }, [viewMode]);

  // 审阅视图只存在于源码模式（change-review.md）：活动标签出现待决外部改动时
  // 自动切入源码模式；期间 toggleViewMode 被锁定，处理完才能切回。
  useEffect(() => {
    if (pendingReviewCount > 0 && useStore.getState().viewMode === 'wysiwyg') {
      setViewMode('source');
    }
  }, [pendingReviewCount, setViewMode]);

  // 上面的模式/标签切换 effect 把源码编辑器内容同步为当前标签后，
  // 排空该标签排队中的待审块（后台标签入库时编辑器未就绪的情形）。
  // 本 effect 必须声明在切换 effect 之后，同一提交内后运行。
  useEffect(() => {
    drainQueuedReviewChunks(activeTabId);
  }, [activeTabId, viewMode]);

  // 源码编辑器上报的未决块数量写回活动标签（工具条、角标与锁定判定都读它）。
  const handleReviewCountChange = useCallback((count: number) => {
    const state = useStore.getState();
    state.updateTab(state.activeTabId, { pendingReviewCount: count });
  }, []);

  const handleSingleReviewComplete = useCallback(
    (content: string) => {
      void finishReview(useStore.getState().activeTabId, content);
    },
    [finishReview],
  );

  const finishAllReviewChunks = useCallback(
    (tabId: string, decision: 'accept' | 'reject'): boolean => {
      const state = useStore.getState();
      const tab = state.tabs.find((item) => item.id === tabId);
      if (!tab || state.activeTabId !== tabId || state.viewMode !== 'source') return false;

      // 模式刚切换时可能仍有块在队列中，先尝试完成注入；之后数量仍不一致
      // 就保持审阅状态，绝不把“什么也没执行”当作接受成功去保存旧正文。
      drainQueuedReviewChunks(tabId);
      const content = resolveAllReviewChunks(
        sourceEditorHandle.current,
        tab.pendingReviewCount,
        decision,
      );
      if (content == null) return false;

      void finishReview(tabId, content, true);
      return true;
    },
    [finishReview],
  );

  // 全部接受 / 全部拒绝（change-review.md 2026-09-04）：这是对整批外部改动的
  // 终局决定，先弹确认，确认后执行并把文档写回磁盘、结束审阅会话——不再有
  // 单独的「退出审阅」动作（写盘由核验后的 finishReview 显式发起）。
  const handleAcceptAll = useCallback(async () => {
    const tabId = useStore.getState().activeTabId;
    const tab = useStore.getState().tabs.find((t) => t.id === tabId);
    if (!tab || tab.pendingReviewCount === 0) return;
    const choice = await confirmDialog(
      tt('review.acceptAllConfirmTitle'),
      tt('review.acceptAllConfirmBody', { count: tab.pendingReviewCount }),
      [tt('review.acceptAllAndSave'), tt('common.cancel')],
      { defaultId: 1, cancelId: 1 },
    );
    if (choice !== 0) return;
    if (useStore.getState().activeTabId !== tabId) return;
    finishAllReviewChunks(tabId, 'accept');
  }, [finishAllReviewChunks]);

  const handleRejectAll = useCallback(async () => {
    const tabId = useStore.getState().activeTabId;
    const tab = useStore.getState().tabs.find((t) => t.id === tabId);
    if (!tab || tab.pendingReviewCount === 0) return;
    const choice = await confirmDialog(
      tt('review.rejectAllConfirmTitle'),
      tt('review.rejectAllConfirmBody', { count: tab.pendingReviewCount }),
      [tt('review.rejectAllAndSave'), tt('common.cancel')],
      { defaultId: 1, cancelId: 1 },
    );
    if (choice !== 0) return;
    if (useStore.getState().activeTabId !== tabId) return;
    finishAllReviewChunks(tabId, 'reject');
  }, [finishAllReviewChunks]);

  // 退出审阅（change-review.md 2026-09-04）：有未决块时点退出须表态（复用
  // 全部接受/拒绝的确认语义）；防御性兼容零块状态时直接收尾。
  const handleExitReview = useCallback(async () => {
    const tabId = useStore.getState().activeTabId;
    const tab = useStore.getState().tabs.find((t) => t.id === tabId);
    if (tab && tab.pendingReviewCount > 0) {
      const choice = await confirmDialog(
        tt('review.exitTitle'),
        tt('review.exitBody', { count: tab.pendingReviewCount }),
        [tt('review.exitAcceptAll'), tt('review.exitRejectAll'), tt('review.exitContinue')],
        { defaultId: 2, cancelId: 2 },
      );
      if (choice === 0 || choice === 1) {
        // 弹窗期间活动标签可能已被快捷键切换，只对发起退出时的标签执行。
        if (useStore.getState().activeTabId !== tabId) return;
        finishAllReviewChunks(tabId, choice === 0 ? 'accept' : 'reject');
      }
      return;
    }
    await fileOps.saveReviewResult(tabId);
  }, [finishAllReviewChunks, fileOps]);

  useEffect(() => {
    if (window.inkmark.syncOutlineVisible) {
      window.inkmark.syncOutlineVisible(outlineVisible);
    }
  }, [outlineVisible]);

  useEffect(() => {
    if (window.inkmark.syncFileTreeVisible) {
      window.inkmark.syncFileTreeVisible(fileTreeVisible);
    }
  }, [fileTreeVisible]);

  useEffect(() => {
    if (window.inkmark.syncToolbarVisible) {
      window.inkmark.syncToolbarVisible(toolbarVisible);
    }
  }, [toolbarVisible]);

  useEffect(() => {
    window.inkmark.onMenuNew(() => {
      void fileOps.newFile();
    });
    if (window.inkmark.onMenuNewBlankDoc) {
      window.inkmark.onMenuNewBlankDoc(() => {
        void fileOps.newBlankDoc();
      });
    }
    window.inkmark.onMenuOpen(() => {
      void fileOps.openFile();
    });
    window.inkmark.onMenuSave(() => {
      void fileOps.save();
    });
    window.inkmark.onMenuSaveAs(() => {
      void fileOps.saveAs();
    });
    if (window.inkmark.onMenuExportHtml) {
      window.inkmark.onMenuExportHtml(() => {
        void runExport('html');
      });
    }
    if (window.inkmark.onMenuExportPdf) {
      window.inkmark.onMenuExportPdf(() => {
        void runExport('pdf');
      });
    }
    window.inkmark.onMenuSettings(() => {
      closeFindReplace();
      setIsSettingsOpen(true);
    });
    if (window.inkmark.onMenuSetTheme) {
      window.inkmark.onMenuSetTheme((id) => {
        if (isThemeId(id)) setThemeId(id);
      });
    }
    if (window.inkmark.onMenuFind) {
      window.inkmark.onMenuFind(() => {
        const s = useStore.getState();
        const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
        if (activeTab?.isStartPage) return;
        openFindReplace(false);
      });
    }
    if (window.inkmark.onMenuReplace) {
      window.inkmark.onMenuReplace(() => {
        const s = useStore.getState();
        const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
        if (activeTab?.isStartPage) return;
        openFindReplace(true);
      });
    }
    if (window.inkmark.onMenuToggleSource) {
      window.inkmark.onMenuToggleSource(() => toggleViewMode());
    }
    if (window.inkmark.onMenuToggleOutline) {
      window.inkmark.onMenuToggleOutline(() => {
        const s = useStore.getState();
        s.setOutlineVisible(!s.outlineVisible);
      });
    }
    if (window.inkmark.onMenuOpenFolder) {
      window.inkmark.onMenuOpenFolder(() => {
        void fileTree.openFolderDialog().then((ok) => {
          if (ok) setFileTreeVisible(true);
        });
      });
    }
    if (window.inkmark.onMenuToggleFileTree) {
      window.inkmark.onMenuToggleFileTree(() => {
        const s = useStore.getState();
        s.setFileTreeVisible(!s.fileTreeVisible);
      });
    }
    if (window.inkmark.onMenuToggleToolbar) {
      window.inkmark.onMenuToggleToolbar(() => {
        const s = useStore.getState();
        s.setToolbarVisible(!s.toolbarVisible);
      });
    }
    if (window.inkmark.onMenuCloseTab) {
      window.inkmark.onMenuCloseTab(() => {
        void fileOps.closeTab();
      });
    }
    window.inkmark.onMenuClose(() => {
      void fileOps.closeWindow();
    });
    window.inkmark.onMenuCheckForUpdates(() => {
      closeFindReplace();
      setIsSettingsOpen(false);
      setIsUpdateOpen(true);
    });
    if (window.inkmark.onMenuRevealInFolder) {
      window.inkmark.onMenuRevealInFolder(() => {
        const s = useStore.getState();
        const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
        if (activeTab?.filePath) {
          void window.inkmark.revealInFolder(activeTab.filePath);
        }
      });
    }
    if (window.inkmark.onMenuCopyAsMarkdown) {
      window.inkmark.onMenuCopyAsMarkdown(() => {
        const s = useStore.getState();
        const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
        if (!activeTab || activeTab.isStartPage) return;
        const text =
          viewModeRef.current === 'source'
            ? (sourceEditorHandle.current?.getSelectedText() ?? '')
            : (editorHandle.current?.getSelectedMarkdown() ?? '');
        if (text) {
          void navigator.clipboard.writeText(text);
        }
      });
    }
    if (window.inkmark.onOpenFolderPath) {
      window.inkmark.onOpenFolderPath((path: string) => {
        void fileTree.openRoot(path).then((ok) => {
          if (ok) setFileTreeVisible(true);
        });
      });
    }
    window.inkmark.onOpenFilePath((path: string) => {
      void fileOps.openFilePath(path);
    });
  }, [
    closeFindReplace,
    fileOps,
    fileTree,
    openFindReplace,
    runExport,
    setFileTreeVisible,
    setThemeId,
    toggleViewMode,
  ]);

  useEffect(() => {
    // 全局功能快捷键：用捕获阶段监听，确保在 CodeMirror / ProseMirror 等编辑器 keymap
    // 之前拦截，避免按键被编辑器消费或与编辑器内置按键冲突。
    const handleGlobalShortcuts = (event: KeyboardEvent): void => {
      const platform = window.inkmark.platform;

      // 打开设置快捷键（在设置弹窗未打开时生效）
      if (!isSettingsOpen && comboMatchesEvent(event, shortcuts.settings, platform)) {
        event.preventDefault();
        event.stopPropagation();
        closeFindReplace();
        setIsSettingsOpen(true);
        return;
      }

      // 弹窗处于打开状态时，不触发下层编辑区快捷键
      if (isSettingsOpen) return;

      // 1. 新建标签页
      if (comboMatchesEvent(event, shortcuts.newFile, platform)) {
        event.preventDefault();
        event.stopPropagation();
        void fileOps.newFile();
        return;
      }

      // 2. 新建空白文档
      if (comboMatchesEvent(event, shortcuts.newBlankDoc, platform)) {
        event.preventDefault();
        event.stopPropagation();
        void fileOps.newBlankDoc();
        return;
      }

      // 3. 打开文件
      if (comboMatchesEvent(event, shortcuts.openFile, platform)) {
        event.preventDefault();
        event.stopPropagation();
        void fileOps.openFile();
        return;
      }

      // 4. 打开文件夹
      if (comboMatchesEvent(event, shortcuts.openFolder, platform)) {
        event.preventDefault();
        event.stopPropagation();
        void fileTree.openFolderDialog().then((ok) => {
          if (ok) setFileTreeVisible(true);
        });
        return;
      }

      // 5. 关闭标签页
      if (comboMatchesEvent(event, shortcuts.closeTab, platform)) {
        event.preventDefault();
        event.stopPropagation();
        void fileOps.closeTab();
        return;
      }

      // 6. 保存文档（非欢迎页）
      if (!isStartPage && comboMatchesEvent(event, shortcuts.save, platform)) {
        event.preventDefault();
        event.stopPropagation();
        void fileOps.save();
        return;
      }

      // 7. 另存为（非欢迎页）
      if (!isStartPage && comboMatchesEvent(event, shortcuts.saveAs, platform)) {
        event.preventDefault();
        event.stopPropagation();
        void fileOps.saveAs();
        return;
      }

      // 8. 切换源码模式
      if (comboMatchesEvent(event, shortcuts.toggleSource, platform)) {
        event.preventDefault();
        event.stopPropagation();
        if (isStartPage) {
          void fileOps.newBlankDoc();
          useStore.getState().setViewMode('source');
        } else {
          toggleViewMode();
        }
        return;
      }

      // 9. 查找
      if (!isStartPage && comboMatchesEvent(event, shortcuts.find, platform)) {
        event.preventDefault();
        event.stopPropagation();
        openFindReplace(false);
        return;
      }

      // 10. 替换
      if (!isStartPage && comboMatchesEvent(event, shortcuts.replace, platform)) {
        event.preventDefault();
        event.stopPropagation();
        openFindReplace(true);
        return;
      }

      // 11. 切换大纲
      if (comboMatchesEvent(event, shortcuts.toggleOutline, platform)) {
        event.preventDefault();
        event.stopPropagation();
        const s = useStore.getState();
        s.setOutlineVisible(!s.outlineVisible);
        return;
      }

      // 12. 切换文件树
      if (comboMatchesEvent(event, shortcuts.toggleFileTree, platform)) {
        event.preventDefault();
        event.stopPropagation();
        const s = useStore.getState();
        s.setFileTreeVisible(!s.fileTreeVisible);
        return;
      }

      // 13. 切换工具栏
      if (comboMatchesEvent(event, shortcuts.toggleToolbar, platform)) {
        event.preventDefault();
        event.stopPropagation();
        const s = useStore.getState();
        s.setToolbarVisible(!s.toolbarVisible);
        return;
      }

      // 14. 打开文件位置
      if (comboMatchesEvent(event, shortcuts.revealInFolder, platform)) {
        event.preventDefault();
        event.stopPropagation();
        const s = useStore.getState();
        const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
        if (activeTab?.filePath) {
          void window.inkmark.revealInFolder(activeTab.filePath);
        }
        return;
      }

      // 15. 保持窗口在最前端 (置顶)
      if (comboMatchesEvent(event, shortcuts.toggleAlwaysOnTop, platform)) {
        event.preventDefault();
        event.stopPropagation();
        void window.inkmark.toggleAlwaysOnTop?.();
        return;
      }

      // 16. 退出应用
      if (comboMatchesEvent(event, shortcuts.exit, platform)) {
        event.preventDefault();
        event.stopPropagation();
        void fileOps.closeWindow();
        return;
      }

      // 17. 工具栏格式快捷键（与工具栏按钮同一实现，双模式生效）
      if (!isStartPage) {
        for (const action of EDITOR_SHORTCUT_ACTIONS) {
          // HMR 下 store 可能仍是新增字段前的旧状态，缺 editorShortcuts，兜底跳过
          const combo = editorShortcuts?.[action];
          if (combo && comboMatchesEvent(event, combo, platform)) {
            event.preventDefault();
            event.stopPropagation();
            runEditorCommand(action);
            return;
          }
        }
        // 被接管的编辑器内置格式键（如默认的加粗 Mod-B）：用户改键或清除后，
        // 旧键位不再命中任何已设置快捷键，这里拦截吞掉，避免落回编辑器内置 keymap
        // 造成「改了键但旧键仍生效」的残留。
        if (EDITOR_BUILTIN_COMBOS.some((combo) => comboMatchesEvent(event, combo, platform))) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      // 18. 多标签页循环切换 (Ctrl+Tab / Ctrl+Shift+Tab)
      const isMod = platform === 'darwin' ? event.metaKey : event.ctrlKey;
      if (isMod && !event.altKey && event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        const s = useStore.getState();
        if (s.tabs.length > 1) {
          const currentIndex = s.tabs.findIndex((t) => t.id === s.activeTabId);
          if (currentIndex !== -1) {
            const delta = event.shiftKey ? -1 : 1;
            const nextIndex = (currentIndex + delta + s.tabs.length) % s.tabs.length;
            s.setActiveTab(s.tabs[nextIndex].id);
          }
        }
        return;
      }

      // 14. 复制为 Markdown (CmdOrCtrl+Shift+C)
      if (
        !isStartPage &&
        isMod &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'c'
      ) {
        event.preventDefault();
        event.stopPropagation();
        const text =
          viewModeRef.current === 'source'
            ? (sourceEditorHandle.current?.getSelectedText() ?? '')
            : (editorHandle.current?.getSelectedMarkdown() ?? '');
        if (text) {
          void navigator.clipboard.writeText(text);
        }
        return;
      }

      if (event.key === 'Escape' && isFindReplaceOpen) {
        event.preventDefault();
        closeFindReplace();
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts, true);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts, true);
  }, [
    closeFindReplace,
    editorShortcuts,
    fileOps,
    fileTree,
    isFindReplaceOpen,
    isSettingsOpen,
    isStartPage,
    openFindReplace,
    setFileTreeVisible,
    shortcuts,
    toggleViewMode,
  ]);

  useEffect(() => {
    if (isStartPage && isFindReplaceOpen) closeFindReplace();
  }, [closeFindReplace, isFindReplaceOpen, isStartPage]);

  useEffect(() => {
    if (window.inkmark.syncThemeId) {
      window.inkmark.syncThemeId(themeId);
    }
  }, [themeId]);

  useEffect(() => {
    if (window.inkmark.syncShortcuts) {
      window.inkmark.syncShortcuts(shortcuts);
    }
  }, [shortcuts]);

  const language = useStore((s) => s.language);
  useEffect(() => {
    if (window.inkmark.syncLanguage) {
      // 连同 navigator.language 一起上报：主进程「跟随系统」时以此为系统语言依据，
      // 与界面语言同源，避免主进程自身解析（app.getLocale）与界面不一致。
      window.inkmark.syncLanguage(language, navigator.language);
    }
  }, [language]);

  useEffect(() => {
    const handleDrop = async (e: DragEvent): Promise<void> => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        const path = (file as File & { path?: string }).path;
        if (path && /\.(md|markdown|txt)$/i.test(path)) {
          await fileOps.openFilePath(path);
        }
      }
    };
    const handleDragOver = (e: DragEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragover', handleDragOver);
    return () => {
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragover', handleDragOver);
    };
  }, [fileOps]);

  useEffect(() => {
    const onFocus = () => void fileOps.checkExternalChanges();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fileOps.checkExternalChanges();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fileOps]);

  // 活动标签的文件身份字段单独订阅:文件树重命名只改 fileName/filePath,
  // 不触碰 activeTabId/isDirty,标题 effect 必须依赖这些字段才能同步原生标题栏
  const activeTabFilePath = useStore(
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.filePath ?? null,
  );
  const activeTabFileName = useStore(
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.fileName ?? '',
  );
  const activeTabIsStartPage = useStore(
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.isStartPage ?? false,
  );

  useEffect(() => {
    const activeTab = useStore
      .getState()
      .tabs.find((tab) => tab.id === useStore.getState().activeTabId);
    const displayName = activeTab ? tabDisplayName(activeTab, t) : t('tabBar.unnamed');
    const mark = isDirty ? '\u2022 ' : '';
    window.inkmark.setWindowTitle(`${mark}${displayName} - InkMark`);
  }, [activeTabId, isDirty, t, activeTabFilePath, activeTabFileName, activeTabIsStartPage]);

  const prevStartPageRef = useRef(isStartPage);

  useEffect(() => {
    // 仅在从起始页切出（isStartPage: true → false）时聚焦，避免切换视图模式时抢焦点
    if (!prevStartPageRef.current || isStartPage) {
      prevStartPageRef.current = isStartPage;
      return;
    }
    prevStartPageRef.current = isStartPage;
    // 打开已有文档不抢焦点;新建文档(filePath 为空)才聚焦,便于立即输入。
    const current = useStore.getState();
    const switchedTab = current.tabs.find((t) => t.id === current.activeTabId);
    if (switchedTab?.filePath) return;
    const raf = requestAnimationFrame(() => {
      if (viewModeRef.current === 'source') {
        sourceEditorHandle.current?.focus();
      } else {
        editorHandle.current?.focus();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [isStartPage]);

  // 回到欢迎页(最后一个文档标签关闭)时清空文件树内容,让面板回到"未打开文件夹"引导态。
  // 面板可见性仍由设置控制,这里只清空内部记录的根目录与展开状态。
  const prevHadDocRef = useRef(!isStartPage);
  useEffect(() => {
    const hadDoc = prevHadDocRef.current;
    prevHadDocRef.current = !isStartPage;
    if (hadDoc && isStartPage) {
      closeFileTreeRoot();
    }
  }, [isStartPage, closeFileTreeRoot]);

  const outlinePanel = useResizablePanel({
    width: outlineWidth,
    onWidthChange: setOutlineWidth,
    side: outlineSide,
  });
  const fileTreePanel = useResizablePanel({
    width: fileTreeWidth,
    onWidthChange: setFileTreeWidth,
    side: fileTreeSide,
  });
  const isResizing = outlinePanel.isResizing || fileTreePanel.isResizing;

  return (
    <div className={`app ${isResizing ? 'resizing' : ''}`}>
      <TabBar
        onSelectTab={setActiveTab}
        onCloseTab={(id) => {
          void fileOps.closeTab(id);
        }}
        onNewTab={() => fileOps.newFile()}
      />
      <div className="app-body">
        {fileTreeVisible && fileTreeSide === 'left' && (
          <>
            <div style={{ width: fileTreeWidth, minWidth: fileTreeWidth }}>
              <FileTree
                state={fileTree}
                side="left"
                activeFilePath={activeFilePath}
                onOpenFile={(path) => void fileOps.openFilePath(path)}
                onCreateDocument={(dirPath) => void handleFileTreeCreateDocument(dirPath)}
                onRenameFile={(entry) => void handleFileTreeRenameFile(entry)}
                onDeleteEntry={(entry) => void handleFileTreeDeleteEntry(entry)}
              />
            </div>
            <div
              className={`resize-handle ${fileTreePanel.isResizing ? 'is-active' : ''}`}
              onMouseDown={fileTreePanel.handleResizeStart}
            />
          </>
        )}
        {outlineVisible && outlineSide === 'left' && (
          <>
            <div style={{ width: outlineWidth, minWidth: outlineWidth }}>
              <Outline side="left" />
            </div>
            <div
              className={`resize-handle ${outlinePanel.isResizing ? 'is-active' : ''}`}
              onMouseDown={outlinePanel.handleResizeStart}
            />
          </>
        )}
        {/* toolbar-width 档位类同时供工具栏与查找面板使用：面板按同一几何与工具栏右对齐 */}
        <main className={`editor-main toolbar-width-${toolbarWidth}`}>
          {isStartPage && (
            <StartPage
              onCreateBlank={() => setStartPage(false)}
              onOpenFile={() => void fileOps.openFile()}
              onOpenFolder={(path) => {
                if (path == null) return fileTree.openFolderDialog();
                return fileTree.openRoot(path).then((ok) => {
                  if (ok) setFileTreeVisible(true);
                  return ok;
                });
              }}
              onOpenPath={(path) => fileOps.openFilePath(path)}
            />
          )}
          {!isStartPage && toolbarVisible && <Toolbar onSave={() => void fileOps.save()} />}
          {!isStartPage && externalUpdatePending && !activeReviewSession && (
            <ExternalUpdateBanner
              onReload={fileOps.reloadActiveTab}
              onReview={fileOps.reviewActiveTab}
            />
          )}
          {!isStartPage && activeReviewSession && (
            <ReviewToolbar
              count={pendingReviewCount}
              externalChanged={externalUpdatePending}
              onSave={() => void fileOps.saveReviewResult(activeTabId)}
              onAcceptAll={() => void handleAcceptAll()}
              onRejectAll={() => void handleRejectAll()}
              onExit={() => void handleExitReview()}
            />
          )}
          {!isStartPage && isFindReplaceOpen && <FindReplaceBar controller={findReplace} />}
          <div
            className={`editor-view ${viewMode === 'wysiwyg' && !isStartPage ? '' : 'is-hidden'}`}
          >
            <Editor
              onDocChange={handleDocChange}
              onDocInit={handleDocInit}
              onFollowLink={handleFollowLink}
            />
          </div>
          <div
            className={`source-view ${viewMode === 'source' && !isStartPage ? '' : 'is-hidden'}`}
          >
            <Suspense fallback={null}>
              <SourceEditor
                onChange={handleSourceChange}
                onReviewCountChange={handleReviewCountChange}
                onSingleReviewComplete={handleSingleReviewComplete}
                onFollowLink={handleFollowLink}
              />
            </Suspense>
          </div>
          <StatusBar onOpenSettings={() => setIsSettingsOpen(true)} />
        </main>
        {outlineVisible && outlineSide === 'right' && (
          <>
            <div
              className={`resize-handle ${outlinePanel.isResizing ? 'is-active' : ''}`}
              onMouseDown={outlinePanel.handleResizeStart}
            />
            <div style={{ width: outlineWidth, minWidth: outlineWidth }}>
              <Outline side="right" />
            </div>
          </>
        )}
        {fileTreeVisible && fileTreeSide === 'right' && (
          <>
            <div
              className={`resize-handle ${fileTreePanel.isResizing ? 'is-active' : ''}`}
              onMouseDown={fileTreePanel.handleResizeStart}
            />
            <div style={{ width: fileTreeWidth, minWidth: fileTreeWidth }}>
              <FileTree
                state={fileTree}
                side="right"
                activeFilePath={activeFilePath}
                onOpenFile={(path) => void fileOps.openFilePath(path)}
                onCreateDocument={(dirPath) => void handleFileTreeCreateDocument(dirPath)}
                onRenameFile={(entry) => void handleFileTreeRenameFile(entry)}
                onDeleteEntry={(entry) => void handleFileTreeDeleteEntry(entry)}
              />
            </div>
          </>
        )}
      </div>
      <ConfirmDialog />
      <ExportProgressDialog />
      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog onClose={() => setIsSettingsOpen(false)} />
        </Suspense>
      )}
      {isUpdateOpen && (
        <Suspense fallback={null}>
          <UpdateDialog
            onClose={() => setIsUpdateOpen(false)}
            prepareToClose={fileOps.prepareToClose}
          />
        </Suspense>
      )}
    </div>
  );
}

export default function App() {
  return (
    <MilkdownProvider>
      <I18nProvider>
        <AppContent />
      </I18nProvider>
    </MilkdownProvider>
  );
}
