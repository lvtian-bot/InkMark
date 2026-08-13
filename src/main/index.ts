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
import { join, dirname, isAbsolute } from 'path';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  renameSync,
  unlinkSync,
  readdirSync,
} from 'fs';
import { pathToFileURL } from 'url';
import { autoUpdater } from 'electron-updater';
import { createFileWatchManager } from './file-watch-manager';
import { createWorkspaceWatchManager } from './workspace-watch-manager';
import { createImageStorage } from './image-storage';
import { createUpdateService } from './update-service';
import type {
  DiscardStoredImageRequest,
  ResolveImageSourceRequest,
  StoreImageRequest,
} from '../shared/image-storage';
import { isThemeId } from '../shared/theme';
import { filterWorkspaceEntries, type WorkspaceEntry } from '../shared/workspace-tree';
import {
  addOrUpdateRecent,
  normalizeRecentItems,
  removeRecent,
  type RecentItem,
  type RecentKind,
} from '../shared/recent-items';
import {
  DEFAULT_SHORTCUT_MAP,
  comboToAccelerator,
  normalizeShortcutMap,
  type ShortcutAction,
  type ShortcutMap,
} from '../shared/shortcuts';
import type { UpdateState } from '../shared/update-state';

let mainWindow: BrowserWindow | null = null;
let forceClose = false;
let pendingFilePaths: string[] = [];
let currentThemeId = 'inkmark-light';
let currentSourceMode = false;
let currentOutlineVisible = true;
let currentFileTreeVisible = false;
// 快捷键映射：启动时用默认值，渲染进程加载完用户设置后通过 shortcuts:sync 覆盖。
let currentShortcuts: ShortcutMap = normalizeShortcutMap(DEFAULT_SHORTCUT_MAP);
const PRODUCT_NAME = 'InkMark';
const GITHUB_REPOSITORY_URL = 'https://github.com/lvtian-bot/InkMark';
const GITHUB_RELEASES_URL = `${GITHUB_REPOSITORY_URL}/releases`;
const fileWatchManager = createFileWatchManager();
const workspaceWatchManager = createWorkspaceWatchManager();
const imageStorage = createImageStorage();
const updateService = createUpdateService({
  adapter: autoUpdater,
  currentVersion: app.getVersion(),
  supported: process.platform === 'win32' && app.isPackaged,
  onStateChange: (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:update-state', state);
    }
  },
});

app.enableSandbox();

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

interface SaveFileRequest {
  content: string;
  path: string;
  knownMtime?: number | null;
  force?: boolean;
}

interface SaveAsRequest {
  content: string;
  sourcePath?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDocumentPath(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value) && /\.(md|markdown|txt)$/i.test(value);
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && isAbsolute(value);
}

function isSaveFileRequest(value: unknown): value is SaveFileRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.content === 'string' &&
    isDocumentPath(value.path) &&
    (value.knownMtime === undefined ||
      value.knownMtime === null ||
      (typeof value.knownMtime === 'number' && Number.isFinite(value.knownMtime))) &&
    (value.force === undefined || typeof value.force === 'boolean')
  );
}

function isSaveAsRequest(value: unknown): value is SaveAsRequest {
  if (!isRecord(value) || typeof value.content !== 'string') return false;
  return (
    value.sourcePath === undefined || value.sourcePath === null || isDocumentPath(value.sourcePath)
  );
}

