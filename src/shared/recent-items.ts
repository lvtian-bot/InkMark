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

export interface RecentLimits {
  maxFiles: number;
  maxFolders: number;
}

export const DEFAULT_MAX_RECENT_FILES = 10;
export const DEFAULT_MAX_RECENT_FOLDERS = 3;

export const DEFAULT_RECENT_LIMITS: RecentLimits = {
  maxFiles: DEFAULT_MAX_RECENT_FILES,
  maxFolders: DEFAULT_MAX_RECENT_FOLDERS,
};

function isRecentKind(value: unknown): value is RecentKind {
  return value === 'file' || value === 'folder';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 把磁盘上读取的任意数据归一化为 RecentItem[]。
 * 兼容旧格式(纯 string[])和新格式({path,kind}[])，并确保文件夹始终排在文件前面。
 */
export function normalizeRecentItems(data: unknown): RecentItem[] {
  if (!Array.isArray(data)) return [];
  const folders: RecentItem[] = [];
  const files: RecentItem[] = [];
  for (const entry of data) {
    if (typeof entry === 'string') {
      // 旧格式:历史最近项都是文件,文件夹是新能力,此前不会进入此列表
      files.push({ path: entry, kind: 'file' });
      continue;
    }
    if (isObject(entry) && typeof entry.path === 'string') {
      const kind: RecentKind = isRecentKind(entry.kind) ? entry.kind : 'file';
      if (kind === 'folder') {
        folders.push({ path: entry.path, kind: 'folder' });
      } else {
        files.push({ path: entry.path, kind: 'file' });
      }
    }
  }
  return [...folders, ...files];
}

/**
 * 把新项插入或提到最近列表。同路径去重(忽略 kind 差异)。
 * 采用独立配额与文件夹置顶机制：
 * 1. 文件夹最多保留 maxFolders 个（默认 3 个），始终排在列表最上方；
 * 2. 文件最多保留 maxFiles 个（默认 10 个），排在文件夹下方；
 * 3. 频繁打开文件仅在文件区淘汰最旧文件，文件夹永远置顶保留。
 * 返回新数组;若结果与原列表等价则返回原数组，便于上层判断是否需要写盘。
 */
export function addOrUpdateRecent(
  items: RecentItem[],
  path: string,
  kind: RecentKind,
  limits: Partial<RecentLimits> | number = DEFAULT_RECENT_LIMITS,
): RecentItem[] {
  const resolvedLimits: RecentLimits =
    typeof limits === 'number'
      ? { maxFiles: Math.max(0, limits), maxFolders: Math.max(0, limits) }
      : {
          maxFiles: Math.max(0, limits.maxFiles ?? DEFAULT_MAX_RECENT_FILES),
          maxFolders: Math.max(0, limits.maxFolders ?? DEFAULT_MAX_RECENT_FOLDERS),
        };

  const existingFolders = items.filter((item) => item.path !== path && item.kind === 'folder');
  const existingFiles = items.filter((item) => item.path !== path && item.kind === 'file');

  const folders =
    kind === 'folder'
      ? [{ path, kind: 'folder' as const }, ...existingFolders].slice(0, resolvedLimits.maxFolders)
      : existingFolders.slice(0, resolvedLimits.maxFolders);

  const files =
    kind === 'file'
      ? [{ path, kind: 'file' as const }, ...existingFiles].slice(0, resolvedLimits.maxFiles)
      : existingFiles.slice(0, resolvedLimits.maxFiles);

  const next: RecentItem[] = [...folders, ...files];

  if (
    items.length === next.length &&
    items.every((item, idx) => item.path === next[idx].path && item.kind === next[idx].kind)
  ) {
    return items;
  }
  return next;
}

/** 删除指定路径的最近项;返回新数组。 */
export function removeRecent(items: RecentItem[], path: string): RecentItem[] {
  return items.filter((item) => item.path !== path);
}
