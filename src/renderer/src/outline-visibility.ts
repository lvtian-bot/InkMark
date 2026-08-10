import type { Heading } from './types';

/**
 * 大纲折叠的纯逻辑：哪些标题可折叠、折叠后可见哪些标题、
 * 活跃标题被折叠时高亮回落到哪个可见祖先。与组件分离以便单元测试。
 */

/** 后跟更深层级标题的条目视为可折叠（有子标题）。 */
export function computeCollapsibleIds(headings: Heading[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < headings.length - 1; i++) {
    if (headings[i + 1].level > headings[i].level) {
      ids.add(headings[i].id);
    }
  }
  return ids;
}

/** 按折叠集合计算可见标题：被折叠标题之后所有更深层级均隐藏。 */
export function computeVisibleHeadings(headings: Heading[], collapsedIds: Set<string>): Heading[] {
  const visible: Heading[] = [];
  const collapsedLevels: number[] = [];
  for (const heading of headings) {
    while (
      collapsedLevels.length > 0 &&
      heading.level <= collapsedLevels[collapsedLevels.length - 1]
    ) {
      collapsedLevels.pop();
    }
    if (collapsedLevels.length > 0) continue;
    visible.push(heading);
    if (collapsedIds.has(heading.id)) collapsedLevels.push(heading.level);
  }
  return visible;
}

/**
 * 活跃标题可见时原样返回；被折叠隐藏时回落到最近的可见祖先标题，
 * 保证正文滚到折叠区间内时高亮仍有落点。
 */
export function resolveActiveId(
  headings: Heading[],
  visibleIds: Set<string>,
  activeId: string | null,
): string | null {
  if (activeId === null) return null;
  const index = headings.findIndex((h) => h.id === activeId);
  if (index < 0) return null;
  if (visibleIds.has(activeId)) return activeId;
  const level = headings[index].level;
  for (let i = index - 1; i >= 0; i--) {
    if (headings[i].level < level && visibleIds.has(headings[i].id)) {
      return headings[i].id;
    }
  }
  return null;
}
