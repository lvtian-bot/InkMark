import { describe, expect, it } from 'vitest';
import {
  isLanguageSetting,
  isLocaleId,
  localeFromSystemLanguage,
  normalizeLanguageSetting,
  resolveLocale,
  translateByLocale,
} from './index';
import { messages as zhCN, type MessageKey } from './messages/zh-CN';
import { messages as en } from './messages/en';

describe('i18n 语言解析', () => {
  it('中文系系统语言解析为 zh-CN（含无地区码与地区扩展）', () => {
    expect(localeFromSystemLanguage('zh-CN')).toBe('zh-CN');
    expect(localeFromSystemLanguage('zh')).toBe('zh-CN');
    expect(localeFromSystemLanguage('zh-Hans-CN')).toBe('zh-CN');
    expect(localeFromSystemLanguage('zh-TW')).toBe('zh-CN');
  });

  it('非中文系统语言回落 en', () => {
    expect(localeFromSystemLanguage('en-US')).toBe('en');
    expect(localeFromSystemLanguage('ja-JP')).toBe('en');
    expect(localeFromSystemLanguage('')).toBe('en');
  });

  it('跟随系统时按系统语言解析，显式指定时优先于系统', () => {
    expect(resolveLocale('system', 'zh-CN')).toBe('zh-CN');
    expect(resolveLocale('system', 'en-US')).toBe('en');
    expect(resolveLocale('en', 'zh-CN')).toBe('en');
    expect(resolveLocale('zh-CN', 'en-US')).toBe('zh-CN');
  });

  it('设置值校验与归一化：非法值回落跟随系统', () => {
    expect(isLocaleId('zh-CN')).toBe(true);
    expect(isLocaleId('en')).toBe(true);
    expect(isLocaleId('fr')).toBe(false);
    expect(isLanguageSetting('system')).toBe(true);
    expect(isLanguageSetting('en')).toBe(true);
    expect(normalizeLanguageSetting('system')).toBe('system');
    expect(normalizeLanguageSetting('zh-CN')).toBe('zh-CN');
    expect(normalizeLanguageSetting('fr')).toBe('system');
    expect(normalizeLanguageSetting(undefined)).toBe('system');
  });
});

describe('i18n 翻译', () => {
  it('占位符插值：{name} 由 params 替换', () => {
    expect(translateByLocale('zh-CN', 'update.availableTitle', { version: '0.2.0' })).toBe(
      '发现新版本 0.2.0',
    );
    expect(translateByLocale('en', 'update.availableTitle', { version: '0.2.0' })).toBe(
      'New version 0.2.0 available',
    );
    expect(translateByLocale('zh-CN', 'statusBar.wordCount', { wordCount: 12 })).toBe('12 字');
    expect(translateByLocale('zh-CN', 'statusBar.sourceMode', { shortcut: 'Ctrl+E' })).toBe(
      '源码模式 (Ctrl+E)',
    );
    expect(translateByLocale('zh-CN', 'statusBar.settings', { shortcut: 'Ctrl+,' })).toBe(
      '设置 (Ctrl+,)',
    );
    expect(translateByLocale('zh-CN', 'tabBar.newTab', { shortcut: 'Ctrl+T' })).toBe(
      '新标签页 (Ctrl+T)',
    );
    expect(translateByLocale('zh-CN', 'statusBar.showOutline', { shortcut: 'Ctrl+Shift+L' })).toBe(
      '显示大纲 (Ctrl+Shift+L)',
    );
    expect(translateByLocale('zh-CN', 'statusBar.showFileTree', { shortcut: 'Ctrl+Shift+E' })).toBe(
      '显示文件树 (Ctrl+Shift+E)',
    );
    expect(translateByLocale('en', 'statusBar.showOutline', { shortcut: 'Cmd+Shift+L' })).toBe(
      'Show Outline (Cmd+Shift+L)',
    );
    expect(translateByLocale('en', 'statusBar.sourceMode', { shortcut: 'Cmd+E' })).toBe(
      'Source Mode (Cmd+E)',
    );
  });

  it('缺失占位符参数时保留占位符原样，便于发现缺参', () => {
    expect(translateByLocale('en', 'confirm.unsavedChangesBody')).toBe('Save changes to "{name}"?');
  });

  it('未知键回显键名，便于尽早发现缺键', () => {
    expect(translateByLocale('zh-CN', 'missing.key' as MessageKey)).toBe('missing.key');
  });

  it('en 资源键与 zh-CN 完全一致（运行期兜底校验）', () => {
    const zhKeys = Object.keys(zhCN).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(zhKeys);
  });
});
