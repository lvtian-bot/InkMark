import { useCallback, useEffect, useState } from 'react'
import { MilkdownProvider } from '@milkdown/react'
import { Editor } from './components/Editor'
import { Outline } from './components/Outline'
import { TitleBar } from './components/TitleBar'
import { useTheme } from './hooks/useTheme'
import { useFile } from './hooks/useFile'
import { useOutline } from './hooks/useOutline'
import { useStore } from './stores/useStore'
import { editorHandle } from './editor-ref'

function AppContent() {
  const { theme, toggleTheme } = useTheme()
  const { outline, updateOutline } = useOutline()
  const fileName = useStore((s) => s.fileName)
  const isDirty = useStore((s) => s.isDirty)
  const outlineWidth = useStore((s) => s.outlineWidth)
  const outlineVisible = useStore((s) => s.outlineVisible)
  const setOutlineWidth = useStore((s) => s.setOutlineWidth)
  const setOutlineVisible = useStore((s) => s.setOutlineVisible)

  const getMarkdown = useCallback(() => editorHandle.current?.getMarkdown() ?? '', [])
  const setMarkdown = useCallback((md: string) => editorHandle.current?.setMarkdown(md), [])

  const fileOps = useFile(getMarkdown, setMarkdown)

  const handleDocChange = useCallback(
    (doc: unknown) => {
      fileOps.markDirty()
      updateOutline(doc)
    },
    [fileOps, updateOutline]
  )

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
    window.inkmark.onMenuToggleTheme(() => toggleTheme())
    window.inkmark.onMenuClose(() => { void fileOps.handleClose() })
    window.inkmark.onOpenFilePath((path: string) => { void fileOps.openFilePath(path) })
  }, [fileOps, toggleTheme])

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
      <TitleBar
        fileName={fileName}
        isDirty={isDirty}
        theme={theme}
        outlineVisible={outlineVisible}
        onToggleOutline={() => setOutlineVisible(!outlineVisible)}
        onToggleTheme={toggleTheme}
        onNew={() => { void fileOps.newFile() }}
        onOpen={() => { void fileOps.openFile() }}
        onSave={() => { void fileOps.save() }}
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
          <Editor onDocChange={handleDocChange} />
        </main>
      </div>
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
