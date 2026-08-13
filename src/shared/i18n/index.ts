// 应用界面语言资源与翻译工具（主进程 / 预加载 / 渲染进程共用，无 DOM 与 Node 副作用）。
// 语言模型：设置里可手动选择语言（zh-CN / en）或「跟随系统」；系统语言解析由
// 调用方注入（渲染进程用 navigator.language，主进程用 app.getLocale()）。

import { messages as zhCN, type MessageKey } from './messages/zh-CN';
import { messages as en } from './messages/en';

export type LocaleId = 'zh-CN' | 'en';

/** 设置项取值：'system' 表示跟随系统语言。 */
export type LanguageSetting = 'system' | LocaleId;

export const LOCALE_IDS: readonly LocaleId[] = ['zh-CN', 'en'];

const CATALOGS: Record<LocaleId, Record<MessageKey, string>> = { 'zh-CN': zhCN, en };

export function isLocaleId(value: unknown): value is LocaleId {
  return value === 'zh-CN' || value === 'en';
}

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return value === 'system' || isLocaleId(value);
}

/** 归一化设置值，非法值回落「跟随系统」。 */
export function normalizeLanguageSetting(value: unknown): LanguageSetting {
  return isLanguageSetting(value) ? value : 'system';
}

/**
 * 把系统语言字符串解析为界面语言。
 * 中文系（zh*）→ zh-CN；其余回落 en。
 */
export function localeFromSystemLanguage(systemLanguage: string): LocaleId {
  return /^zh\b/i.test(systemLanguage) ? 'zh-CN' : 'en';
}

/** 由设置值与系统语言解析出实际界面语言。 */
export function resolveLocale(setting: LanguageSetting, systemLanguage: string): LocaleId {
  if (isLocaleId(setting)) return setting;
  return localeFromSystemLanguage(systemLanguage);
}

/** 解析插值占位符：消息中的 `{name}` 由 params.name 替换。 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** 用指定语言翻译一条消息；未知键返回键名本身（便于尽早发现缺键）。 */
export function translateByLocale(
  locale: LocaleId,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const catalog = CATALOGS[locale];
  return interpolate(catalog[key] ?? key, params);
}

/** 中文目录，供需要按语言分支的调用方直接使用。 */
export { zhCN };
export type { MessageKey };
