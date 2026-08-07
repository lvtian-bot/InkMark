import { useCallback, useRef } from 'react'
import { useStore } from '../stores/useStore'

export function useFile(
  getMarkdown: () => string,
  rawSetMarkdown: (md: string) => void
) {
  const filePath = useStore((s) => s.filePath)
  const fileName = useStore((s) => s.fileName)
  const isDirty = useStore((s) => s.isDirty)
  const setFilePath = useStore((s) => s.setFilePath)
  const setDirty = useStore((s) => s.setDirty)
  const reset = useStore((s) => s.reset)

  const suppressDirtyRef = useRef(false)
  const setMarkdown = useCallback((md: string) => {
    suppressDirtyRef.current = true
    rawSetMarkdown(md)
  }, [rawSetMarkdown])

  const stateRef = useRef({ filePath, isDirty, fileName, getMarkdown, setMarkdown })
  stateRef.current = { filePath, isDirty, fileName, getMarkdown, setMarkdown }

  const updateTitle = useCallback(() => {
    const s = stateRef.current
    const mark = s.isDirty ? '\u2022 ' : ''
    window.inkmark.setWindowTitle(`${mark}${s.fileName} - InkMark`)
  }, [])

  const confirmUnsaved = useCallback(async (): Promise<boolean> => {
    const s = stateRef.current
    if (!s.isDirty) return true

    const choice = await window.inkmark.confirmDialog(
      '\u672a\u4fdd\u5b58\u7684\u66f4\u6539',
      '\u662f\u5426\u4fdd\u5b58\u5f53\u524d\u6587\u4ef6\u7684\u66f4\u6539\uff1f',
      ['\u4fdd\u5b58', '\u4e0d\u4fdd\u5b58', '\u53d6\u6d88']
    )

    if (choice === 2) return false
    if (choice === 0) {
      await doSave()
    }
    return true
  }, [])

  const doSave = useCallback(async (): Promise<boolean> => {
    const s = stateRef.current
    const md = s.getMarkdown()
    if (s.filePath) {
      await window.inkmark.saveFile(md, s.filePath)
      setDirty(false)
      updateTitle()
      return true
    }
    const newPath = await window.inkmark.saveFileAs(md)
    if (newPath) {
      setFilePath(newPath)
      updateTitle()
      return true
    }
    return false
  }, [setDirty, setFilePath, updateTitle])

  const save = useCallback(async () => {
    await doSave()
  }, [doSave])

  const saveAs = useCallback(async () => {
    const s = stateRef.current
    const md = s.getMarkdown()
    const newPath = await window.inkmark.saveFileAs(md)
    if (newPath) {
      setFilePath(newPath)
      updateTitle()
    }
  }, [setFilePath, updateTitle])

  const openFile = useCallback(async () => {
    if (!(await confirmUnsaved())) return
    const result = await window.inkmark.openFileDialog()
    if (!result) return
    stateRef.current.setMarkdown(result.content)
    setFilePath(result.path)
    setDirty(false)
    updateTitle()
  }, [confirmUnsaved, setFilePath, setDirty, updateTitle])

  const openFilePath = useCallback(async (path: string) => {
    if (!(await confirmUnsaved())) return
    const result = await window.inkmark.openFilePath(path)
    stateRef.current.setMarkdown(result.content)
    setFilePath(result.path)
    setDirty(false)
    updateTitle()
  }, [confirmUnsaved, setFilePath, setDirty, updateTitle])

  const newFile = useCallback(async () => {
    if (!(await confirmUnsaved())) return
    stateRef.current.setMarkdown('')
    reset()
    updateTitle()
  }, [confirmUnsaved, reset, updateTitle])

  const handleClose = useCallback(async () => {
    if (await confirmUnsaved()) {
      await window.inkmark.closeWindow()
    }
  }, [confirmUnsaved])

  const markDirty = useCallback(() => {
    if (suppressDirtyRef.current) {
      suppressDirtyRef.current = false
      return
    }
    setDirty(true)
    updateTitle()
  }, [setDirty, updateTitle])

  return {
    fileName,
    isDirty,
    filePath,
    newFile,
    openFile,
    openFilePath,
    save,
    saveAs,
    handleClose,
    markDirty
  }
}
