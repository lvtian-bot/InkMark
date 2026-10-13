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

/** 删除前的提示形态。 */
export type DeleteWarning = 'review-blocked' | 'dirty-open' | 'none';

/**
 * 决定删除 targetPath 前的提示：审阅中一律阻止；否则有未保存修改的
 * 打开标签时警示内容丢失；干净文件直接常规确认。
 */
export function decideDeleteWarning(tabs: Tab[], targetPath: string): DeleteWarning {
  const affected = findTabsUnderPath(tabs, targetPath);
  if (findTabsWithActiveReview(affected).length > 0) return 'review-blocked';
  if (affected.some((tab) => tab.isDirty)) return 'dirty-open';
  return 'none';
}
