import { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

let mainWindow: BrowserWindow | null = null
let forceClose = false
let pendingFilePath: string | null = null
let currentThemeId = 'inkmark-light'
let currentSourceMode = false
let currentOutlineVisible = true

// ===== Window state persistence =====
interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

function getWindowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState {
  try {
    const statePath = getWindowStatePath()
    if (existsSync(statePath)) {
      return JSON.parse(readFileSync(statePath, 'utf-8'))
    }
  } catch {}
  return { width: 1200, height: 800, isMaximized: false }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getBounds()
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: win.isMaximized()
    }
    writeFileSync(getWindowStatePath(), JSON.stringify(state))
  } catch {}
}

function getFileFromArgs(argv: string[]): string | null {
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('-') && !arg.startsWith('--') && /\.(md|markdown|txt)$/i.test(arg)) {
      return arg
    }
  }
  return null
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = getFileFromArgs(argv)
    if (mainWindow) {
      if (filePath) {
        mainWindow.webContents.send('file:open-path', filePath)
      }
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function createWindow(): void {
  const savedState = loadWindowState()
  mainWindow = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    ...(savedState.x !== undefined && savedState.y !== undefined
      ? { x: savedState.x, y: savedState.y }
      : {}),
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'InkMark',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (savedState.isMaximized) {
    mainWindow.maximize()
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingFilePath) {
      mainWindow?.webContents.send('file:open-path', pendingFilePath)
      pendingFilePath = null
    }
  })

  mainWindow.on('close', (e) => {
    if (!forceClose) {
      e.preventDefault()
      mainWindow?.webContents.send('menu:close')
    } else {
      if (mainWindow) saveWindowState(mainWindow)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function applyNativeTheme(themeId: string): void {
  nativeTheme.themeSource = themeId.endsWith('-dark') ? 'dark' : 'light'
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '\u6587\u4ef6',
      submenu: [
        { label: '\u65b0\u5efa', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:new') },
        { label: '\u6253\u5f00...', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:open') },
        { type: 'separator' },
        { label: '\u4fdd\u5b58', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save') },
        { label: '\u53e6\u5b58\u4e3a...', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow?.webContents.send('menu:saveAs') }
      ]
    },
    {
      label: '\u4e3b\u9898',
      submenu: [
        { label: 'InkMark \u4eae\u8272', type: 'radio', checked: currentThemeId === 'inkmark-light', click: () => mainWindow?.webContents.send('menu:setTheme', 'inkmark-light') },
        { label: 'InkMark \u6697\u8272', type: 'radio', checked: currentThemeId === 'inkmark-dark', click: () => mainWindow?.webContents.send('menu:setTheme', 'inkmark-dark') },
        { label: 'GitHub \u4eae\u8272', type: 'radio', checked: currentThemeId === 'github-light', click: () => mainWindow?.webContents.send('menu:setTheme', 'github-light') },
        { label: 'GitHub \u6697\u8272', type: 'radio', checked: currentThemeId === 'github-dark', click: () => mainWindow?.webContents.send('menu:setTheme', 'github-dark') }
      ]
    },
    {
      label: '\u89c6\u56fe',
      submenu: [
        { label: '\u5927\u7eb2', type: 'checkbox', checked: currentOutlineVisible, click: () => mainWindow?.webContents.send('menu:toggleOutline') },
        { label: '\u6e90\u7801\u6a21\u5f0f', accelerator: 'CmdOrCtrl+/', type: 'checkbox', checked: currentSourceMode, click: () => mainWindow?.webContents.send('menu:toggleSource') },
        { type: 'separator' },
        { label: '\u653e\u5927', role: 'zoomIn' },
        { label: '\u7f29\u5c0f', role: 'zoomOut' },
        { label: '\u91cd\u7f6e\u7f29\u653e', role: 'resetZoom' }
      ]
    },
    {
      label: '\u5e2e\u52a9',
      submenu: [
        { label: '\u5173\u4e8e InkMark', role: 'about' }
      ]
    }
  ]
  Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  applyNativeTheme(currentThemeId)
  createMenu()
  createWindow()
  pendingFilePath = getFileFromArgs(process.argv)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.on('theme:syncThemeId', (_event, themeId: string) => {
  currentThemeId = themeId
  applyNativeTheme(themeId)
  createMenu()
})

ipcMain.on('menu:syncSource', (_event, checked: boolean) => {
  currentSourceMode = checked
  createMenu()
})

ipcMain.on('menu:syncOutline', (_event, visible: boolean) => {
  currentOutlineVisible = visible
  createMenu()
})

ipcMain.handle('dialog:openFile', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  const content = readFileSync(filePath, 'utf-8')
  return { path: filePath, content }
})

ipcMain.handle('file:save', async (_event, { content, path }: { content: string; path: string }) => {
  writeFileSync(path, content, 'utf-8')
})

ipcMain.handle('dialog:saveFileAs', async (_event, { content }: { content: string }) => {
  if (!mainWindow) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (result.canceled || !result.filePath) return null
  writeFileSync(result.filePath, content, 'utf-8')
  return result.filePath
})

ipcMain.handle('file:read', async (_event, { path }: { path: string }) => {
  const content = readFileSync(path, 'utf-8')
  return { path, content }
})

ipcMain.handle('window:setTitle', (_event, title: string) => {
  mainWindow?.setTitle(title)
})

ipcMain.handle('window:close', () => {
  forceClose = true
  mainWindow?.close()
})

ipcMain.handle('dialog:confirm', async (_event, { title, message, buttons }: { title: string; message: string; buttons: string[] }) => {
  if (!mainWindow) return 1
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title,
    message,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1
  })
  return result.response
})