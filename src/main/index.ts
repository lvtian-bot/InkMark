import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  nativeTheme,
  protocol,
  net,
  shell,
} from 'electron';
import { join, dirname } from 'path';
import { readFileSync, writeFileSync, existsSync, statSync, renameSync, unlinkSync } from 'fs';
import { pathToFileURL } from 'url';
import { createFileWatchManager } from './file-watch-manager';
import { createImageStorage } from './image-storage';
import type {
  DiscardStoredImageRequest,
  ResolveImageSourceRequest,
  StoreImageRequest,
} from '../shared/image-storage';

let mainWindow: BrowserWindow | null = null;
let forceClose = false;
let pendingFilePaths: string[] = [];
let currentThemeId = 'inkmark-light';
let currentSourceMode = false;
let currentOutlineVisible = true;
const PRODUCT_NAME = 'InkMark';
const fileWatchManager = createFileWatchManager();
const imageStorage = createImageStorage();

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

function getWindowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState {
  try {
    const statePath = getWindowStatePath();
    if (existsSync(statePath)) {
      return JSON.parse(readFileSync(statePath, 'utf-8'));
    }
  } catch {
    /* ignore parse errors */
  }
  return { width: 1200, height: 800, isMaximized: false };
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getBounds();
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: win.isMaximized(),
    };
    writeFileSync(getWindowStatePath(), JSON.stringify(state));
  } catch {
    /* ignore write errors */
  }
}

const MAX_RECENT_FILES = 10;
let recentFilesCache: string[] | null = null;

function getRecentFilesPath(): string {
  return join(app.getPath('userData'), 'recent-files.json');
}

function getRecentFiles(): string[] {
  if (recentFilesCache === null) {
    try {
      const recentPath = getRecentFilesPath();
      if (existsSync(recentPath)) {
        const data = JSON.parse(readFileSync(recentPath, 'utf-8'));
        recentFilesCache = Array.isArray(data)
          ? data.filter((p): p is string => typeof p === 'string')
          : [];
      } else {
        recentFilesCache = [];
      }
    } catch {
      recentFilesCache = [];
    }
  }
  return recentFilesCache;
}

function addRecentFile(filePath: string): void {
  recentFilesCache = [filePath, ...getRecentFiles().filter((p) => p !== filePath)].slice(
    0,
    MAX_RECENT_FILES,
  );
  try {
    writeFileSync(getRecentFilesPath(), JSON.stringify(recentFilesCache), 'utf-8');
  } catch {
    /* ignore write errors */
  }
}

function removeRecentFile(filePath: string): void {
  const next = getRecentFiles().filter((p) => p !== filePath);
  if (next.length === recentFilesCache!.length) return;
  recentFilesCache = next;
  try {
    writeFileSync(getRecentFilesPath(), JSON.stringify(recentFilesCache), 'utf-8');
  } catch {
    /* ignore write errors */
  }
}

function getFileFromArgs(argv: string[]): string[] {
  const files: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-') && !arg.startsWith('--') && /\.(md|markdown|txt)$/i.test(arg)) {
      files.push(arg);
    }
  }
  return files;
}

