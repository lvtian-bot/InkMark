import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EditorState as SourceEditorState } from '@codemirror/state';
import { MilkdownProvider } from '@milkdown/react';
import { Editor } from './components/Editor';
import { SourceEditor } from './components/SourceEditor';
import { StatusBar } from './components/StatusBar';
import { Outline } from './components/Outline';
import { FileTree } from './components/FileTree';
import { TabBar } from './components/TabBar';
import { Toolbar } from './components/Toolbar';
import { StartPage } from './components/StartPage';
import { ConfirmDialog } from './components/ConfirmDialog';
import { AboutDialog } from './components/AboutDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { FindReplaceBar } from './components/FindReplaceBar';
import { useTheme } from './hooks/useTheme';
import { useEditorFont } from './hooks/useEditorFont';
import { useFile } from './hooks/useFile';
import { useFileTree } from './hooks/useFileTree';
import { useResizablePanel } from './hooks/useResizablePanel';
import { useFindReplace } from './hooks/useFindReplace';
import { useOutline } from './hooks/useOutline';
import { useWordCount } from './hooks/useWordCount';
import { useStore } from './stores/useStore';
import { isThemeId } from './types';
import { editorHandle } from './editor-ref';
import { readTabScrollTop, scrollPositionUpdate } from './editor-position';
import { sourceEditorHandle } from './source-editor-ref';
import { editorStateCache } from './editor-state-cache';
import { confirmDialog } from './confirm-dialog';
import { isImageUploadInProgress } from './image-upload';

function AppContent() {
  const { themeId, setThemeId } = useTheme();
  useEditorFont();
  const { updateOutline, updateSourceOutline } = useOutline();
  const { updateWordCount, updateSourceWordCount } = useWordCount();

  const activeTabId = useStore((s) => s.activeTabId);
  const fileName = useStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.fileName ?? '未命名',
  );
  const isDirty = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.isDirty ?? false);
  const isStartPage = useStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.isStartPage ?? false,
  );
  const outlineWidth = useStore((s) => s.outlineWidth);
  const outlineVisible = useStore((s) => s.outlineVisible);
  const fileTreeVisible = useStore((s) => s.fileTreeVisible);
  const panelLayout = useStore((s) => s.panelLayout);
  const fileTreeWidth = useStore((s) => s.fileTreeWidth);
  const setFileTreeVisible = useStore((s) => s.setFileTreeVisible);
  const setFileTreeWidth = useStore((s) => s.setFileTreeWidth);
  // 单一布局字段派生两侧位置:outline-left → 大纲左/文件树右;outline-right 反之。
  // 两侧天然互斥,不会出现同侧并列。
  const outlineSide = panelLayout === 'outline-left' ? 'left' : 'right';
  const fileTreeSide = panelLayout === 'outline-left' ? 'right' : 'left';
  const activeFilePath = useStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.filePath ?? null,
  );
  const viewMode = useStore((s) => s.viewMode);
  const setOutlineWidth = useStore((s) => s.setOutlineWidth);
  const toggleViewMode = useStore((s) => s.toggleViewMode);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const updateTab = useStore((s) => s.updateTab);
  const setSourceContent = useStore((s) => s.setSourceContent);
  const setStartPage = useStore((s) => s.setStartPage);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const switchingRef = useRef(false);
  const prevTabIdRef = useRef(activeTabId);
  const viewModeRef = useRef(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  const setMarkdown = useCallback((md: string) => {
    if (!editorHandle.current) return false;
    editorHandle.current.setMarkdown(md);
    return true;
  }, []);

  const fileOps = useFile(setMarkdown, viewMode);
  const fileTree = useFileTree(activeFilePath);
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
      void confirmDialog('图片正在保存', '请等待图片插入完成后再切换文档。', ['确定']);
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
      setIsAboutOpen(false);
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
    window.inkmark.onMenuAbout(() => {
      closeFindReplace();
      setIsSettingsOpen(false);
      setIsAboutOpen(true);
    });
    window.inkmark.onOpenFilePath((path: string) => {
      void fileOps.openFilePath(path);
    });
  }, [closeFindReplace, fileOps, fileTree, setFileTreeVisible, setThemeId, toggleViewMode]);

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent): void => {
      if (isSettingsOpen || isAboutOpen) return;

      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const key = event.key.toLowerCase();
        if ((key === 'f' || key === 'h') && !isStartPage) {
          event.preventDefault();
          openFindReplace(key === 'h');
          return;
        }
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
    isAboutOpen,
    isFindReplaceOpen,
    isSettingsOpen,
    isStartPage,
    openFindReplace,
  ]);

  useEffect(() => {
    // 切换源码模式快捷键：Ctrl+/（与菜单「视图 → 源码模式」等效）与 Alt+E。
    // 用捕获阶段监听，确保在 CodeMirror（Mod-/ = 注释）和 ProseMirror（Mod-/ = 选中父节点）
    // 等编辑器 keymap 之前拦截，避免按键被编辑器消费导致"按了没反应"。
    const handleToggleSourceShortcut = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      const isCtrlSlash =
        (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === '/';
      const isAltE =
        event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'e';
      if (!isCtrlSlash && !isAltE) return;
      event.preventDefault();
      event.stopPropagation();
      toggleViewMode();
    };
    window.addEventListener('keydown', handleToggleSourceShortcut, true);
    return () => window.removeEventListener('keydown', handleToggleSourceShortcut, true);
  }, [toggleViewMode]);

  useEffect(() => {
    if (isStartPage && isFindReplaceOpen) closeFindReplace();
  }, [closeFindReplace, isFindReplaceOpen, isStartPage]);

  useEffect(() => {
    if (window.inkmark.syncThemeId) {
      window.inkmark.syncThemeId(themeId);
    }
  }, [themeId]);

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
    const mark = isDirty ? '\u2022 ' : '';
    window.inkmark.setWindowTitle(`${mark}${fileName} - InkMark`);
  }, [fileName, isDirty]);

  const prevStartPageRef = useRef(isStartPage);

  useEffect(() => {
    // 仅在从起始页切出（isStartPage: true → false）时聚焦，避免切换视图模式时抢焦点
    if (!prevStartPageRef.current || isStartPage) {
      prevStartPageRef.current = isStartPage;
      return;
    }
    prevStartPageRef.current = isStartPage;
    const raf = requestAnimationFrame(() => {
      if (viewModeRef.current === 'source') {
        sourceEditorHandle.current?.focus();
      } else {
        editorHandle.current?.focus();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [isStartPage]);

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
              <Outline />
            </div>
            <div
              className={`resize-handle ${outlinePanel.isResizing ? 'is-active' : ''}`}
              onMouseDown={outlinePanel.handleResizeStart}
            />
          </>
        )}
        <main className="editor-main">
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
          {!isStartPage && <Toolbar />}
          {!isStartPage && isFindReplaceOpen && <FindReplaceBar controller={findReplace} />}
          <div
            className={`editor-view ${viewMode === 'wysiwyg' && !isStartPage ? '' : 'is-hidden'}`}
          >
            <Editor onDocChange={handleDocChange} onDocInit={handleDocInit} />
          </div>
          <div
            className={`source-view ${viewMode === 'source' && !isStartPage ? '' : 'is-hidden'}`}
          >
            <SourceEditor onChange={handleSourceChange} />
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
              <Outline />
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
      {isSettingsOpen && <SettingsDialog onClose={() => setIsSettingsOpen(false)} />}
      {isAboutOpen && <AboutDialog onClose={() => setIsAboutOpen(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <MilkdownProvider>
      <AppContent />
    </MilkdownProvider>
  );
}
