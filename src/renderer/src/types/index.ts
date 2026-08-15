import type {
  DiscardStoredImageRequest,
  DiscardStoredImageResult,
  ResolveImageSourceRequest,
  ResolveImageSourceResult,
  StoreImageRequest,
  StoreImageResult,
} from '../../../shared/image-storage';
import type { ShortcutMap } from '../../../shared/shortcuts';
export {
  isThemeId,
  parseThemeId,
  THEME_IDS,
  type AppTheme,
  type ContentTheme,
  type ThemeId,
} from '../../../shared/theme';
export type { WorkspaceEntry } from '../../../shared/workspace-tree';
import type { WorkspaceEntry } from '../../../shared/workspace-tree';
export type { RecentItem, RecentKind } from '../../../shared/recent-items';
import type { RecentItem } from '../../../shared/recent-items';
import type { UpdateState } from '../../../shared/update-state';

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
  getRecentFiles: () => Promise<RecentItem[]>;
  removeRecentFile: (path: string) => Promise<void>;
  clearRecentFiles: () => Promise<void>;
  getAppInfo: () => Promise<AppInfo>;
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdates: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<UpdateState>;
  installUpdate: () => Promise<boolean>;
  onUpdateState: (cb: (state: UpdateState) => void) => () => void;
  openReleases: () => Promise<void>;
  getFileMtime: (path: string) => Promise<MtimeResult>;
  watchFile: (path: string) => void;
  unwatchFile: (path: string) => void;
  onFileWatchEvent: (cb: (event: FileWatchEvent) => void) => () => void;
  onOpenFilePath: (cb: (path: string) => void) => void;
  onMenuNew: (cb: () => void) => void;
  onMenuNewBlankDoc: (cb: () => void) => void;
  onMenuOpen: (cb: () => void) => void;
  onMenuSave: (cb: () => void) => void;
  onMenuSaveAs: (cb: () => void) => void;
  onMenuSettings: (cb: () => void) => void;
  onMenuSetTheme: (cb: (themeId: string) => void) => void;
  onMenuClose: (cb: () => void) => void;
  onMenuCloseTab: (cb: () => void) => void;
  onMenuCheckForUpdates: (cb: () => void) => void;
  onMenuFind: (cb: () => void) => void;
  onMenuReplace: (cb: () => void) => void;
  onMenuToggleSource: (cb: () => void) => void;
  onMenuToggleOutline: (cb: () => void) => void;
  onMenuOpenFolder: (cb: () => void) => void;
  onMenuToggleFileTree: (cb: () => void) => void;
  setWindowTitle: (title: string) => Promise<void>;
  closeWindow: () => Promise<void>;
  syncThemeId: (themeId: string) => void;
  syncSourceMode: (checked: boolean) => void;
  syncOutlineVisible: (visible: boolean) => void;
  syncFileTreeVisible: (visible: boolean) => void;
  syncShortcuts: (shortcuts: ShortcutMap) => void;
  syncLanguage: (language: string, systemLanguage: string) => void;
  openFolderDialog: () => Promise<{ path: string } | null>;
  listDirectory: (path: string) => Promise<{ path: string; entries: WorkspaceEntry[] } | null>;
  revealInFolder: (path: string) => Promise<void>;
  watchWorkspace: (path: string) => void;
  unwatchWorkspace: () => void;
  onWorkspaceWatchEvent: (cb: (event: { path: string }) => void) => () => void;
  popupMenu: (pos?: { x: number; y: number }) => void;
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
