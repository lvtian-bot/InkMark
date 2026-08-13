import type { MessageKey } from '../../shared/i18n';

export interface TabIdentity {
  filePath: string | null;
  isStartPage: boolean;
  fileName: string;
}

export type TabTranslate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * 标签页显示名：有文件路径时用文件名（路径无关语言）；开始页与未命名文档
 * 的名称随界面语言翻译，避免把 store 里存储的数据做成按语言写死。
 */
export function tabDisplayName(tab: TabIdentity, t: TabTranslate): string {
  if (tab.filePath) return tab.filePath.split(/[/\\]/).pop() ?? tab.fileName;
  return tab.isStartPage ? t('tabBar.welcome') : t('tabBar.untitled');
}
