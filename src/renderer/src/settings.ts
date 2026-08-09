import { isThemeId, type ThemeId } from './types';
import {
  isFontPresetId,
  isFontSizePresetId,
  type FontPresetId,
  type FontSizePresetId,
} from './font-presets';

// AppTheme 已迁移至 ./types，这里 re-export 以保持现有 import 路径稳定。
export type { AppTheme } from './types';
export type ToolbarWidth = 'wide' | 'medium' | 'narrow';

export function isToolbarWidth(value: unknown): value is ToolbarWidth {
  return value === 'wide' || value === 'medium' || value === 'narrow';
}

export interface AppSettings {
  themeId: ThemeId;
  outlineWidth: number;
  outlineVisible: boolean;
  toolbarWidth: ToolbarWidth;
  fontPreset: FontPresetId;
  fontSizePreset: FontSizePresetId;
  startPageOnLaunch: boolean;
}

export const OUTLINE_WIDTH_MIN = 150;
export const OUTLINE_WIDTH_MAX = 500;

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  themeId: 'inkmark-light',
  outlineWidth: 240,
  outlineVisible: true,
  toolbarWidth: 'wide',
  fontPreset: 'system',
  fontSizePreset: 'medium',
  startPageOnLaunch: true,
};

export function selectSettings(settings: AppSettings): AppSettings {
  return {
    themeId: settings.themeId,
    outlineWidth: settings.outlineWidth,
    outlineVisible: settings.outlineVisible,
    toolbarWidth: settings.toolbarWidth,
    fontPreset: settings.fontPreset,
    fontSizePreset: settings.fontSizePreset,
    startPageOnLaunch: settings.startPageOnLaunch,
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
    toolbarWidth: isToolbarWidth(candidate.toolbarWidth)
      ? candidate.toolbarWidth
      : DEFAULT_SETTINGS.toolbarWidth,
    fontPreset: isFontPresetId(candidate.fontPreset)
      ? candidate.fontPreset
      : DEFAULT_SETTINGS.fontPreset,
    fontSizePreset: isFontSizePresetId(candidate.fontSizePreset)
      ? candidate.fontSizePreset
      : DEFAULT_SETTINGS.fontSizePreset,
    startPageOnLaunch:
      typeof candidate.startPageOnLaunch === 'boolean'
        ? candidate.startPageOnLaunch
        : DEFAULT_SETTINGS.startPageOnLaunch,
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
