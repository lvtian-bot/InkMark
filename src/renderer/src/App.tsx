import { useCallback, useEffect, useRef, useState } from 'react'
import { MilkdownProvider } from '@milkdown/react'
import { Editor } from './components/Editor'
import { SourceEditor } from './components/SourceEditor'
import { StatusBar } from './components/StatusBar'
import { Outline } from './components/Outline'
import { useTheme } from './hooks/useTheme'
import { useFile } from './hooks/useFile'
import { useOutline } from './hooks/useOutline'
import { useWordCount } from './hooks/useWordCount'
import { useStore } from './stores/useStore'
import type { ContentTheme } from './types'
import { editorHandle } from './editor-ref'

function AppContent() {
  const { theme, setTheme, contentTheme, setContentTheme } = useTheme()
  const { outline, updateOutline } = useOutline()
  const { updateWordCount } = useWordCount()
  const fileName = useStore((s) => s.fileName)
  const isDirty = useStore((s) => s.isDirty)
  const filePath = useStore((s) => s.filePath)
  const outlineWidth = useStore((s) => s.outlineWidth)
  const outlineVisible = useStore((s) => s.outlineVisible)
  const viewMode = useStore((s) => s.viewMode)
  const setOutlineWidth = useStore((s) => s.setOutlineWidth)
  const toggleViewMode = useStore((s) => s.toggleViewMode)

  const sourceRef = useRef<HTMLTextAreaElement>(null)

  const getMarkdown = useCallback(() => editorHandle.current?.getMarkdown() ?? '', [])
  const setMarkdown = useCallback((md: string) => editorHandle.current?.setMarkdown(md), [])

  const fileOps = useFile(getMarkdown, setMarkdown)

  const handleDocChange = useCallback(
    (doc: unknown) => {
      fileOps.markDirty()
      updateOutline(doc)
      updateWordCount(doc)
    },
    [fileOps, updateOutline, updateWordCount]
  )

  const handleSourceChange = useCallback(() => {
    fileOps.markDirty()
  }, [fileOps])

  const prevModeRef = useRef(viewMode)
  useEffect(() => {
    const prev = prevModeRef.current
    if (prev === viewMode) return
    prevModeRef.current = viewMode
    if (viewMode === 'source') {
      if (sourceRef.current) {
        sourceRef.current.value = editorHandle.current?.getMarkdown() ?? ''
      }
    } else {
      const md = sourceRef.current?.value ?? ''
      const current = editorHandle.current?.getMarkdown() ?? ''
      if (md !== current) {
        editorHandle.current?.setMarkdown(md)
      }
    }
  }, [viewMode])

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
    if (viewMode === 'source' && sourceRef.current) {
      sourceRef.current.value = editorHandle.current?.getMarkdown() ?? ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

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
    window.inkmark.onMenuClose(() => { void fileOps.handleClose() })
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

  return (
    <div className={`app ${isResizing ? 'resizing' : ''}`}>
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