// 最近打开项的共享类型与纯逻辑。
//
// 历史数据是纯字符串数组(只有路径,且基本都是文件);后来升级为带 kind 的对象,
// 以便开始页混排展示文件与文件夹,并增加了可选的 starred 字段(加星置顶,
// 文件与文件夹均可)。normalizeRecentItems 负责把这些格式都解析为标准对象数组:
// 旧字符串一律按 file 处理(历史数据里没有文件夹)。

export type RecentKind = 'file' | 'folder';

export interface RecentItem {
  path: string;
  kind: RecentKind;
  /** 加星项:常驻列表最上方、不占所在 kind 的配额。星标是唯一的置顶机制。 */
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
 * 加星文件夹 -> 加星文件 -> 普通文件夹 -> 普通文件,各组内部保持输入顺序。
 */
export function normalizeRecentItems(data: unknown): RecentItem[] {
  if (!Array.isArray(data)) return [];
  const starredFolders: RecentItem[] = [];
  const starredFiles: RecentItem[] = [];
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
      const starred = entry.starred === true;
      if (kind === 'folder' && starred) {
        starredFolders.push({ path: entry.path, kind: 'folder', starred: true });
      } else if (kind === 'folder') {
        folders.push({ path: entry.path, kind: 'folder' });
      } else if (starred) {
        starredFiles.push({ path: entry.path, kind: 'file', starred: true });
      } else {
        files.push({ path: entry.path, kind: 'file' });
      }
    }
  }
  return [...starredFolders, ...starredFiles, ...folders, ...files];
}

/**
 * 把新项插入或提到最近列表。同路径去重(忽略 kind 差异),星标跟随路径保留。
 * 排序固定为 加星文件夹 -> 加星文件 -> 普通文件夹 -> 普通文件：
 * 1. 加星项(文件或文件夹)常驻最上方、不占所在 kind 的配额,重新打开保留
 *    星标并回到对应加星分组顶部;
 * 2. 普通文件夹最多 maxFolders 个（默认 3 个）、普通文件最多 maxFiles 个
 *    （默认 10 个）,配额只在插入普通项时收紧,即频繁打开只会淘汰最旧的普通项。
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
  // 星标跟随路径:同路径以另一 kind 重新打开时保留加星状态
  const carryStarred = existing?.starred === true;

  const existingStarredFolders = items.filter(
    (item) => item.path !== path && item.kind === 'folder' && item.starred === true,
  );
  const existingNormalFolders = items.filter(
    (item) => item.path !== path && item.kind === 'folder' && item.starred !== true,
  );
  const existingStarredFiles = items.filter(
    (item) => item.path !== path && item.kind === 'file' && item.starred === true,
  );
  const existingNormalFiles = items.filter(
    (item) => item.path !== path && item.kind === 'file' && item.starred !== true,
  );

  // 加星项重新打开时保留星标并回到对应加星分组顶部,不做配额裁剪
  const starredFolders =
    kind === 'folder' && carryStarred
      ? [{ path, kind: 'folder' as const, starred: true }, ...existingStarredFolders]
      : existingStarredFolders;
  const starredFiles =
    kind === 'file' && carryStarred
      ? [{ path, kind: 'file' as const, starred: true }, ...existingStarredFiles]
      : existingStarredFiles;

  const normalFolders =
    kind === 'folder' && !carryStarred
      ? [{ path, kind: 'folder' as const }, ...existingNormalFolders].slice(
          0,
          resolvedLimits.maxFolders,
        )
      : existingNormalFolders;
  const normalFiles =
    kind === 'file' && !carryStarred
      ? [{ path, kind: 'file' as const }, ...existingNormalFiles].slice(0, resolvedLimits.maxFiles)
      : existingNormalFiles;

  const next: RecentItem[] = [...starredFolders, ...starredFiles, ...normalFolders, ...normalFiles];

  if (
    items.length === next.length &&
    items.every((item, idx) => isSameRecentItem(item, next[idx]))
  ) {
    return items;
  }
  return next;
}

/**
 * 切换某一项的加星状态,文件与文件夹均可。星标是唯一的置顶机制:
 * 加星进入加星分组顶部;取消加星回到同类普通分组顶部,且不做配额裁剪,
 * 避免刚取消星标的行立即消失,待下一次插入普通项时才恢复上限。
 * 路径不存在时原样返回原数组。
 * 泛型保证调用方携带的附加字段(如界面拆分出的文件名/目录)在重排后保留。
 */
export function toggleRecentStar<T extends RecentItem>(items: T[], path: string): T[] {
  const target = items.find((item) => item.path === path);
  if (!target) return items;
  const starredFolders = items.filter(
    (item) => item.kind === 'folder' && item.starred === true && item.path !== path,
  );
  const starredFiles = items.filter(
    (item) => item.kind === 'file' && item.starred === true && item.path !== path,
  );
  const normalFolders = items.filter(
    (item) => item.kind === 'folder' && item.starred !== true && item.path !== path,
  );
  const normalFiles = items.filter(
    (item) => item.kind === 'file' && item.starred !== true && item.path !== path,
  );
  if (target.starred === true) {
    return target.kind === 'folder'
      ? [
          ...starredFolders,
          ...starredFiles,
          { ...target, starred: false },
          ...normalFolders,
          ...normalFiles,
        ]
      : [
          ...starredFolders,
          ...starredFiles,
          ...normalFolders,
          { ...target, starred: false },
          ...normalFiles,
        ];
  }
  return target.kind === 'folder'
    ? [
        { ...target, starred: true },
        ...starredFolders,
        ...starredFiles,
        ...normalFolders,
        ...normalFiles,
      ]
    : [
        ...starredFolders,
        { ...target, starred: true },
        ...starredFiles,
        ...normalFolders,
        ...normalFiles,
      ];
}

/** 删除指定路径的最近项;返回新数组。 */
export function removeRecent(items: RecentItem[], path: string): RecentItem[] {
  return items.filter((item) => item.path !== path);
}
