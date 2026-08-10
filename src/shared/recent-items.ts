// 最近打开项的共享类型与纯逻辑。
//
// 历史数据是纯字符串数组(只有路径,且基本都是文件);现在升级为带 kind 的对象,
// 以便开始页混排展示文件与文件夹。normalizeRecentItems 负责把两种格式都解析为
// 标准对象数组:旧字符串一律按 file 处理(历史数据里没有文件夹)。

export type RecentKind = 'file' | 'folder';

export interface RecentItem {
  path: string;
  kind: RecentKind;
}

function isRecentKind(value: unknown): value is RecentKind {
  return value === 'file' || value === 'folder';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 把磁盘上读取的任意数据归一化为 RecentItem[]。
 * 兼容旧格式(纯 string[])和新格式({path,kind}[])。
 */
export function normalizeRecentItems(data: unknown): RecentItem[] {
  if (!Array.isArray(data)) return [];
  const items: RecentItem[] = [];
  for (const entry of data) {
    if (typeof entry === 'string') {
      // 旧格式:历史最近项都是文件,文件夹是新能力,此前不会进入此列表
      items.push({ path: entry, kind: 'file' });
      continue;
    }
    if (isObject(entry) && typeof entry.path === 'string') {
      items.push({
        path: entry.path,
        kind: isRecentKind(entry.kind) ? entry.kind : 'file',
      });
    }
  }
  return items;
}

/**
 * 把新项插入或提到最近列表顶部。同路径去重(忽略 kind 差异),超过上限截断。
 * 返回新数组;若结果与原列表等价(同路径已在顶部且 kind 一致)则返回原数组,
 * 便于上层判断是否需要写盘。
 */
export function addOrUpdateRecent(
  items: RecentItem[],
  path: string,
  kind: RecentKind,
  maxItems: number,
): RecentItem[] {
  const filtered = items.filter((item) => item.path !== path);
  if (
    filtered.length === items.length - 1 &&
    items.length > 0 &&
    items[0].path === path &&
    items[0].kind === kind
  ) {
    return items;
  }
  const next = [{ path, kind }, ...filtered].slice(0, Math.max(0, maxItems));
  return next;
}

/** 删除指定路径的最近项;返回新数组。 */
export function removeRecent(items: RecentItem[], path: string): RecentItem[] {
  return items.filter((item) => item.path !== path);
}
