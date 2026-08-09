import type {
  DiscardStoredImageRequest,
  DiscardStoredImageResult,
  ResolveImageSourceRequest,
  ResolveImageSourceResult,
  StoreImageRequest,
  StoreImageResult,
} from '../../../shared/image-storage';
export {
  isThemeId,
  parseThemeId,
  THEME_IDS,
  type AppTheme,
  type ContentTheme,
  type ThemeId,
} from '../../../shared/theme';

export interface Heading {
  id: string;
  level: number;
  text: string;
  pos: number;
}

export type ViewMode = 'wysiwyg' | 'source';

export interface FileResult {
  path: string;
  content: string;
  mtime: number;
}

export type SaveResult = { status: 'ok'; mtime: number } | { status: 'conflict' };

export type MtimeResult = { status: 'ok'; mtime: number } | { status: 'error' };

export type FileWatchEvent = {
  path: string;
  status: 'changed' | 'missing';
  mtime?: number;
};

export interface SaveAsResult {
  path: string;
  mtime: number;
}

export interface AppInfo {
  name: string;
  version: string;
}

export interface InkMarkAPI {
  openFileDialog: () => Promise<FileResult[] | null>;
  saveFile: (
    content: string,
    path: string,
    knownMtime?: number | null,
    force?: boolean,
  ) => Promise<SaveResult>;
  saveFileAs: (content: string, sourcePath?: string | null) => Promise<SaveAsResult | null>;
  openFilePath: (path: string) => Promise<FileResult | null>;
  getRecentFiles: () => Promise<string[]>;
  removeRecentFile: (path: string) => Promise<void>;
  clearRecentFiles: () => Promise<void>;
  getAppInfo: () => Promise<AppInfo>;
  getFileMtime: (path: string) => Promise<MtimeResult>;
  watchFile: (path: string) => void;
  unwatchFile: (path: string) => void;
  onFileWatchEvent: (cb: (event: FileWatchEvent) => void) => () => void;
  onOpenFilePath: (cb: (path: string) => void) => void;
  onMenuNew: (cb: () => void) => void;
  onMenuOpen: (cb: () => void) => void;
  onMenuSave: (cb: () => void) => void;
  onMenuSaveAs: (cb: () => void) => void;
  onMenuSettings: (cb: () => void) => void;
  onMenuSetTheme: (cb: (themeId: string) => void) => void;
  onMenuClose: (cb: () => void) => void;
  onMenuCloseTab: (cb: () => void) => void;
  onMenuAbout: (cb: () => void) => void;
  onMenuToggleSource: (cb: () => void) => void;
  onMenuToggleOutline: (cb: () => void) => void;
  setWindowTitle: (title: string) => Promise<void>;
  closeWindow: () => Promise<void>;
  syncThemeId: (themeId: string) => void;
  syncSourceMode: (checked: boolean) => void;
  syncOutlineVisible: (visible: boolean) => void;
  popupMenu: () => void;
  storeImage: (request: StoreImageRequest) => Promise<StoreImageResult>;
  discardStoredImage: (request: DiscardStoredImageRequest) => Promise<DiscardStoredImageResult>;
  resolveImageSource: (request: ResolveImageSourceRequest) => Promise<ResolveImageSourceResult>;
  platform: string;
}

declare global {
  interface Window {
    inkmark: InkMarkAPI;
  }
}
