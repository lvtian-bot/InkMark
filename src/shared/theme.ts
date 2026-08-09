export type ContentTheme = 'inkmark' | 'github';
export type AppTheme = 'light' | 'dark';
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
