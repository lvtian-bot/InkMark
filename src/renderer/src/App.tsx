import { useCallback, useEffect } from 'react'
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

  useEffect(() => {
    window.inkmark.onMenuNew(() => { void fileOps.newFile() })
    window.inkmark.onMenuOpen(() => { void fileOps.openFile() })
    window.inkmark.onMenuSave(() => { void fileOps.save() })
    window.inkmark.onMenuSaveAs(() => { void fileOps.saveAs() })
    window.inkmark.onMenuToggleTheme(() => toggleTheme())
    window.inkmark.onMenuClose(() => { void fileOps.handleClose() })
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
    <div className="app">
      <TitleBar
        fileName={fileName}
        isDirty={isDirty}
        theme={theme}
        onToggleTheme={toggleTheme}
        onNew={() => { void fileOps.newFile() }}
        onOpen={() => { void fileOps.openFile() }}
        onSave={() => { void fileOps.save() }}
      />
      <div className="app-body">
        <Outline />
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
