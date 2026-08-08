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

export type ContentTheme = 'inkmark' | 'github';

export interface InkMarkAPI {
  openFileDialog: () => Promise<FileResult[] | null>;
  saveFile: (
    content: string,
    path: string,
    knownMtime?: number | null,
    force?: boolean,
  ) => Promise<SaveResult>;
  saveFileAs: (content: string) => Promise<SaveAsResult | null>;
  openFilePath: (path: string) => Promise<FileResult | null>;
  getRecentFiles: () => Promise<string[]>;
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
  platform: string;
}

declare global {
  interface Window {
    inkmark: InkMarkAPI;
  }
}
