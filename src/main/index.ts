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
import { join, dirname, isAbsolute, basename } from 'path';
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
import { createFileWatchManager } from './file-watch-manager';
import { createWorkspaceWatchManager } from './workspace-watch-manager';
import { createImageStorage } from './image-storage';
import { createUpdateService, type UpdateService } from './update-service';
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
import {
  normalizeLanguageSetting,
  resolveLocale,
  translateByLocale,
  type LanguageSetting,
  type LocaleId,
  type MessageKey,
} from '../shared/i18n';

let mainWindow: BrowserWindow | null = null;
let forceClose = false;
let pendingFilePaths: string[] = [];
let currentThemeId = 'inkmark-light';
let currentSourceMode = false;
let currentOutlineVisible = true;
let currentFileTreeVisible = false;
let currentToolbarVisible = true;
let currentAlwaysOnTop = false;
// 快捷键映射：启动时用默认值，渲染进程加载完用户设置后通过 shortcuts:sync 覆盖。
let currentShortcuts: ShortcutMap = normalizeShortcutMap(DEFAULT_SHORTCUT_MAP);
// 语言：启动时跟随系统；渲染进程加载完用户设置后通过 language:sync 覆盖。
// 注意：不在模块加载期调用 app.getLocale()——ready 之前语言可能尚未确定，
// 会错误地得到 en-US；系统语言统一在 ready 后或收到渲染进程上报时再解析。
let currentLanguage: LanguageSetting = 'system';
let currentLocale: LocaleId = 'en';
let systemLanguage = '';
const t = (key: MessageKey, params?: Record<string, string | number>): string =>
  translateByLocale(currentLocale, key, params);

/** 解析系统首选语言：优先取用户首选语言列表第一项（与渲染端 navigator.language 同源）。 */
function resolveSystemLanguage(): string {
  const preferred = app.getPreferredSystemLanguages()[0];
  if (preferred && preferred.trim() !== '') return preferred;
  return app.getLocale();
}

/** 应用语言设置并同步原生菜单与关于面板；实际语言未变化时跳过重建。 */
function applyLocale(language: LanguageSetting, system: string): void {
  const next = resolveLocale(language, system);
  if (next === currentLocale) return;
  currentLocale = next;
  createMenu();
  app.setAboutPanelOptions({
    applicationName: PRODUCT_NAME,
    applicationVersion: t('about.version', { version: app.getVersion() }),
    credits: [
      `Electron: ${process.versions.electron}`,
      `Chromium: ${process.versions.chrome}`,
      `Node.js: ${process.versions.node}`,
    ].join('\n'),
  });
}
const PRODUCT_NAME = 'InkMark';
const GITHUB_REPOSITORY_URL = 'https://github.com/lvtian-bot/InkMark';
const GITHUB_RELEASES_URL = `${GITHUB_REPOSITORY_URL}/releases`;
const fileWatchManager = createFileWatchManager();
const workspaceWatchManager = createWorkspaceWatchManager();
const imageStorage = createImageStorage({ t });
// electron-updater 依赖图较大，推迟到首次访问更新功能时再动态加载，
// 避免在 app ready 前评估整棵模块、拖慢窗口创建。
let updateServicePromise: Promise<UpdateService> | null = null;
function getUpdateService(): Promise<UpdateService> {
  if (!updateServicePromise) {
    updateServicePromise = import('electron-updater').then(({ autoUpdater }) =>
      createUpdateService({
        adapter: autoUpdater,
        currentVersion: app.getVersion(),
        supported: process.platform === 'win32' && app.isPackaged,
        t,
        onStateChange: (state) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('app:update-state', state);
          }
        },
      }),
    );
  }
  return updateServicePromise;
}

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

function getThemeStatePath(): string {
  return join(app.getPath('userData'), 'theme.json');
}

/**
 * 渲染进程的主题设置存在 localStorage 里,主进程启动前读不到;
 * 由 theme:syncThemeId 落盘到 userData/theme.json,下次启动在 whenReady 里恢复,
 * 保证窗口底色、原生主题与主题菜单勾选在首帧前就与上次一致。
 */
