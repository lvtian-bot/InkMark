// 工作区文件树的共享类型与纯逻辑。
//
// 文件树只读浏览:主进程读取单层目录条目后用这里的纯函数过滤与排序,
// 渲染端按需逐层懒加载。本模块不依赖 Node 或 DOM,可在主进程、预加载
// 与渲染进程三端复用;需要 fs/path 的目录读取由主进程完成后再传入。

import { hasOpenableDocumentExtension } from './openable-document';

/** 单层目录条目:主进程读取后转为此结构,渲染端直接渲染。 */
export interface WorkspaceEntry {
  name: string;
  absolutePath: string;
  isDirectory: boolean;
}

/** 文件树默认不展示的目录(依赖与缓存目录,只制造噪音)。 */
export const WORKSPACE_IGNORED_DIRECTORIES: readonly string[] = ['node_modules', '__pycache__'];

/**
 * 判断单个条目是否应出现在文件树中。
 * - 以点号开头的隐藏项(.git、.assets、.DS_Store、.hidden.md 等)一律忽略。
 * - 文件保留全部可打开文档的扩展名(Markdown 与纯文本/代码,见 openable-document)。
 * - 目录全部保留以便展开,依赖与缓存目录(node_modules、__pycache__)除外。
 */
export function shouldIncludeEntry(name: string, isDirectory: boolean): boolean {
  if (name === '' || name.startsWith('.')) return false;
  if (isDirectory) {
    return !WORKSPACE_IGNORED_DIRECTORIES.includes(name.toLowerCase());
  }
  return hasOpenableDocumentExtension(name);
}

/** 比较器:目录优先,同类内按名称不区分大小写排序,保证跨平台稳定顺序。 */
export function compareWorkspaceEntries(a: WorkspaceEntry, b: WorkspaceEntry): number {
  if (a.isDirectory !== b.isDirectory) {
    return a.isDirectory ? -1 : 1;
  }
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

/**
 * 过滤并排序单层目录条目,返回可直接渲染的文件树一层。
 * 供主进程 `dir:list` 在读取目录后调用。
 */
export function filterWorkspaceEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries
    .filter((entry) => shouldIncludeEntry(entry.name, entry.isDirectory))
    .sort(compareWorkspaceEntries);
}
