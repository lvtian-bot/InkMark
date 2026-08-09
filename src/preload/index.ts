import { contextBridge, ipcRenderer } from 'electron';
import type {
  DiscardStoredImageRequest,
  ResolveImageSourceRequest,
  StoreImageRequest,
} from '../shared/image-storage';

const api = {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (content: string, path: string, knownMtime?: number | null, force?: boolean) =>
    ipcRenderer.invoke('file:save', { content, path, knownMtime, force }),
  saveFileAs: (content: string, sourcePath?: string | null) =>
    ipcRenderer.invoke('dialog:saveFileAs', { content, sourcePath }),
  openFilePath: (path: string) => ipcRenderer.invoke('file:read', { path }),
  getRecentFiles: () => ipcRenderer.invoke('recent:get'),
  removeRecentFile: (path: string) => ipcRenderer.invoke('recent:remove', path),
  clearRecentFiles: () => ipcRenderer.invoke('recent:clear'),
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
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
  onMenuCloseTab: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:closeTab');
    ipcRenderer.on('menu:closeTab', () => cb());
  },
  onMenuAbout: (cb: () => void) => {
    ipcRenderer.removeAllListeners('menu:about');
    ipcRenderer.on('menu:about', () => cb());
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
  popupMenu: () => {
    ipcRenderer.send('menu:popup');
  },
  storeImage: (request: StoreImageRequest) => ipcRenderer.invoke('image:store', request),
  discardStoredImage: (request: DiscardStoredImageRequest) =>
    ipcRenderer.invoke('image:discard', request),
  resolveImageSource: (request: ResolveImageSourceRequest) =>
    ipcRenderer.invoke('image:resolveSource', request),
  platform: process.platform,
};

try {
  contextBridge.exposeInMainWorld('inkmark', api);
} catch (error) {
  console.error('Failed to expose inkmark API:', error);
}
