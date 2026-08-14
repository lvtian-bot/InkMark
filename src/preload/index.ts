import { contextBridge, ipcRenderer } from 'electron';
import type {
  DiscardStoredImageRequest,
  ResolveImageSourceRequest,
  StoreImageRequest,
} from '../shared/image-storage';
import type { WorkspaceEntry } from '../shared/workspace-tree';
import type { RecentItem } from '../shared/recent-items';
import type { ShortcutMap } from '../shared/shortcuts';
import type { UpdateState } from '../shared/update-state';

const api = {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (content: string, path: string, knownMtime?: number | null, force?: boolean) =>
    ipcRenderer.invoke('file:save', { content, path, knownMtime, force }),
  saveFileAs: (content: string, sourcePath?: string | null) =>
    ipcRenderer.invoke('dialog:saveFileAs', { content, sourcePath }),
  openFilePath: (path: string) => ipcRenderer.invoke('file:read', { path }),
  getRecentFiles: () => ipcRenderer.invoke('recent:get') as Promise<RecentItem[]>,
  removeRecentFile: (path: string) => ipcRenderer.invoke('recent:remove', path),
  clearRecentFiles: () => ipcRenderer.invoke('recent:clear'),
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  getUpdateState: () => ipcRenderer.invoke('app:getUpdateState') as Promise<UpdateState>,
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates') as Promise<UpdateState>,
  downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate') as Promise<UpdateState>,
  installUpdate: () => ipcRenderer.invoke('app:installUpdate') as Promise<boolean>,
  onUpdateState: (cb: (state: UpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => cb(state);
    ipcRenderer.on('app:update-state', listener);
    return () => ipcRenderer.removeListener('app:update-state', listener);
  },
  openReleases: () => ipcRenderer.invoke('app:openReleases'),
  getFileMtime: (path: string) => ipcRenderer.invoke('file:getMtime', { path }),
  watchFile: (path: string) => ipcRenderer.send('file:watch', { path }),
  unwatchFile: (path: string) => ipcRenderer.send('file:unwatch', { path }),
  onFileWatchEvent: (
    cb: (event: { path: string; status: 'changed' | 'missing'; mtime?: number }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      fileEvent: { path: string; status: 'changed' | 'missing'; mtime?: number },
    ) => cb(fileEvent);
    ipcRenderer.on('file:watch-event', listener);
    return () => ipcRenderer.removeListener('file:watch-event', listener);
  },
  onOpenFilePath: (cb: (path: string) => void) => {
    ipcRenderer.removeAllListeners('file:open-path');
    ipcRenderer.on('file:open-path', (_event, path: string) => cb(path));
  },
  onMenuNew: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:new');
    ipcRenderer.on('menu:new', () => cb());
  },
  onMenuNewBlankDoc: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:newBlankDoc');
    ipcRenderer.on('menu:newBlankDoc', () => cb());
  },
  onMenuOpen: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:open');
    ipcRenderer.on('menu:open', () => cb());
  },
  onMenuSave: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:save');
    ipcRenderer.on('menu:save', () => cb());
  },
  onMenuSaveAs: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:saveAs');
    ipcRenderer.on('menu:saveAs', () => cb());
  },
  onMenuSettings: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:settings');
    ipcRenderer.on('menu:settings', () => cb());
  },
  onMenuSetTheme: (cb: (themeId: string) => void) => {
    ipcRenderer.removeAllListeners('menu:setTheme');
    ipcRenderer.on('menu:setTheme', (_event, themeId: string) => cb(themeId));
  },
  onMenuToggleSource: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:toggleSource');
    ipcRenderer.on('menu:toggleSource', () => cb());
  },
  onMenuToggleOutline: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:toggleOutline');
    ipcRenderer.on('menu:toggleOutline', () => cb());
  },
  onMenuOpenFolder: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:openFolder');
    ipcRenderer.on('menu:openFolder', () => cb());
  },
  onMenuToggleFileTree: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:toggleFileTree');
    ipcRenderer.on('menu:toggleFileTree', () => cb());
  },
  onMenuCloseTab: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:closeTab');
    ipcRenderer.on('menu:closeTab', () => cb());
  },
  onMenuCheckForUpdates: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:checkForUpdates');
    ipcRenderer.on('menu:checkForUpdates', () => cb());
  },
  onMenuClose: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:close');
    ipcRenderer.on('menu:close', () => cb());
  },
  setWindowTitle: (title: string) => ipcRenderer.invoke('window:setTitle', title),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  syncThemeId: (themeId: string) => {
    ipcRenderer.send('theme:syncThemeId', themeId);
  },
  syncSourceMode: (checked: boolean) => {
    ipcRenderer.send('menu:syncSource', checked);
  },
  syncOutlineVisible: (visible: boolean) => {
    ipcRenderer.send('menu:syncOutline', visible);
  },
  syncFileTreeVisible: (visible: boolean) => {
    ipcRenderer.send('menu:syncFileTree', visible);
  },
  syncShortcuts: (shortcuts: ShortcutMap) => {
    ipcRenderer.send('shortcuts:sync', shortcuts);
  },
  syncLanguage: (language: string, systemLanguage: string) => {
    ipcRenderer.send('language:sync', language, systemLanguage);
  },
  popupMenu: () => {
    ipcRenderer.send('menu:popup');
  },
  storeImage: (request: StoreImageRequest) => ipcRenderer.invoke('image:store', request),
  discardStoredImage: (request: DiscardStoredImageRequest) =>
    ipcRenderer.invoke('image:discard', request),
  resolveImageSource: (request: ResolveImageSourceRequest) =>
    ipcRenderer.invoke('image:resolveSource', request),
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  listDirectory: (path: string) =>
    ipcRenderer.invoke('dir:list', { path }) as Promise<{
      path: string;
      entries: WorkspaceEntry[];
    } | null>,
  revealInFolder: (path: string) => ipcRenderer.invoke('shell:reveal', { path }),
  watchWorkspace: (path: string) => ipcRenderer.send('workspace:watch', { path }),
  unwatchWorkspace: () => ipcRenderer.send('workspace:unwatch'),
  onWorkspaceWatchEvent: (cb: (event: { path: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, workspaceEvent: { path: string }) =>
      cb(workspaceEvent);
    ipcRenderer.on('workspace:watch-event', listener);
    return () => ipcRenderer.removeListener('workspace:watch-event', listener);
  },
  platform: process.platform,
};

try {
  contextBridge.exposeInMainWorld('inkmark', api);
} catch (error) {
  console.error('Failed to expose inkmark API:', error);
}
