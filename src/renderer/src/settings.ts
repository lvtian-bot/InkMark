import { isThemeId, type ThemeId } from './types';
import {
  isFontPresetId,
  isFontSizePresetId,
  isLetterSpacingPresetId,
  isLineHeightPresetId,
  type FontPresetId,
  type FontSizePresetId,
  type LetterSpacingPresetId,
  type LineHeightPresetId,
} from './font-presets';
import {
  DEFAULT_EDITOR_SHORTCUT_MAP,
  DEFAULT_SHORTCUT_MAP,
  normalizeEditorShortcutMap,
  normalizeShortcutMap,
  type EditorShortcutMap,
  type ShortcutMap,
} from '../../shared/shortcuts';
import { normalizeLanguageSetting, type LanguageSetting } from '../../shared/i18n';

// AppTheme 已迁移至 ./types，这里 re-export 以保持现有 import 路径稳定。
export type { AppTheme } from './types';
export type ToolbarWidth = 'wide' | 'medium' | 'narrow';

export function isToolbarWidth(value: unknown): value is ToolbarWidth {
  return value === 'wide' || value === 'medium' || value === 'narrow';
}

export type RecentListWidth = 'wide' | 'medium' | 'narrow';

export function isRecentListWidth(value: unknown): value is RecentListWidth {
  return value === 'wide' || value === 'medium' || value === 'narrow';
}

export type PanelLayout = 'outline-left' | 'outline-right';

export function isPanelLayout(value: unknown): value is PanelLayout {
  return value === 'outline-left' || value === 'outline-right';
}

export interface AppSettings {
  themeId: ThemeId;
  outlineWidth: number;
  outlineVisible: boolean;
  toolbarVisible: boolean;
  toolbarWidth: ToolbarWidth;
  recentListWidth: RecentListWidth;
  fontPreset: FontPresetId;
  fontSizePreset: FontSizePresetId;
  lineHeightPreset: LineHeightPresetId;
  letterSpacingPreset: LetterSpacingPresetId;
  startPageOnLaunch: boolean;
  fileTreeVisible: boolean;
  panelLayout: PanelLayout;
  fileTreeWidth: number;
  strictLineBreaks: boolean;
  autoSave: boolean;
  language: LanguageSetting;
  shortcuts: ShortcutMap;
  editorShortcuts: EditorShortcutMap;
}

export const OUTLINE_WIDTH_MIN = 150;
export const OUTLINE_WIDTH_MAX = 500;
export const FILE_TREE_WIDTH_MIN = 150;
export const FILE_TREE_WIDTH_MAX = 500;

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  themeId: 'inkmark-light',
  outlineWidth: 240,
  outlineVisible: true,
  toolbarVisible: true,
  toolbarWidth: 'wide',
  recentListWidth: 'medium',
  fontPreset: 'system',
  fontSizePreset: 'medium',
  lineHeightPreset: 'medium',
  letterSpacingPreset: 'medium',
  startPageOnLaunch: true,
  fileTreeVisible: false,
  panelLayout: 'outline-left',
  fileTreeWidth: 240,
  strictLineBreaks: false,
  autoSave: false,
  language: 'system',
  shortcuts: normalizeShortcutMap(DEFAULT_SHORTCUT_MAP),
  editorShortcuts: normalizeEditorShortcutMap(DEFAULT_EDITOR_SHORTCUT_MAP),
};

export function selectSettings(settings: AppSettings): AppSettings {
  return {
    themeId: settings.themeId,
    outlineWidth: settings.outlineWidth,
    outlineVisible: settings.outlineVisible,
    toolbarVisible: settings.toolbarVisible,
    toolbarWidth: settings.toolbarWidth,
    recentListWidth: settings.recentListWidth,
    fontPreset: settings.fontPreset,
    fontSizePreset: settings.fontSizePreset,
    lineHeightPreset: settings.lineHeightPreset,
    letterSpacingPreset: settings.letterSpacingPreset,
    startPageOnLaunch: settings.startPageOnLaunch,
    fileTreeVisible: settings.fileTreeVisible,
    panelLayout: settings.panelLayout,
    fileTreeWidth: settings.fileTreeWidth,
    strictLineBreaks: settings.strictLineBreaks,
    autoSave: settings.autoSave,
    language: settings.language,
    shortcuts: settings.shortcuts,
    editorShortcuts: settings.editorShortcuts,
  };
}

const SETTINGS_STORAGE_KEY = 'inkmark-settings';
const LEGACY_STORAGE_KEYS = {
  theme: 'inkmark-theme',
  contentTheme: 'inkmark-content-theme',
  outlineWidth: 'inkmark-outline-width',
  outlineVisible: 'inkmark-outline-visible',
} as const;

function getStorage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    return localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeOutlineWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.outlineWidth;
  }

  return Math.round(Math.min(OUTLINE_WIDTH_MAX, Math.max(OUTLINE_WIDTH_MIN, value)));
}

function normalizeFileTreeWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.fileTreeWidth;
  }

  return Math.round(Math.min(FILE_TREE_WIDTH_MAX, Math.max(FILE_TREE_WIDTH_MIN, value)));
}

