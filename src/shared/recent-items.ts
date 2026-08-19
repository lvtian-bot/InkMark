// 最近打开项的共享类型与纯逻辑。
//
// 历史数据是纯字符串数组(只有路径,且基本都是文件);后来升级为带 kind 的对象,
// 以便开始页混排展示文件与文件夹,并增加了可选的 starred 字段(文件加星)。
// normalizeRecentItems 负责把这些格式都解析为标准对象数组:旧字符串一律按
// file 处理(历史数据里没有文件夹)。

export type RecentKind = 'file' | 'folder';

export interface RecentItem {
  path: string;
  kind: RecentKind;
  /** 加星文件:常驻置顶分组、不占最近文件配额。只对 file 有意义,文件夹恒不加星。 */
  starred?: boolean;
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

function isSameRecentItem(a: RecentItem, b: RecentItem): boolean {
  return a.path === b.path && a.kind === b.kind && (a.starred === true) === (b.starred === true);
}

/**
 * 把磁盘上读取的任意数据归一化为 RecentItem[]。
 * 兼容旧格式(纯 string[])和新格式({path,kind,starred?}[]),排序固定为
 * 文件夹 -> 加星文件 -> 普通文件,各组内部保持输入顺序。
 */
export function normalizeRecentItems(data: unknown): RecentItem[] {
  if (!Array.isArray(data)) return [];
  const folders: RecentItem[] = [];
  const starredFiles: RecentItem[] = [];
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
        // 星标是文件的概念,文件夹恒不加星(文件夹本身已有常驻置顶机制)
        folders.push({ path: entry.path, kind: 'folder' });
      } else if (entry.starred === true) {
        starredFiles.push({ path: entry.path, kind: 'file', starred: true });
      } else {
        files.push({ path: entry.path, kind: 'file' });
      }
    }
  }
  return [...folders, ...starredFiles, ...files];
}

/**
 * 把新项插入或提到最近列表。同路径去重(忽略 kind 差异)。
 * 采用独立配额与文件夹置顶机制：
 * 1. 文件夹最多保留 maxFolders 个（默认 3 个），始终排在列表最上方；
 * 2. 加星文件常驻置顶分组(文件夹之下)、不占文件配额、重新打开保留星标；
 * 3. 文件最多保留 maxFiles 个（默认 10 个），配额只作用于普通文件，
 *    即频繁打开文件只会淘汰最旧的普通文件,文件夹和加星文件永远保留。
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

  const existing = items.find((item) => item.path === path);
  const isExistingStarredFile = existing?.kind === 'file' && existing.starred === true;

  const existingFolders = items.filter((item) => item.path !== path && item.kind === 'folder');
  const existingStarredFiles = items.filter(
    (item) => item.path !== path && item.kind === 'file' && item.starred === true,
  );
  const existingNormalFiles = items.filter(
    (item) => item.path !== path && item.kind === 'file' && item.starred !== true,
  );

  const folders =
    kind === 'folder'
      ? [{ path, kind: 'folder' as const }, ...existingFolders].slice(0, resolvedLimits.maxFolders)
      : existingFolders.slice(0, resolvedLimits.maxFolders);

  // 加星文件重新打开时保留星标并回到加星分组顶部,不做配额裁剪
  const starredFiles = isExistingStarredFile
    ? [{ ...existing, kind: 'file' as const }, ...existingStarredFiles]
    : existingStarredFiles;

  const normalFiles =
    kind === 'file' && !isExistingStarredFile
      ? [{ path, kind: 'file' as const }, ...existingNormalFiles].slice(0, resolvedLimits.maxFiles)
      : existingNormalFiles;

  const next: RecentItem[] = [...folders, ...starredFiles, ...normalFiles];

  if (
    items.length === next.length &&
    items.every((item, idx) => isSameRecentItem(item, next[idx]))
  ) {
    return items;
  }
  return next;
}

/**
 * 切换某个文件的加星状态。
 * 加星:进入置顶分组顶部(文件夹之下、普通文件之上),不占最近文件配额;
 * 取消加星:回到普通文件分组顶部,且不做配额裁剪,避免刚取消星标的行立即消失,
 * 待下一次打开普通文件时才恢复 maxFiles 上限。
 * 文件夹不支持加星;路径不存在时原样返回原数组。
 * 泛型保证调用方携带的附加字段(如界面拆分出的文件名/目录)在重排后保留。
 */
export function toggleRecentStar<T extends RecentItem>(items: T[], path: string): T[] {
  const target = items.find((item) => item.path === path);
  if (!target || target.kind !== 'file') return items;
  const folders = items.filter((item) => item.kind === 'folder');
  const starredFiles = items.filter(
    (item) => item.kind === 'file' && item.starred === true && item.path !== path,
  );
  const normalFiles = items.filter(
    (item) => item.kind === 'file' && item.starred !== true && item.path !== path,
  );
  if (target.starred === true) {
    return [...folders, ...starredFiles, { ...target, starred: false }, ...normalFiles];
  }
  return [...folders, { ...target, starred: true }, ...starredFiles, ...normalFiles];
}

/** 删除指定路径的最近项;返回新数组。 */
export function removeRecent(items: RecentItem[], path: string): RecentItem[] {
  return items.filter((item) => item.path !== path);
}
