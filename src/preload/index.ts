import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (content: string, path: string) =>
    ipcRenderer.invoke('file:save', { content, path }),
  saveFileAs: (content: string) =>
    ipcRenderer.invoke('dialog:saveFileAs', { content }),
  openFilePath: (path: string) =>
    ipcRenderer.invoke('file:read', { path }),
  onOpenFilePath: (cb: (path: string) => void) => {
    ipcRenderer.on('file:open-path', (_event, path: string) => cb(path))
  },
  onMenuNew: (cb: () => void) => {
    ipcRenderer.on('menu:new', () => cb())
  },
  onMenuOpen: (cb: () => void) => {
    ipcRenderer.on('menu:open', () => cb())
  },
  onMenuSave: (cb: () => void) => {
    ipcRenderer.on('menu:save', () => cb())
  },
  onMenuSaveAs: (cb: () => void) => {
    ipcRenderer.on('menu:saveAs', () => cb())
  },
  onMenuToggleTheme: (cb: () => void) => {
    ipcRenderer.on('menu:toggleTheme', () => cb())
  },
  onMenuClose: (cb: () => void) => {
    ipcRenderer.on('menu:close', () => cb())
  },
  setWindowTitle: (title: string) =>
    ipcRenderer.invoke('window:setTitle', title),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  confirmDialog: (title: string, message: string, buttons: string[]) =>
    ipcRenderer.invoke('dialog:confirm', { title, message, buttons }),
  platform: process.platform
}

try {
  contextBridge.exposeInMainWorld('inkmark', api)
} catch (error) {
  console.error('Failed to expose inkmark API:', error)
}
