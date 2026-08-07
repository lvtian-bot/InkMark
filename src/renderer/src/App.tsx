import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MilkdownProvider } from '@milkdown/react'
import { Editor } from './components/Editor'
import { SourceEditor } from './components/SourceEditor'
import { StatusBar } from './components/StatusBar'
import { Outline } from './components/Outline'
import { TabBar } from './components/TabBar'
import { useTheme } from './hooks/useTheme'
import { useFile } from './hooks/useFile'
import { useOutline } from './hooks/useOutline'
import { useWordCount } from './hooks/useWordCount'
import { useStore } from './stores/useStore'
import type { ContentTheme } from './types'
import { editorHandle } from './editor-ref'
import { editorStateCache } from './editor-state-cache'

function AppContent() {
  const { theme, setTheme, contentTheme, setContentTheme } = useTheme()
  const { updateOutline } = useOutline()
  const { updateWordCount } = useWordCount()

  const activeTabId = useStore((s) => s.activeTabId)
  const fileName = useStore((s) => s.fileName)
  const isDirty = useStore((s) => s.isDirty)
  const outlineWidth = useStore((s) => s.outlineWidth)
  const outlineVisible = useStore((s) => s.outlineVisible)
  const viewMode = useStore((s) => s.viewMode)
  const setOutlineWidth = useStore((s) => s.setOutlineWidth)
  const toggleViewMode = useStore((s) => s.toggleViewMode)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const updateTab = useStore((s) => s.updateTab)
  const setSourceContent = useStore((s) => s.setSourceContent)

  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const switchingRef = useRef(false)
  const prevTabIdRef = useRef(activeTabId)
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode

  const getMarkdown = useCallback(() => editorHandle.current?.getMarkdown() ?? '', [])
  const setMarkdown = useCallback((md: string) => editorHandle.current?.setMarkdown(md), [])

  const fileOps = useFile(getMarkdown, setMarkdown, sourceRef, viewMode)

  const handleDocChange = useCallback(
    (doc: unknown) => {
      if (switchingRef.current) return
      fileOps.markDirty()
      updateOutline(doc)
      updateWordCount(doc)
    },
    [fileOps, updateOutline, updateWordCount]
  )

  const handleSourceChange = useCallback(() => {
    fileOps.markDirty()
  }, [fileOps])

  useLayoutEffect(() => {
    if (prevTabIdRef.current === activeTabId) return
    if (!editorHandle.current) {
      prevTabIdRef.current = activeTabId
      return
    }

    const oldTabId = prevTabIdRef.current
    const newTabId = activeTabId
    const newTab = useStore.getState().tabs.find((t) => t.id === newTabId)
    if (!newTab) {
      prevTabIdRef.current = newTabId
      return
    }

    if (oldTabId) {
      const state = editorHandle.current.getEditorState()
      if (state) editorStateCache.set(oldTabId, state)
      const scrollTop = editorHandle.current.getScrollTop()
      const vm = viewModeRef.current
      const sourceContent = vm === 'source' && sourceRef.current
        ? sourceRef.current.value
        : editorHandle.current.getMarkdown()
      updateTab(oldTabId, { sourceContent, scrollTop })
    }

    switchingRef.current = true

    const savedState = editorStateCache.get(newTabId)
    if (savedState) {
      editorHandle.current.setEditorState(savedState)
    } else {
      editorHandle.current.setMarkdown(newTab.sourceContent)
      const newState = editorHandle.current.getEditorState()
      if (newState) editorStateCache.set(newTabId, newState)
    }

    if (viewModeRef.current === 'source' && sourceRef.current) {
      sourceRef.current.value = newTab.sourceContent
    }

    switchingRef.current = false

    if (!savedState) {
      const doc = editorHandle.current.getEditorState()?.doc
      if (doc) {
        updateOutline(doc)
        updateWordCount(doc)
      }
    }

    requestAnimationFrame(() => {
      editorHandle.current?.setScrollTop(newTab.scrollTop)
    })

    prevTabIdRef.current = newTabId
  }, [activeTabId, updateTab, updateOutline, updateWordCount])

  const prevModeRef = useRef(viewMode)
  useEffect(() => {
    const prev = prevModeRef.current
    if (prev === viewMode) return
    prevModeRef.current = viewMode
    if (viewMode === 'source') {
      const md = editorHandle.current?.getMarkdown() ?? ''
      if (sourceRef.current) {
        sourceRef.current.value = md
      }
      setSourceContent(md)
    } else {
      const md = sourceRef.current?.value ?? ''
      const current = editorHandle.current?.getMarkdown() ?? ''
      if (md !== current) {
        editorHandle.current?.setMarkdown(md)
      }
    }
  }, [viewMode, setSourceContent])

  useEffect(() => {
    if (window.inkmark.syncSourceMode) {
      window.inkmark.syncSourceMode(viewMode === 'source')
    }
  }, [viewMode])

  useEffect(() => {
    if (window.inkmark.syncOutlineVisible) {
      window.inkmark.syncOutlineVisible(outlineVisible)
    }
  }, [outlineVisible])

  useEffect(() => {
    window.inkmark.onMenuNew(() => { void fileOps.newFile() })
    window.inkmark.onMenuOpen(() => { void fileOps.openFile() })
    window.inkmark.onMenuSave(() => { void fileOps.save() })
    window.inkmark.onMenuSaveAs(() => { void fileOps.saveAs() })
    if (window.inkmark.onMenuSetTheme) {
      window.inkmark.onMenuSetTheme((themeId) => {
        const dashIdx = themeId.lastIndexOf('-')
        const ct = themeId.slice(0, dashIdx) as ContentTheme
        const t = themeId.slice(dashIdx + 1) as 'light' | 'dark'
        setContentTheme(ct)
        setTheme(t)
      })
    }
    if (window.inkmark.onMenuToggleSource) {
      window.inkmark.onMenuToggleSource(() => toggleViewMode())
    }
    if (window.inkmark.onMenuToggleOutline) {
      window.inkmark.onMenuToggleOutline(() => {
        const s = useStore.getState()
        s.setOutlineVisible(!s.outlineVisible)
      })
    }
    if (window.inkmark.onMenuCloseTab) {
      window.inkmark.onMenuCloseTab(() => { void fileOps.closeTab() })
    }
    window.inkmark.onMenuClose(() => { void fileOps.closeWindow() })
    window.inkmark.onOpenFilePath((path: string) => { void fileOps.openFilePath(path) })
  }, [fileOps, setContentTheme, setTheme, toggleViewMode])

  useEffect(() => {
    const themeId = `${contentTheme}-${theme}`
    if (window.inkmark.syncThemeId) {
      window.inkmark.syncThemeId(themeId)
    }
  }, [contentTheme, theme])

  useEffect(() => {
    const handleDrop = async (e: DragEvent): Promise<void> => {
      e.preventDefault()
      const file = e.dataTransfer?.files?.[0]
      if (file) {
        const path = (file as File & { path?: string }).path
        if (path && /\.(md|markdown|txt)$/i.test(path)) {
          await fileOps.openFilePath(path)
        }
      }
    }
    const handleDragOver = (e: DragEvent): void => {
      e.preventDefault()
    }
    window.addEventListener('drop', handleDrop)
    window.addEventListener('dragover', handleDragOver)
    return () => {
      window.removeEventListener('drop', handleDrop)
      window.removeEventListener('dragover', handleDragOver)
    }
  }, [fileOps])

  useEffect(() => {
    const mark = isDirty ? '\u2022 ' : ''
    window.inkmark.setWindowTitle(`${mark}${fileName} - InkMark`)
  }, [fileName, isDirty])

  const [isResizing, setIsResizing] = useState(false)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(500, Math.max(150, e.clientX))
      setOutlineWidth(newWidth)
    }
    const handleMouseUp = () => {
      setIsResizing(false)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, setOutlineWidth])

  return (
    <div className={`app ${isResizing ? 'resizing' : ''}`}>
      <TabBar
        onSelectTab={setActiveTab}
        onCloseTab={(id) => { void fileOps.closeTab(id) }}
        onNewTab={() => fileOps.newFile()}
      />
      <div className="app-body">
        {outlineVisible && (
          <>
            <div style={{ width: outlineWidth, minWidth: outlineWidth }}>
              <Outline />
            </div>
            <div className="resize-handle" onMouseDown={handleResizeStart} />
          </>
        )}
        <main className="editor-main">
          <div className={`editor-view ${viewMode === 'wysiwyg' ? '' : 'is-hidden'}`}>
            <Editor onDocChange={handleDocChange} />
          </div>
          <div className={`source-view ${viewMode === 'source' ? '' : 'is-hidden'}`}>
            <SourceEditor ref={sourceRef} onChange={handleSourceChange} />
          </div>
        </main>
      </div>
      <StatusBar />
    </div>
  )
}

export default function App() {
  return (
    <MilkdownProvider>
      <AppContent />
    </MilkdownProvider>
  )
}