function atomicWriteFile(filePath: string, content: string): number {
  const tempPath = join(
    dirname(filePath),
    `.inkmark-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tempPath);
    } catch {
      /* temp file may not exist */
    }
    throw err;
  }
  return statSync(filePath).mtimeMs;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const filePaths = getFileFromArgs(argv);
    if (mainWindow) {
      for (const fp of filePaths) {
        mainWindow.webContents.send('file:open-path', fp);
      }
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow(): void {
  const savedState = loadWindowState();
  mainWindow = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    ...(savedState.x !== undefined && savedState.y !== undefined
      ? { x: savedState.x, y: savedState.y }
      : {}),
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: PRODUCT_NAME,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      height: 36,
      color: '#eef4f9',
      symbolColor: '#6b6b6b',
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (savedState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingFilePaths.length > 0) {
      for (const fp of pendingFilePaths) {
        mainWindow?.webContents.send('file:open-path', fp);
      }
      pendingFilePaths = [];
    }
  });

  const isAppNavigation = (url: string): boolean => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    if (rendererUrl) {
      try {
        return new URL(url).origin === new URL(rendererUrl).origin;
      } catch {
        return false;
      }
    }
    try {
      const target = new URL(url);
      const appPage = new URL(pathToFileURL(join(__dirname, '../renderer/index.html')).toString());
      return target.protocol === appPage.protocol && target.pathname === appPage.pathname;
    } catch {
      return false;
    }
  };
  const openExternalUrl = (url: string): void => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
  };

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppNavigation(url)) return;
    event.preventDefault();
    openExternalUrl(url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (!forceClose) {
      e.preventDefault();
      mainWindow?.webContents.send('menu:close');
    } else {
      if (mainWindow) saveWindowState(mainWindow);
    }
  });

  mainWindow.on('closed', () => {
    fileWatchManager.close();
    mainWindow = null;
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function applyNativeTheme(themeId: string): void {
  nativeTheme.themeSource = themeId.endsWith('-dark') ? 'dark' : 'light';
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow?.webContents.send('menu:new'),
        },
        {
          label: '打开...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open'),
        },
        {
          label: '关闭标签页',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow?.webContents.send('menu:closeTab'),
        },
        { type: 'separator' },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        {
          label: '另存为...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu:saveAs'),
        },
        { type: 'separator' },
        {
          label: '设置...',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:settings'),
        },
      ],
    },
    {
      label: '主题',
      submenu: [
        {
          label: 'InkMark 亮色',
          type: 'radio',
          checked: currentThemeId === 'inkmark-light',
          click: () => mainWindow?.webContents.send('menu:setTheme', 'inkmark-light'),
        },
        {
          label: 'InkMark 暗色',
          type: 'radio',
          checked: currentThemeId === 'inkmark-dark',
          click: () => mainWindow?.webContents.send('menu:setTheme', 'inkmark-dark'),
        },
        {
          label: 'GitHub 亮色',
          type: 'radio',
          checked: currentThemeId === 'github-light',
          click: () => mainWindow?.webContents.send('menu:setTheme', 'github-light'),
        },
        {
          label: 'GitHub 暗色',
          type: 'radio',
          checked: currentThemeId === 'github-dark',
          click: () => mainWindow?.webContents.send('menu:setTheme', 'github-dark'),
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '大纲',
          type: 'checkbox',
          checked: currentOutlineVisible,
          click: () => mainWindow?.webContents.send('menu:toggleOutline'),
        },
        {
          label: '源码模式',
          accelerator: 'CmdOrCtrl+/',
          type: 'checkbox',
          checked: currentSourceMode,
          click: () => mainWindow?.webContents.send('menu:toggleSource'),
        },
        { type: 'separator' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '重置缩放', role: 'resetZoom' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: `关于 ${PRODUCT_NAME}`,
          click: () => mainWindow?.webContents.send('menu:about'),
        },
      ],
    },
  ];
  Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'inkmark-local',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
    },
  },
]);

app.whenReady().then(() => {
  applyNativeTheme(currentThemeId);
  createMenu();

  protocol.handle('inkmark-local', (request) => {
    const filePath = imageStorage.getProtocolFilePath(request.url);
    if (!filePath) return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });

  createWindow();
  pendingFilePaths = getFileFromArgs(process.argv);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  fileWatchManager.close();
  imageStorage.close();
});

ipcMain.on('theme:syncThemeId', (_event, themeId: string) => {
  currentThemeId = themeId;
  applyNativeTheme(themeId);
  createMenu();
  const isDark = themeId.endsWith('-dark');
  mainWindow?.setTitleBarOverlay({
    color: isDark ? '#181825' : '#eef4f9',
    symbolColor: isDark ? '#a6adc8' : '#6b6b6b',
  });
});

ipcMain.on('menu:syncSource', (_event, checked: boolean) => {
  currentSourceMode = checked;
  createMenu();
});

ipcMain.on('menu:syncOutline', (_event, visible: boolean) => {
  currentOutlineVisible = visible;
  createMenu();
});

ipcMain.on('menu:popup', () => {
  const menu = Menu.getApplicationMenu();
  if (menu && mainWindow) {
    menu.popup();
  }
});

ipcMain.handle('dialog:openFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const files: { path: string; content: string; mtime: number }[] = [];
  for (const filePath of result.filePaths) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const mtime = statSync(filePath).mtimeMs;
      addRecentFile(filePath);
      files.push({ path: filePath, content, mtime });
    } catch {
      /* skip unreadable files */
    }
  }
  return files.length > 0 ? files : null;
});

ipcMain.handle(
  'file:save',
  async (
    _event,
    {
      content,
      path,
      knownMtime,
      force,
    }: { content: string; path: string; knownMtime?: number | null; force?: boolean },
  ) => {
    if (!force && knownMtime != null) {
      try {
        const currentMtime = statSync(path).mtimeMs;
        if (currentMtime !== knownMtime) {
          return { status: 'conflict' as const };
        }
      } catch {
        return { status: 'conflict' as const };
      }
    }
    const mtime = fileWatchManager.performSelfWrite(path, () => atomicWriteFile(path, content));
    return { status: 'ok' as const, mtime };
  },
);

ipcMain.handle(
  'dialog:saveFileAs',
  async (_event, { content, sourcePath }: { content: string; sourcePath?: string | null }) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const filePath = result.filePath;
    imageStorage.copyAssetsForSaveAs(sourcePath ?? null, filePath);
    const mtime = fileWatchManager.performSelfWrite(filePath, () =>
      atomicWriteFile(filePath, content),
    );
    return { path: filePath, mtime };
  },
);

ipcMain.on('file:watch', (event, { path }: { path: string }) => {
  fileWatchManager.subscribe(event.sender, path);
});

ipcMain.on('file:unwatch', (event, { path }: { path: string }) => {
  fileWatchManager.unsubscribe(event.sender.id, path);
});

ipcMain.handle('file:read', async (_event, { path }: { path: string }) => {
  try {
    const content = readFileSync(path, 'utf-8');
    const mtime = statSync(path).mtimeMs;
    addRecentFile(path);
    return { path, content, mtime };
  } catch {
    // 文件已被删除或移动：从最近列表移除死链，避免反复点击失败
    removeRecentFile(path);
    return null;
  }
});

ipcMain.handle('file:getMtime', async (_event, { path }: { path: string }) => {
  try {
    return { status: 'ok' as const, mtime: statSync(path).mtimeMs };
  } catch {
    return { status: 'error' as const };
  }
});

ipcMain.handle('window:setTitle', (_event, title: string) => {
  mainWindow?.setTitle(title);
});

ipcMain.handle('window:close', () => {
  forceClose = true;
  mainWindow?.close();
});

ipcMain.handle('recent:get', async () => {
  return getRecentFiles();
});

ipcMain.handle('recent:remove', async (_event, filePath: string) => {
  removeRecentFile(filePath);
});

ipcMain.handle('recent:clear', async () => {
  recentFilesCache = [];
  try {
    writeFileSync(getRecentFilesPath(), JSON.stringify(recentFilesCache), 'utf-8');
  } catch {
    /* ignore write errors */
  }
});

ipcMain.handle('app:getInfo', () => ({
  name: PRODUCT_NAME,
  version: app.getVersion(),
}));

function isTrustedRenderer(event: Electron.IpcMainInvokeEvent): boolean {
  return event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame;
}

ipcMain.handle('image:store', (event, request: StoreImageRequest) => {
  if (!isTrustedRenderer(event)) {
    return { status: 'error', code: 'storage-failed', message: '图片请求来源无效。' } as const;
  }
  return imageStorage.store(request);
});

ipcMain.handle('image:discard', (event, request: DiscardStoredImageRequest) => {
  if (!isTrustedRenderer(event)) {
    return { status: 'error', message: '图片请求来源无效。' } as const;
  }
  return imageStorage.discard(request);
});

ipcMain.handle('image:resolveSource', (event, request: ResolveImageSourceRequest) => {
  if (!isTrustedRenderer(event)) {
    return { status: 'error', code: 'invalid-source', message: '图片请求来源无效。' } as const;
  }
  return imageStorage.resolveSource(request);
});
