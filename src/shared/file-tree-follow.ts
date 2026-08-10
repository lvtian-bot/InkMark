// 文件树跟随标签页的共享纯逻辑。
//
// 文件树需要判断"活动文档是否在某个根目录内",并据此决定换根、恢复历史根
// 还是就地展开定位。Windows 路径盘符大小写不敏感、正反斜杠混用、结尾分隔符
// 等边界在此统一处理。本模块不依赖 Node 或 DOM,可在主进程、预加载与渲染进程
// 三端复用;目录读取由主进程完成,这里只做路径运算与决策。

/** 路径分隔符正则:同时匹配 / 与 \。 */
const SEPARATOR_RE = /[/\\]/;

/**
 * 把路径归一化为可比较的形式:连续分隔符合并为单个 /、去掉结尾分隔符、
 * 整体小写。Windows 路径大小写不敏感(盘符与目录名均如此),因此整体小写
 * 用于相等/包含比较;此函数仅用于比较,不用于还原磁盘真实路径。
 */
function normalizeForCompare(p: string): string {
  let s = p.replace(/[/\\]+/g, '/').toLowerCase();
  if (s.length > 1 && s.endsWith('/')) {
    s = s.slice(0, -1);
  }
  return s;
}

/** 按两种分隔符切分路径为段,丢弃空段(来自开头/结尾/连续分隔符)。 */
function splitSegments(p: string): string[] {
  return p.split(SEPARATOR_RE).filter((s) => s !== '');
}

/**
 * 判断 `child` 是否位于 `root` 目录内(含 root 自身)。
 * 处理 Windows 盘符大小写、正反斜杠与结尾分隔符;child 可以是文件或目录路径。
 */
export function isPathInside(child: string, root: string): boolean {
  const c = normalizeForCompare(child);
  const r = normalizeForCompare(root);
  if (c === r) return true;
  if (r === '/') return c.startsWith('/');
  return c.startsWith(r + '/');
}

/**
 * 返回 `path` 的父目录绝对路径;若已是盘符根或无法定位则返回 null。
 * 保留输入的分隔符风格与大小写。
 */
export function parentDirectory(path: string): string | null {
  const trimmed = path.replace(/[/\\]+$/, '');
  const match = trimmed.match(/^(.*[/\\])/);
  if (!match) return null;
  const parent = match[1].replace(/[/\\]+$/, '');
  if (parent === '') {
    // 形如 /a.md → 父目录为 unix 根 "/"
    return path.startsWith('/') ? '/' : null;
  }
  // 形如 C:\a.md → 父目录应是盘符根 C:\ 而非 C:(后者表示该盘当前目录)
  if (/^[a-zA-Z]:$/.test(parent)) {
    return parent + '\\';
  }
  return parent;
}

/**
 * 返回从 `root` 到 `child` 所在父目录的目录路径链(含 root,不含 child 自身)。
 * 这些目录需要被加载并展开,文件树才能显示 child。若 child 不在 root 内返回 null。
 * 拼接使用 root 的分隔符风格,保证与主进程 `dir:list` 返回的 absolutePath 一致,
 * 并保留各段原始大小写。
 */
export function directoryChainFromRoot(child: string, root: string): string[] | null {
  if (!isPathInside(child, root)) return null;
  const sep = root.includes('\\') ? '\\' : '/';
  const rootSegCount = splitSegments(root).length;
  const childSegs = splitSegments(child);
  // child 以 root 段为前缀(isPathInside 已保证,大小写不敏感),相对段为其后部分
  const relSegs = childSegs.slice(rootSegCount);
  // 去掉 child 自身(文件名或末层目录),剩下需要展开的父目录段
  const parentSegs = relSegs.length > 0 ? relSegs.slice(0, -1) : [];
  const chain: string[] = [root];
  // 去掉 root 结尾分隔符后再拼接,避免出现双分隔符
  let acc = root.replace(/[/\\]+$/, '');
  for (const seg of parentSegs) {
    acc = acc + sep + seg;
    chain.push(acc);
  }
  return chain;
}

/** 文件树跟随活动文档的决策结果。 */
export type FollowDecision =
  | { type: 'none' }
  | { type: 'stay' }
  | { type: 'restore'; root: string }
  | { type: 'switch'; folder: string };

/**
 * 根据活动文档路径、当前根与会话历史根,决定文件树跟随动作。
 *
 * - 无路径(新建未命名)→ none,不动树。
 * - 文档在当前根内 → stay,就地展开目录链并高亮。
 * - 文档在某个历史根内 → restore 到最近显示的那个根并恢复其展开状态。
 * - 否则 → switch 到文档所在文件夹。
 *
 * `historyRoots` 按最近显示优先排序(数组首元素为最近)。currentRoot 若也在其中,
 * 会被跳过(stay 已先行处理)。
 */
export function decideFileTreeFollow(
  activeFilePath: string | null,
  currentRoot: string | null,
  historyRoots: string[],
): FollowDecision {
  if (!activeFilePath) return { type: 'none' };
  if (currentRoot && isPathInside(activeFilePath, currentRoot)) {
    return { type: 'stay' };
  }
  for (const root of historyRoots) {
    if (root === currentRoot) continue;
    if (isPathInside(activeFilePath, root)) {
      return { type: 'restore', root };
    }
  }
  const folder = parentDirectory(activeFilePath);
  if (!folder) return { type: 'none' };
  return { type: 'switch', folder };
}