// 优先使用新版的 themeId；若配置来自旧版（theme + contentTheme 拆分存储）则合成 themeId，
// 保证升级后旧设置无缝映射到统一的组合主题模型。
function resolveThemeId(candidate: Record<string, unknown>): ThemeId {
  if (isThemeId(candidate.themeId)) return candidate.themeId;
  const { theme, contentTheme } = candidate;
  if (
    (theme === 'light' || theme === 'dark') &&
    (contentTheme === 'inkmark' || contentTheme === 'github')
  ) {
    return `${contentTheme}-${theme}` as ThemeId;
  }
  return DEFAULT_SETTINGS.themeId;
}

function normalizeSettings(value: unknown): AppSettings {
  const candidate = isRecord(value) ? value : {};

  return {
    themeId: resolveThemeId(candidate),
    outlineWidth: normalizeOutlineWidth(candidate.outlineWidth),
    outlineVisible:
      typeof candidate.outlineVisible === 'boolean'
        ? candidate.outlineVisible
        : DEFAULT_SETTINGS.outlineVisible,
    toolbarVisible:
      typeof candidate.toolbarVisible === 'boolean'
        ? candidate.toolbarVisible
        : DEFAULT_SETTINGS.toolbarVisible,
    toolbarWidth: isToolbarWidth(candidate.toolbarWidth)
      ? candidate.toolbarWidth
      : DEFAULT_SETTINGS.toolbarWidth,
    recentListWidth: isRecentListWidth(candidate.recentListWidth)
      ? candidate.recentListWidth
      : DEFAULT_SETTINGS.recentListWidth,
    fontPreset: isFontPresetId(candidate.fontPreset)
      ? candidate.fontPreset
      : DEFAULT_SETTINGS.fontPreset,
    fontSizePreset: isFontSizePresetId(candidate.fontSizePreset)
      ? candidate.fontSizePreset
      : DEFAULT_SETTINGS.fontSizePreset,
    lineHeightPreset: isLineHeightPresetId(candidate.lineHeightPreset)
      ? candidate.lineHeightPreset
      : DEFAULT_SETTINGS.lineHeightPreset,
    letterSpacingPreset: isLetterSpacingPresetId(candidate.letterSpacingPreset)
      ? candidate.letterSpacingPreset
      : DEFAULT_SETTINGS.letterSpacingPreset,
    startPageOnLaunch:
      typeof candidate.startPageOnLaunch === 'boolean'
        ? candidate.startPageOnLaunch
        : DEFAULT_SETTINGS.startPageOnLaunch,
    fileTreeVisible:
      typeof candidate.fileTreeVisible === 'boolean'
        ? candidate.fileTreeVisible
        : DEFAULT_SETTINGS.fileTreeVisible,
    panelLayout: isPanelLayout(candidate.panelLayout)
      ? candidate.panelLayout
      : DEFAULT_SETTINGS.panelLayout,
    fileTreeWidth: normalizeFileTreeWidth(candidate.fileTreeWidth),
    strictLineBreaks:
      typeof candidate.strictLineBreaks === 'boolean'
        ? candidate.strictLineBreaks
        : DEFAULT_SETTINGS.strictLineBreaks,
    autoSave:
      typeof candidate.autoSave === 'boolean' ? candidate.autoSave : DEFAULT_SETTINGS.autoSave,
    language: normalizeLanguageSetting(candidate.language),
    shortcuts: normalizeShortcutMap(candidate.shortcuts),
    editorShortcuts: normalizeEditorShortcutMap(candidate.editorShortcuts),
  };
}

function readLegacySettings(storage: Storage): AppSettings | null {
  const theme = storage.getItem(LEGACY_STORAGE_KEYS.theme);
  const contentTheme = storage.getItem(LEGACY_STORAGE_KEYS.contentTheme);
  const outlineWidth = storage.getItem(LEGACY_STORAGE_KEYS.outlineWidth);
  const outlineVisible = storage.getItem(LEGACY_STORAGE_KEYS.outlineVisible);

  if (theme === null && contentTheme === null && outlineWidth === null && outlineVisible === null) {
    return null;
  }

  return normalizeSettings({
    theme,
    contentTheme,
    outlineWidth: outlineWidth === null ? undefined : Number(outlineWidth),
    outlineVisible: outlineVisible === null ? undefined : outlineVisible !== 'false',
  });
}

function writeSettings(storage: Storage, settings: AppSettings): boolean {
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings(): AppSettings {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_SETTINGS };

  let savedSettings: string | null;
  try {
    savedSettings = storage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }

  if (savedSettings !== null) {
    try {
      return normalizeSettings(JSON.parse(savedSettings) as unknown);
    } catch {
      // 统一配置损坏时继续尝试读取旧键，避免一次异常使所有设置丢失。
    }
  }

  try {
    const legacySettings = readLegacySettings(storage);
    if (!legacySettings) return { ...DEFAULT_SETTINGS };

    if (writeSettings(storage, legacySettings)) {
      Object.values(LEGACY_STORAGE_KEYS).forEach((key) => {
        try {
          storage.removeItem(key);
        } catch {
          // 迁移已完成；旧键无法清理不应阻断本次设置加载。
        }
      });
    }
    return legacySettings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const normalizedSettings = normalizeSettings(settings);
  const storage = getStorage();
  if (storage) writeSettings(storage, normalizedSettings);
  return normalizedSettings;
}