function loadPersistedThemeId(): string | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(getThemeStatePath(), 'utf-8'));
    if (isRecord(raw) && isThemeId(raw.themeId)) return raw.themeId;
  } catch {
    /* ignore read/parse errors */
  }
  return null;
}

function persistThemeId(themeId: string): void {
  try {
    writeFileSync(getThemeStatePath(), JSON.stringify({ themeId }));
  } catch {
    /* ignore write errors */
  }
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
    // 最大化时 getBounds() 返回最大化几何，直接保存会让下次「还原」得到一个铺满屏幕的
    // 普通窗口；getNormalBounds() 恒为还原态边界，非最大化时与 getBounds() 一致。
    const bounds = win.getNormalBounds();
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
const MAX_RECENT_FOLDERS = 3;
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
  const next = addOrUpdateRecent(getRecentFiles(), filePath, kind, {
    maxFiles: MAX_RECENT_FILES,
    maxFolders: MAX_RECENT_FOLDERS,
  });
  if (next === getRecentFiles()) return;
  writeRecentFiles(next);
  createMenu();
}

function removeRecentItem(filePath: string): void {
  const next = removeRecent(getRecentFiles(), filePath);
  if (next.length === recentFilesCache!.length) return;
  writeRecentFiles(next);
  createMenu();
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
  const chrome = chromeColorsFor(currentThemeId);
  mainWindow = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    ...(savedState.x !== undefined && savedState.y !== undefined
      ? { x: savedState.x, y: savedState.y }
      : {}),
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: chrome.background,
    title: PRODUCT_NAME,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      height: 36,
      color: chrome.overlay,
      symbolColor: chrome.symbol,
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

/**
 * 窗口启动底色与标题栏按钮区颜色,theme-architecture.md 记录的两个同步点
 * (createWindow 初始值与 theme:syncThemeId)统一从这里取值,改色只改这里。
 * 启动底色取主题内容区底色(浅色纯白、深色 #1e1e2e),首帧前不出现外来色块;
 * 按钮区颜色与标签栏同色(浅色 #eef4f9、深色 #181825)。
 */
function chromeColorsFor(themeId: string): { overlay: string; symbol: string; background: string } {
  return themeId.endsWith('-dark')
    ? { overlay: '#181825', symbol: '#a6adc8', background: '#1e1e2e' }
    : { overlay: '#eef4f9', symbol: '#6b6b6b', background: '#ffffff' };
}

function shortcutAccelerator(action: ShortcutAction): string {
  // normalizeShortcutMap 保证 combo 合法且含 mod，comboToAccelerator 一定返回有效字符串。
  return comboToAccelerator(currentShortcuts[action]) ?? '';
}

function buildRecentMenu(): Electron.MenuItemConstructorOptions[] {
  const items = getRecentFiles();
  if (items.length === 0) {
    return [{ label: t('menu.noRecentFiles'), enabled: false }];
  }
  const folderItems = items.filter((item) => item.kind === 'folder');
  const fileItems = items.filter((item) => item.kind === 'file');

  const toMenuItem = (item: RecentItem): Electron.MenuItemConstructorOptions => {
    const isFolder = item.kind === 'folder';
    const baseName = basename(item.path) || item.path;
    const label = isFolder ? `${baseName}/` : baseName;
    return {
      label,
      sublabel: item.path,
      click: () => {
        if (isFolder) {
          mainWindow?.webContents.send('folder:open-path', item.path);
        } else {
          mainWindow?.webContents.send('file:open-path', item.path);
        }
      },
    };
  };

  const list: Electron.MenuItemConstructorOptions[] = [];
  if (folderItems.length > 0) {
    list.push(...folderItems.map(toMenuItem));
  }
  if (folderItems.length > 0 && fileItems.length > 0) {
    list.push({ type: 'separator' });
  }
  if (fileItems.length > 0) {
    list.push(...fileItems.map(toMenuItem));
  }
  list.push({ type: 'separator' });
  list.push({
    label: t('menu.clearRecent'),
    click: () => {
      writeRecentFiles([]);
      createMenu();
    },
  });
  return list;
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: t('menu.file'),
      submenu: [
        {
          label: t('menu.new'),
          accelerator: shortcutAccelerator('newBlankDoc'),
          click: () => mainWindow?.webContents.send('menu:newBlankDoc'),
        },
        {
          label: t('menu.newTab'),
          accelerator: shortcutAccelerator('newFile'),
          click: () => mainWindow?.webContents.send('menu:new'),
        },
        {
          label: t('menu.open'),
          accelerator: shortcutAccelerator('openFile'),
          click: () => mainWindow?.webContents.send('menu:open'),
        },
        {
          label: t('menu.openFolder'),
          accelerator: shortcutAccelerator('openFolder'),
          click: () => mainWindow?.webContents.send('menu:openFolder'),
        },
        {
          label: t('menu.openRecent'),
          submenu: buildRecentMenu(),
        },
        { type: 'separator' },
        {
          label: t('menu.save'),
          accelerator: shortcutAccelerator('save'),
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        {
          label: t('menu.saveAs'),
          accelerator: shortcutAccelerator('saveAs'),
          click: () => mainWindow?.webContents.send('menu:saveAs'),
        },
        {
          label: t('menu.revealInFolder'),
          accelerator: shortcutAccelerator('revealInFolder'),
          click: () => mainWindow?.webContents.send('menu:revealInFolder'),
        },
        { type: 'separator' },
        {
          label: t('menu.closeTab'),
          accelerator: shortcutAccelerator('closeTab'),
          click: () => mainWindow?.webContents.send('menu:closeTab'),
        },
        {
          label: t('menu.settings'),
          accelerator: shortcutAccelerator('settings'),
          click: () => mainWindow?.webContents.send('menu:settings'),
        },
        { type: 'separator' },
        {
          label: t('menu.exit'),
          accelerator: shortcutAccelerator('exit'),
          click: () => mainWindow?.close(),
        },
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { label: t('menu.undo'), role: 'undo' },
        { label: t('menu.redo'), role: 'redo' },
        { type: 'separator' },
        { label: t('menu.cut'), role: 'cut' },
        { label: t('menu.copy'), role: 'copy' },
        {
          label: t('menu.copyAsMarkdown'),
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => mainWindow?.webContents.send('menu:copyAsMarkdown'),
        },
        { label: t('menu.paste'), role: 'paste' },
        {
          label: t('menu.pasteAsPlainText'),
          role: 'pasteAndMatchStyle',
          accelerator: 'CmdOrCtrl+Shift+V',
        },
        { label: t('menu.selectAll'), role: 'selectAll' },
        { type: 'separator' },
        {
          label: t('menu.find'),
          accelerator: shortcutAccelerator('find'),
          click: () => mainWindow?.webContents.send('menu:find'),
        },
        {
          label: t('menu.replace'),
          accelerator: shortcutAccelerator('replace'),
          click: () => mainWindow?.webContents.send('menu:replace'),
        },
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        {
          label: t('menu.outline'),
          accelerator: shortcutAccelerator('toggleOutline'),
          type: 'checkbox',
          checked: currentOutlineVisible,
          click: () => mainWindow?.webContents.send('menu:toggleOutline'),
        },
        {
          label: t('menu.fileTree'),
          accelerator: shortcutAccelerator('toggleFileTree'),
          type: 'checkbox',
          checked: currentFileTreeVisible,
          click: () => mainWindow?.webContents.send('menu:toggleFileTree'),
        },
        {
          label: t('menu.sourceMode'),
          accelerator: shortcutAccelerator('toggleSource'),
          type: 'checkbox',
          checked: currentSourceMode,
          click: () => mainWindow?.webContents.send('menu:toggleSource'),
        },
        {
          label: t('menu.toolbar'),
          accelerator: shortcutAccelerator('toggleToolbar'),
          type: 'checkbox',
          checked: currentToolbarVisible,
          click: () => mainWindow?.webContents.send('menu:toggleToolbar'),
        },
        { type: 'separator' },
        {
          label: t('menu.toggleFullScreen'),
          role: 'togglefullscreen',
        },
        {
          label: t('menu.alwaysOnTop'),
          accelerator: shortcutAccelerator('toggleAlwaysOnTop'),
          type: 'checkbox',
          checked: currentAlwaysOnTop,
          click: () => {
            if (!mainWindow) return;
            currentAlwaysOnTop = !mainWindow.isAlwaysOnTop();
            mainWindow.setAlwaysOnTop(currentAlwaysOnTop);
            createMenu();
          },
        },
        { type: 'separator' },
        { label: t('menu.zoomIn'), role: 'zoomIn' },
        { label: t('menu.zoomOut'), role: 'zoomOut' },
        { label: t('menu.resetZoom'), role: 'resetZoom' },
      ],
    },
    {
      label: t('menu.theme'),
      submenu: [
        {
          label: t('menu.themeInkmarkLight'),
          type: 'radio',
          checked: currentThemeId === 'inkmark-light',
          click: () => mainWindow?.webContents.send('menu:setTheme', 'inkmark-light'),
        },
        {
          label: t('menu.themeInkmarkDark'),
          type: 'radio',
          checked: currentThemeId === 'inkmark-dark',
          click: () => mainWindow?.webContents.send('menu:setTheme', 'inkmark-dark'),
        },
        {
          label: t('menu.themeGithubLight'),
          type: 'radio',
          checked: currentThemeId === 'github-light',
          click: () => mainWindow?.webContents.send('menu:setTheme', 'github-light'),
        },
        {
          label: t('menu.themeGithubDark'),
          type: 'radio',
          checked: currentThemeId === 'github-dark',
          click: () => mainWindow?.webContents.send('menu:setTheme', 'github-dark'),
        },
      ],
    },
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.checkForUpdates'),
          click: () => mainWindow?.webContents.send('menu:checkForUpdates'),
        },
        {
          label: t('menu.githubRepository'),
          click: () => void shell.openExternal(GITHUB_REPOSITORY_URL),
        },
        {
          label: t('menu.about', { name: PRODUCT_NAME }),
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
  // ready 之后系统语言才可靠，先解析再建菜单；渲染进程随后会按设置再次同步。
  systemLanguage = resolveSystemLanguage();
  currentLocale = resolveLocale(currentLanguage, systemLanguage);
  // 恢复上次主题,让首帧前窗口底色、原生主题与主题菜单勾选不回落浅色默认。
  const persistedThemeId = loadPersistedThemeId();
  if (persistedThemeId) currentThemeId = persistedThemeId;
  app.setAboutPanelOptions({
    applicationName: PRODUCT_NAME,
    applicationVersion: t('about.version', { version: app.getVersion() }),
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
  persistThemeId(themeId);
  applyNativeTheme(themeId);
  createMenu();
  const chrome = chromeColorsFor(themeId);
  mainWindow?.setTitleBarOverlay({
    color: chrome.overlay,
    symbolColor: chrome.symbol,
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

ipcMain.on('menu:syncToolbar', (event, visible: unknown) => {
  if (!isTrustedRenderer(event) || typeof visible !== 'boolean') return;
  currentToolbarVisible = visible;
  createMenu();
});

ipcMain.on('shortcuts:sync', (event, shortcuts: unknown) => {
  if (!isTrustedRenderer(event)) return;
  currentShortcuts = normalizeShortcutMap(shortcuts);
  createMenu();
});

ipcMain.on('language:sync', (event, language: unknown, systemLanguageValue: unknown) => {
  if (!isTrustedRenderer(event)) return;
  currentLanguage = normalizeLanguageSetting(language);
  // 渲染进程上报 navigator.language 作为系统语言依据（与界面同源，最可靠）；
  // 上报缺失时回落系统首选语言解析。
  systemLanguage =
    typeof systemLanguageValue === 'string' && systemLanguageValue.trim() !== ''
      ? systemLanguageValue
      : resolveSystemLanguage();
  applyLocale(currentLanguage, systemLanguage);
});

ipcMain.on('menu:popup', (event, pos?: unknown) => {
  if (!isTrustedRenderer(event)) return;
  const menu = Menu.getApplicationMenu();
  if (menu && mainWindow) {
    const popupOptions: Electron.PopupOptions = { window: mainWindow };
    if (
      pos &&
      typeof pos === 'object' &&
      'x' in pos &&
      'y' in pos &&
      typeof (pos as { x: unknown }).x === 'number' &&
      typeof (pos as { y: unknown }).y === 'number' &&
      Number.isFinite((pos as { x: number }).x) &&
      Number.isFinite((pos as { y: number }).y)
    ) {
      popupOptions.x = Math.round((pos as { x: number }).x);
      popupOptions.y = Math.round((pos as { y: number }).y);
    }
    menu.popup(popupOptions);
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
    throw new Error('Invalid file save request.');
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
    throw new Error('Invalid save-as request.');
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

ipcMain.handle('window:toggleAlwaysOnTop', (event) => {
  if (!isTrustedRenderer(event) || !mainWindow) return false;
  currentAlwaysOnTop = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(currentAlwaysOnTop);
  createMenu();
  return currentAlwaysOnTop;
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
  createMenu();
});

ipcMain.handle('app:getInfo', (event) =>
  isTrustedRenderer(event)
    ? { name: PRODUCT_NAME, version: app.getVersion() }
    : { name: PRODUCT_NAME, version: '' },
);

ipcMain.handle('app:getUpdateState', async (event): Promise<UpdateState> => {
  if (!isTrustedRenderer(event)) {
    return {
      status: 'error',
      currentVersion: app.getVersion(),
      message: t('update.requestInvalid'),
    };
  }
  return (await getUpdateService()).getState();
});

ipcMain.handle('app:checkForUpdates', async (event): Promise<UpdateState> => {
  if (!isTrustedRenderer(event)) {
    return {
      status: 'error',
      currentVersion: app.getVersion(),
      message: t('update.requestInvalid'),
    };
  }
  return (await getUpdateService()).check();
});

ipcMain.handle('app:downloadUpdate', async (event): Promise<UpdateState> => {
  if (!isTrustedRenderer(event)) {
    return {
      status: 'error',
      currentVersion: app.getVersion(),
      message: t('update.requestInvalid'),
    };
  }
  return (await getUpdateService()).download();
});

ipcMain.handle('app:installUpdate', async (event): Promise<boolean> => {
  if (!isTrustedRenderer(event)) return false;
  forceClose = true;
  const started = (await getUpdateService()).install();
  if (!started) forceClose = false;
  return started;
});

ipcMain.handle('app:openReleases', (event) => {
  if (!isTrustedRenderer(event)) return;
  void shell.openExternal(GITHUB_RELEASES_URL);
});

ipcMain.handle('image:store', (event, request: StoreImageRequest) => {
  if (!isTrustedRenderer(event)) {
    return { status: 'error', code: 'storage-failed', message: t('image.requestInvalid') } as const;
  }
  return imageStorage.store(request);
});

ipcMain.handle('image:discard', (event, request: DiscardStoredImageRequest) => {
  if (!isTrustedRenderer(event)) {
    return { status: 'error', message: t('image.requestInvalid') } as const;
  }
  return imageStorage.discard(request);
});

ipcMain.handle('image:resolveSource', (event, request: ResolveImageSourceRequest) => {
  if (!isTrustedRenderer(event)) {
    return { status: 'error', code: 'invalid-source', message: t('image.requestInvalid') } as const;
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
