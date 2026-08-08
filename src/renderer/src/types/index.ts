export interface Heading {
  id: string;
  level: number;
  text: string;
  pos: number;
}

export interface FileResult {
  path: string;
  content: string;
  mtime: number;
}

export type SaveResult = { status: 'ok'; mtime: number } | { status: 'conflict' };

export type MtimeResult = { status: 'ok'; mtime: number } | { status: 'error' };

export interface SaveAsResult {
  path: string;
  mtime: number;
}

export interface AppInfo {
  name: string;
  version: string;
}

export interface SaveImageResult {
  path: string;
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
  onOpenFilePath: (cb: (path: string) => void) => void;
  onMenuNew: (cb: () => void) => void;
  onMenuOpen: (cb: () => void) => void;
  onMenuSave: (cb: () => void) => void;
  onMenuSaveAs: (cb: () => void) => void;
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
  resolvePath: (basePath: string, relativePath: string) => string;
  relativePath: (from: string, to: string) => string;
  dirnamePath: (filePath: string) => string;
  saveImage: (data: ArrayBuffer, fileName: string, mdFilePath: string) => Promise<SaveImageResult>;
  platform: string;
}

declare global {
  interface Window {
    inkmark: InkMarkAPI;
  }
}