function isTrustedRenderer(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame;
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
let recentFilesCache: RecentItem[] | null = null;

function getRecentFilesPath(): string {
  return join(app.getPath('userData'), 'recent-files.json');
}

function getRecentFiles(): RecentItem[] {
  if (recentFilesCache === null) {
    try {
      const recentPath = getRecentFilesPath();
      if (existsSync(recentPath)) {
        const data = JSON.parse(readFileSync(recentPath, 'utf-8'));
        recentFilesCache = normalizeRecentItems(data);
      } else {
        recentFilesCache = [];
      }
    } catch {
      recentFilesCache = [];
    }
  }
  return recentFilesCache;
}

function writeRecentFiles(items: RecentItem[]): void {
  recentFilesCache = items;
  try {
    writeFileSync(getRecentFilesPath(), JSON.stringify(items), 'utf-8');
  } catch {
    /* ignore write errors */
  }
}

function addRecent(filePath: string, kind: RecentKind): void {
  const next = addOrUpdateRecent(getRecentFiles(), filePath, kind, MAX_RECENT_FILES);
  if (next === getRecentFiles()) return;
  writeRecentFiles(next);
}

function removeRecentItem(filePath: string): void {
  const next = removeRecent(getRecentFiles(), filePath);
  if (next.length === recentFilesCache!.length) return;
  writeRecentFiles(next);
}

// 上次在文件对话框中确认的路径(文件或文件夹),用作下次对话框的起始位置。
// 与 recent-files 解耦:recent 受 10 条上限约束、服务于开始页展示;lastDialogPath
// 单独持久化、不受条数影响,保证对话框始终能回到上次位置,不会被频繁打开的文件挤掉。
interface DialogState {
  lastPath: string | null;
}

let dialogStateCache: DialogState | null = null;

function getDialogStatePath(): string {
  return join(app.getPath('userData'), 'dialog-state.json');
}

function loadDialogState(): DialogState {
  if (dialogStateCache !== null) return dialogStateCache;
  try {
    const statePath = getDialogStatePath();
    if (existsSync(statePath)) {
      const data = JSON.parse(readFileSync(statePath, 'utf-8'));
      dialogStateCache = {
        lastPath: typeof data?.lastPath === 'string' ? data.lastPath : null,
      };
    } else {
      dialogStateCache = { lastPath: null };
    }
  } catch {
    dialogStateCache = { lastPath: null };
  }
  return dialogStateCache;
}

function getLastDialogPath(): string | undefined {
  return loadDialogState().lastPath ?? undefined;
}

function setLastDialogPath(path: string): void {
  const state = loadDialogState();
  if (state.lastPath === path) return;
  state.lastPath = path;
  try {
    writeFileSync(getDialogStatePath(), JSON.stringify(state), 'utf-8');
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
      sandbox: true,
      spellcheck: false,
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
    workspaceWatchManager.close();
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

function shortcutAccelerator(action: ShortcutAction): string {
  // normalizeShortcutMap 保证 combo 合法且含 mod，comboToAccelerator 一定返回有效字符串。
  return comboToAccelerator(currentShortcuts[action]) ?? '';
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建',
          accelerator: shortcutAccelerator('newFile'),
          click: () => mainWindow?.webContents.send('menu:new'),
        },
        {
          label: '打开...',
          accelerator: shortcutAccelerator('openFile'),
          click: () => mainWindow?.webContents.send('menu:open'),
        },
        {
          label: '打开文件夹…',
          accelerator: shortcutAccelerator('openFolder'),
          click: () => mainWindow?.webContents.send('menu:openFolder'),
        },
        {
          label: '关闭标签页',
          accelerator: shortcutAccelerator('closeTab'),
          click: () => mainWindow?.webContents.send('menu:closeTab'),
        },
        { type: 'separator' },
        {
          label: '保存',
          accelerator: shortcutAccelerator('save'),
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        {
          label: '另存为...',
          accelerator: shortcutAccelerator('saveAs'),
          click: () => mainWindow?.webContents.send('menu:saveAs'),
        },
        { type: 'separator' },
        {
          label: '设置...',
          accelerator: shortcutAccelerator('settings'),
          click: () => mainWindow?.webContents.send('menu:settings'),
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
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
          label: '文件树',
          type: 'checkbox',
          checked: currentFileTreeVisible,
          click: () => mainWindow?.webContents.send('menu:toggleFileTree'),
        },
        {
          label: '源码模式',
          accelerator: shortcutAccelerator('toggleSource'),
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
      label: '帮助',
      submenu: [
        {
          label: '检查更新...',
          click: () => mainWindow?.webContents.send('menu:checkForUpdates'),
        },
        {
          label: 'GitHub 仓库',
          click: () => void shell.openExternal(GITHUB_REPOSITORY_URL),
        },
        {
          label: `关于 ${PRODUCT_NAME}`,
          click: () => app.showAboutPanel(),
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
  app.setAboutPanelOptions({
    applicationName: PRODUCT_NAME,
    applicationVersion: `版本: ${app.getVersion()}`,
    credits: [
      `Electron: ${process.versions.electron}`,
      `Chromium: ${process.versions.chrome}`,
      `Node.js: ${process.versions.node}`,
    ].join('\n'),
  });
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
  workspaceWatchManager.close();
  imageStorage.close();
});

ipcMain.on('theme:syncThemeId', (event, themeId: unknown) => {
  if (!isTrustedRenderer(event) || !isThemeId(themeId)) return;
  currentThemeId = themeId;
  applyNativeTheme(themeId);
  createMenu();
  const isDark = themeId.endsWith('-dark');
  mainWindow?.setTitleBarOverlay({
    color: isDark ? '#181825' : '#eef4f9',
    symbolColor: isDark ? '#a6adc8' : '#6b6b6b',
  });
});

ipcMain.on('menu:syncSource', (event, checked: unknown) => {
  if (!isTrustedRenderer(event) || typeof checked !== 'boolean') return;
  currentSourceMode = checked;
  createMenu();
});

ipcMain.on('menu:syncOutline', (event, visible: unknown) => {
  if (!isTrustedRenderer(event) || typeof visible !== 'boolean') return;
  currentOutlineVisible = visible;
  createMenu();
});

ipcMain.on('menu:syncFileTree', (event, visible: unknown) => {
  if (!isTrustedRenderer(event) || typeof visible !== 'boolean') return;
  currentFileTreeVisible = visible;
  createMenu();
});

ipcMain.on('shortcuts:sync', (event, shortcuts: unknown) => {
  if (!isTrustedRenderer(event)) return;
  currentShortcuts = normalizeShortcutMap(shortcuts);
  createMenu();
});

ipcMain.on('menu:popup', (event) => {
  if (!isTrustedRenderer(event)) return;
  const menu = Menu.getApplicationMenu();
  if (menu && mainWindow) {
    menu.popup();
  }
});

ipcMain.handle('dialog:openFile', async (event) => {
  if (!isTrustedRenderer(event)) return null;
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    properties: ['openFile', 'multiSelections'],
    defaultPath: getLastDialogPath(),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const files: { path: string; content: string; mtime: number }[] = [];
  for (const filePath of result.filePaths) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const mtime = statSync(filePath).mtimeMs;
      addRecent(filePath, 'file');
      files.push({ path: filePath, content, mtime });
    } catch {
      /* skip unreadable files */
    }
  }
  if (files.length > 0) setLastDialogPath(files[0].path);
  return files.length > 0 ? files : null;
});

ipcMain.handle('file:save', async (event, request: unknown) => {
  if (!isTrustedRenderer(event) || !isSaveFileRequest(request)) {
    throw new Error('无效的文件保存请求。');
  }
  const { content, path, knownMtime, force } = request;
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
  workspaceWatchManager.recordSelfWrite(path);
  const mtime = fileWatchManager.performSelfWrite(path, () => atomicWriteFile(path, content));
  return { status: 'ok' as const, mtime };
});

ipcMain.handle('dialog:saveFileAs', async (event, request: unknown) => {
  if (!isTrustedRenderer(event) || !isSaveAsRequest(request)) {
    throw new Error('无效的另存为请求。');
  }
  const { content, sourcePath } = request;
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const filePath = result.filePath;
  imageStorage.copyAssetsForSaveAs(sourcePath ?? null, filePath);
  workspaceWatchManager.recordSelfWrite(filePath);
  const mtime = fileWatchManager.performSelfWrite(filePath, () =>
    atomicWriteFile(filePath, content),
  );
  return { path: filePath, mtime };
});

ipcMain.on('file:watch', (event, request: unknown) => {
  if (!isTrustedRenderer(event) || !isRecord(request) || !isDocumentPath(request.path)) return;
  const { path } = request;
  fileWatchManager.subscribe(event.sender, path);
});

ipcMain.on('file:unwatch', (event, request: unknown) => {
  if (!isTrustedRenderer(event) || !isRecord(request) || !isDocumentPath(request.path)) return;
  const { path } = request;
  fileWatchManager.unsubscribe(event.sender.id, path);
});

ipcMain.handle('file:read', async (event, request: unknown) => {
  if (!isTrustedRenderer(event) || !isRecord(request) || !isDocumentPath(request.path)) {
    return null;
  }
  const { path } = request;
  try {
    const content = readFileSync(path, 'utf-8');
    const mtime = statSync(path).mtimeMs;
    addRecent(path, 'file');
    return { path, content, mtime };
  } catch {
    // 文件已被删除或移动：从最近列表移除死链，避免反复点击失败
    removeRecentItem(path);
    return null;
  }
});

ipcMain.handle('file:getMtime', async (event, request: unknown) => {
  if (!isTrustedRenderer(event) || !isRecord(request) || !isDocumentPath(request.path)) {
    return { status: 'error' as const };
  }
  const { path } = request;
  try {
    return { status: 'ok' as const, mtime: statSync(path).mtimeMs };
  } catch {
    return { status: 'error' as const };
  }
});

ipcMain.handle('window:setTitle', (event, title: unknown) => {
  if (!isTrustedRenderer(event) || typeof title !== 'string' || title.length > 500) return;
  mainWindow?.setTitle(title);
});

ipcMain.handle('window:close', (event) => {
  if (!isTrustedRenderer(event)) return;
  forceClose = true;
  mainWindow?.close();
});

ipcMain.handle('recent:get', async (event) => {
  if (!isTrustedRenderer(event)) return [];
  return getRecentFiles();
});

ipcMain.handle('recent:remove', async (event, filePath: unknown) => {
  if (!isTrustedRenderer(event) || !isAbsolutePath(filePath)) return;
  removeRecentItem(filePath);
});

ipcMain.handle('recent:clear', async (event) => {
  if (!isTrustedRenderer(event)) return;
  writeRecentFiles([]);
});

ipcMain.handle('app:getInfo', (event) =>
  isTrustedRenderer(event)
    ? { name: PRODUCT_NAME, version: app.getVersion() }
    : { name: PRODUCT_NAME, version: '' },
);

ipcMain.handle('app:getUpdateState', (event): UpdateState =>
  isTrustedRenderer(event)
    ? updateService.getState()
    : { status: 'error', currentVersion: app.getVersion(), message: '更新请求来源无效。' },
);

ipcMain.handle('app:checkForUpdates', (event): Promise<UpdateState> => {
  if (!isTrustedRenderer(event)) {
    return Promise.resolve({
      status: 'error',
      currentVersion: app.getVersion(),
      message: '更新请求来源无效。',
    });
  }
  return updateService.check();
});

ipcMain.handle('app:downloadUpdate', (event): Promise<UpdateState> => {
  if (!isTrustedRenderer(event)) {
    return Promise.resolve({
      status: 'error',
      currentVersion: app.getVersion(),
      message: '更新请求来源无效。',
    });
  }
  return updateService.download();
});

ipcMain.handle('app:installUpdate', (event): boolean => {
  if (!isTrustedRenderer(event)) return false;
  forceClose = true;
  const started = updateService.install();
  if (!started) forceClose = false;
  return started;
});

ipcMain.handle('app:openReleases', (event) => {
  if (!isTrustedRenderer(event)) return;
  void shell.openExternal(GITHUB_RELEASES_URL);
});

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

ipcMain.handle('dialog:openFolder', async (event) => {
  if (!isTrustedRenderer(event) || !mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: getLastDialogPath(),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folderPath = result.filePaths[0];
  setLastDialogPath(folderPath);
  addRecent(folderPath, 'folder');
  return { path: folderPath };
});

ipcMain.handle('dir:list', async (event, request: unknown) => {
  if (!isTrustedRenderer(event) || !isRecord(request) || !isAbsolutePath(request.path)) {
    return null;
  }
  const directoryPath = request.path;
  try {
    const dirStat = statSync(directoryPath);
    if (!dirStat.isDirectory()) return null;
  } catch {
    return null;
  }
  try {
    const dirents = readdirSync(directoryPath, { withFileTypes: true });
    const entries: WorkspaceEntry[] = dirents.map((dirent) => ({
      name: dirent.name,
      absolutePath: join(directoryPath, dirent.name),
      isDirectory: dirent.isDirectory(),
    }));
    return { path: directoryPath, entries: filterWorkspaceEntries(entries) };
  } catch {
    return null;
  }
});

ipcMain.handle('shell:reveal', async (event, request: unknown) => {
  if (!isTrustedRenderer(event) || !isRecord(request) || !isAbsolutePath(request.path)) return;
  shell.showItemInFolder(request.path);
});

ipcMain.on('workspace:watch', (event, request: unknown) => {
  if (!isTrustedRenderer(event) || !isRecord(request) || !isAbsolutePath(request.path)) return;
  workspaceWatchManager.subscribe(event.sender, request.path);
});

ipcMain.on('workspace:unwatch', (event) => {
  if (!isTrustedRenderer(event)) return;
  workspaceWatchManager.unsubscribe(event.sender.id);
});
