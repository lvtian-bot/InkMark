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
    ipcRenderer.removeAllListeners('file:open-path')
    ipcRenderer.on('file:open-path', (_event, path: string) => cb(path))
  },
  onMenuNew: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:new')
    ipcRenderer.on('menu:new', () => cb())
  },
  onMenuOpen: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:open')
    ipcRenderer.on('menu:open', () => cb())
  },
  onMenuSave: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:save')
    ipcRenderer.on('menu:save', () => cb())
  },
  onMenuSaveAs: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:saveAs')
    ipcRenderer.on('menu:saveAs', () => cb())
  },
  onMenuSetTheme: (cb: (themeId: string) => void) => {
    ipcRenderer.removeAllListeners('menu:setTheme')
    ipcRenderer.on('menu:setTheme', (_event, themeId: string) => cb(themeId))
  },
  onMenuToggleSource: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:toggleSource')
    ipcRenderer.on('menu:toggleSource', () => cb())
  },
  onMenuToggleOutline: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:toggleOutline')
    ipcRenderer.on('menu:toggleOutline', () => cb())
  },
  onMenuClose: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:close')
    ipcRenderer.on('menu:close', () => cb())
  },
  setWindowTitle: (title: string) =>
    ipcRenderer.invoke('window:setTitle', title),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  confirmDialog: (title: string, message: string, buttons: string[]) =>
    ipcRenderer.invoke('dialog:confirm', { title, message, buttons }),
  syncThemeId: (themeId: string) => {
    ipcRenderer.send('theme:syncThemeId', themeId)
  },
  syncSourceMode: (checked: boolean) => {
    ipcRenderer.send('menu:syncSource', checked)
  },
  syncOutlineVisible: (visible: boolean) => {
    ipcRenderer.send('menu:syncOutline', visible)
  },
  platform: process.platform
}

try {
  contextBridge.exposeInMainWorld('inkmark', api)
} catch (error) {
  console.error('Failed to expose inkmark API:', error)
}