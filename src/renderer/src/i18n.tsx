// i18n 基础设施：同时导出 Provider 组件、context、hook 与模块级翻译函数。
// react-refresh 只允许组件导出的检查在这里不适用（翻译函数需要模块级单例），
// 故对本文件豁免该规则。
/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useStore } from './stores/useStore';
import {
  resolveLocale,
  translateByLocale,
  type LanguageSetting,
  type LocaleId,
  type MessageKey,
} from '../../shared/i18n';

type TranslateParams = Record<string, string | number>;

export interface I18nValue {
  /** 当前生效的界面语言。 */
  locale: LocaleId;
  /** 设置项里的语言选择（跟随系统 / 指定语言）。 */
  language: LanguageSetting;
  /** 渲染期翻译函数：语言变化时随 context 重渲染。 */
  t: (key: MessageKey, params?: TranslateParams) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

// 模块级当前语言：供事件回调等非渲染场景使用（如 confirmDialog 调用方）。
// I18nProvider 挂载与设置变化时同步更新，保证取到的是最新语言。
let moduleLocale: LocaleId = resolveLocale(useStore.getState().language, navigator.language);

/** 获取当前生效语言（非渲染场景）。 */
export function getLocale(): LocaleId {
  return moduleLocale;
}

/** 非渲染场景的翻译函数：始终使用最新语言。 */
export function t(key: MessageKey, params?: TranslateParams): string {
  return translateByLocale(moduleLocale, key, params);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const language = useStore((s) => s.language);
  // 语言是 language 设置与系统语言的纯函数，直接派生，无需 setState 中转。
  const locale = useMemo(() => resolveLocale(language, navigator.language), [language]);

  useEffect(() => {
    moduleLocale = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      language,
      t: (key, params) => translateByLocale(locale, key, params),
    }),
    [locale, language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** 组件内翻译：随语言切换自动重渲染。 */
export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n 必须在 I18nProvider 内使用。');
  }
  return value;
}
