// 文件树基础操作与标签同步的纯决策逻辑。
//
// 重命名/删除文件树条目时，需要找出受影响的已打开标签并决定提示形态：
// 有未保存修改的标签删除后会丢内容，须在确认框中明确警示。
// 路径包含判断统一走 shared 的 isPathInside，不用字符串前缀近似。

import { isPathInside } from '../../shared/file-tree-follow';
import type { Tab } from './stores/useStore';

/** 找出文件路径落在 targetPath（文件或目录）之内的已打开标签。 */
export function findTabsUnderPath(tabs: Tab[], targetPath: string): Tab[] {
  return tabs.filter((tab) => tab.filePath !== null && isPathInside(tab.filePath, targetPath));
}

/**
 * 提示条上还有未处理外部更新（等待重新加载）的标签。
 * 此时磁盘已是外部新版本，重命名会沿用旧基线让提示条消失，
 * 后续保存将无冲突提示地覆盖外部版本；删除则会连带丢弃未见过的外部内容。
 */
export function findTabsWithPendingExternalUpdate(tabs: Tab[]): Tab[] {
  return tabs.filter((tab) => tab.externalUpdatePending);
}

/** 删除前的提示形态。 */
export type DeleteWarning = 'external-pending' | 'dirty-open' | 'none';

/**
 * 提示条上还有未处理的外部更新时阻止删除，避免丢弃未查看的外部内容。
 * 打开的标签有未保存修改时警示内容丢失，其他文件走常规确认。
 */
export function decideDeleteWarning(tabs: Tab[], targetPath: string): DeleteWarning {
  const affected = findTabsUnderPath(tabs, targetPath);
  if (findTabsWithPendingExternalUpdate(affected).length > 0) return 'external-pending';
  if (affected.some((tab) => tab.isDirty)) return 'dirty-open';
  return 'none';
}
