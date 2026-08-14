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
import { useTheme } from './hooks/useTheme';
import { useEditorFont } from './hooks/useEditorFont';
import { useFile } from './hooks/useFile';
import { useFileTree } from './hooks/useFileTree';
import { useResizablePanel } from './hooks/useResizablePanel';
import { useFindReplace } from './hooks/useFindReplace';
import { useOutline } from './hooks/useOutline';
import { useWordCount } from './hooks/useWordCount';
import { useStore } from './stores/useStore';
import { I18nProvider, t as tt, useI18n } from './i18n';
import { tabDisplayName } from './tab-name';
import { isThemeId } from './types';
import { editorHandle } from './editor-ref';
import { readTabScrollTop, scrollPositionUpdate } from './editor-position';
import { sourceEditorHandle } from './source-editor-ref';
import { editorStateCache } from './editor-state-cache';
import { confirmDialog } from './confirm-dialog';
import { isImageUploadInProgress } from './image-upload';
import { comboMatchesEvent } from './shortcut-recorder';

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

function AppContent() {
  const { themeId, setThemeId } = useTheme();
  const { t } = useI18n();
  useEditorFont();
  const { updateOutline, updateSourceOutline } = useOutline();
  const { updateWordCount, updateSourceWordCount } = useWordCount();

  const activeTabId = useStore((s) => s.activeTabId);
  const isDirty = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.isDirty ?? false);
  const isStartPage = useStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.isStartPage ?? false,
  );
  const outlineWidth = useStore((s) => s.outlineWidth);
  const toolbarWidth = useStore((s) => s.toolbarWidth);
  const outlineVisible = useStore((s) => s.outlineVisible);
  const fileTreeVisible = useStore((s) => s.fileTreeVisible);
  const panelLayout = useStore((s) => s.panelLayout);
  const fileTreeWidth = useStore((s) => s.fileTreeWidth);
  const shortcuts = useStore((s) => s.shortcuts);
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
    return true;
  }, []);

  const fileOps = useFile(setMarkdown, viewMode);
  const fileTree = useFileTree(activeFilePath);
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
      const md = editorHandle.current?.getMarkdown() ?? '';
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
    window.inkmark.onMenuSettings(() => {
      closeFindReplace();
      setIsSettingsOpen(true);
    });
    if (window.inkmark.onMenuSetTheme) {
      window.inkmark.onMenuSetTheme((id) => {
        if (isThemeId(id)) setThemeId(id);
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
    window.inkmark.onOpenFilePath((path: string) => {
      void fileOps.openFilePath(path);
    });
  }, [closeFindReplace, fileOps, fileTree, setFileTreeVisible, setThemeId, toggleViewMode]);

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent): void => {
      if (isSettingsOpen) return;

      const platform = window.inkmark.platform;
      if (!isStartPage && comboMatchesEvent(event, shortcuts.find, platform)) {
        event.preventDefault();
        openFindReplace(false);
        return;
      }
      if (!isStartPage && comboMatchesEvent(event, shortcuts.replace, platform)) {
        event.preventDefault();
        openFindReplace(true);
        return;
      }

      if (event.key === 'Escape' && isFindReplaceOpen) {
        event.preventDefault();
        closeFindReplace();
      }
    };

    window.addEventListener('keydown', handleFindShortcut);
    return () => window.removeEventListener('keydown', handleFindShortcut);
  }, [
    closeFindReplace,
    isFindReplaceOpen,
    isSettingsOpen,
    isStartPage,
    openFindReplace,
    shortcuts,
  ]);

  useEffect(() => {
    // 切换源码模式快捷键：用户配置的主快捷键（默认 Ctrl+/，与菜单「视图 → 源码模式」等效）
    // 与固定第二入口 Alt+E。用捕获阶段监听，确保在 CodeMirror（Mod-/ = 注释）和
    // ProseMirror（Mod-/ = 选中父节点）等编辑器 keymap 之前拦截，避免按键被编辑器消费。
    const handleToggleSourceShortcut = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      const matchesMain = comboMatchesEvent(event, shortcuts.toggleSource, window.inkmark.platform);
      const isAltE =
        event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'e';
      if (!matchesMain && !isAltE) return;
      event.preventDefault();
      event.stopPropagation();
      toggleViewMode();
    };
    window.addEventListener('keydown', handleToggleSourceShortcut, true);
    return () => window.removeEventListener('keydown', handleToggleSourceShortcut, true);
  }, [shortcuts, toggleViewMode]);

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

  useEffect(() => {
    const activeTab = useStore
      .getState()
      .tabs.find((tab) => tab.id === useStore.getState().activeTabId);
    const displayName = activeTab ? tabDisplayName(activeTab, t) : t('tabBar.unnamed');
    const mark = isDirty ? '\u2022 ' : '';
    window.inkmark.setWindowTitle(`${mark}${displayName} - InkMark`);
  }, [activeTabId, isDirty, t]);

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
                const openResult =
                  path != null
                    ? fileTree.openRoot(path).then(() => true)
                    : fileTree.openFolderDialog();
                void openResult.then((ok) => {
                  if (ok) setFileTreeVisible(true);
                });
              }}
              onOpenPath={(path) => void fileOps.openFilePath(path)}
            />
          )}
          {!isStartPage && <Toolbar onSave={() => void fileOps.save()} />}
          {!isStartPage && externalUpdatePending && (
            <ExternalUpdateBanner onReload={() => void fileOps.reloadActiveTab()} />
          )}
          {!isStartPage && isFindReplaceOpen && <FindReplaceBar controller={findReplace} />}
          <div
            className={`editor-view ${viewMode === 'wysiwyg' && !isStartPage ? '' : 'is-hidden'}`}
          >
            <Editor onDocChange={handleDocChange} onDocInit={handleDocInit} />
          </div>
          <div
            className={`source-view ${viewMode === 'source' && !isStartPage ? '' : 'is-hidden'}`}
          >
            <Suspense fallback={null}>
              <SourceEditor onChange={handleSourceChange} />
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
              />
            </div>
          </>
        )}
      </div>
      <ConfirmDialog />
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
