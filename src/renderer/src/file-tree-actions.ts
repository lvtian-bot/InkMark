// 文件树基础操作与标签同步的纯决策逻辑。
//
// 重命名/删除文件树条目时，需要找出受影响的已打开标签并决定提示形态：
// 审阅中的标签固定了磁盘快照，路径一旦变化快照即失效，必须先完成或
// 放弃审阅；有未保存修改的标签删除后会丢内容，须在确认框中明确警示。
// 路径包含判断统一走 shared 的 isPathInside，不用字符串前缀近似。

import { isPathInside } from '../../shared/file-tree-follow';
import type { Tab } from './stores/useStore';

/** 找出文件路径落在 targetPath（文件或目录）之内的已打开标签。 */
export function findTabsUnderPath(tabs: Tab[], targetPath: string): Tab[] {
  return tabs.filter((tab) => tab.filePath !== null && isPathInside(tab.filePath, targetPath));
}

/** 正处于审阅会话或有未决审阅块、因此不能被重命名/删除的标签。 */
export function findTabsWithActiveReview(tabs: Tab[]): Tab[] {
  return tabs.filter((tab) => tab.reviewSession || tab.pendingReviewCount > 0);
}

/**
 * 提示条上还有未处理外部更新（等待重新加载或审阅）的标签。
 * 此时磁盘已是外部新版本，重命名会沿用旧基线让提示条消失，
 * 后续保存将无冲突提示地覆盖外部版本；删除则会连带丢弃未见过的外部内容。
 */
export function findTabsWithPendingExternalUpdate(tabs: Tab[]): Tab[] {
  return tabs.filter((tab) => tab.externalUpdatePending);
}

/** 删除前的提示形态。 */
export type DeleteWarning = 'review-blocked' | 'external-pending' | 'dirty-open' | 'none';

/**
 * 决定删除 targetPath 前的提示：审阅中一律阻止；提示条上还有未处理外部
 * 更新时同样阻止，避免连带丢弃未见过的外部内容；有未保存修改的打开标签
 * 时警示内容丢失；干净文件直接常规确认。
 */
export function decideDeleteWarning(tabs: Tab[], targetPath: string): DeleteWarning {
  const affected = findTabsUnderPath(tabs, targetPath);
  if (findTabsWithActiveReview(affected).length > 0) return 'review-blocked';
  if (findTabsWithPendingExternalUpdate(affected).length > 0) return 'external-pending';
  if (affected.some((tab) => tab.isDirty)) return 'dirty-open';
  return 'none';
}
