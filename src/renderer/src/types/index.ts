import type {
  DiscardStoredImageRequest,
  DiscardStoredImageResult,
  ResolveImageSourceRequest,
  ResolveImageSourceResult,
  StoreImageRequest,
  StoreImageResult,
} from '../../../shared/image-storage';

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
export type AppTheme = 'light' | 'dark';

// 主题是“内容排版风格 + 明暗”的组合，与菜单栏的 4 选 1 单选一一对应；
// themeId 是唯一权威主题标识，theme/contentTheme 均由它派生。
export type ThemeId = `${ContentTheme}-${AppTheme}`;

export const THEME_IDS: readonly ThemeId[] = [
  'inkmark-light',
  'inkmark-dark',
  'github-light',
  'github-dark',
];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

export function parseThemeId(themeId: ThemeId): { contentTheme: ContentTheme; theme: AppTheme } {
  const dashIdx = themeId.lastIndexOf('-');
  return {
    contentTheme: themeId.slice(0, dashIdx) as ContentTheme,
    theme: themeId.slice(dashIdx + 1) as AppTheme,
  };
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
