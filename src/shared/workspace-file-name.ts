// 工作区文件树基础操作的共享类型与纯逻辑：文件名校验、操作结果类型。
//
// InkMark 当前只在 Windows 上分发，校验按 Windows 文件名规则执行：
// 禁止字符、保留名与结尾点/空格在 NTFS 上都会造成创建失败或名称被
// 静默改写；跨平台部署时这套规则同样安全（只更严，不更松）。

/** 文件名不合法的具体原因，供界面给出可操作的提示。 */
export type WorkspaceFileNameIssue =
  'empty' | 'invalid-chars' | 'reserved-name' | 'trailing-dot-or-space';

/** 文件树新建/重命名失败的结构化原因（成功时不携带）。 */
export type WorkspaceFileOpError =
  'invalid-name' | 'exists' | 'parent-missing' | 'source-missing' | 'io-error';

export interface WorkspaceFileOpSuccess {
  path: string;
  mtime: number;
}

export type WorkspaceFileOpResult = WorkspaceFileOpSuccess | { error: WorkspaceFileOpError };

/** Windows 文件名禁止字符；控制字符一并禁止。 */
// eslint-disable-next-line no-control-regex -- 控制字符正是要拦截的目标
const INVALID_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;

/** Windows 保留设备名（不区分大小写，含带扩展名的形式，如 CON.txt）。 */
const RESERVED_BASE_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/**
 * 校验单个文件名（不含路径分隔符）。
 * 返回 null 表示可用；否则返回具体原因。
 */
export function validateWorkspaceFileName(name: string): WorkspaceFileNameIssue | null {
  if (name === '') return 'empty';
  if (INVALID_NAME_CHARS.test(name)) return 'invalid-chars';
  if (name.endsWith('.') || name.endsWith(' ')) return 'trailing-dot-or-space';
  const base = name.split('.')[0]!;
  if (RESERVED_BASE_NAMES.has(base.toUpperCase())) return 'reserved-name';
  return null;
}

/** 同一目录内的名称比较键：Windows 文件名不区分大小写。 */
function nameKey(name: string): string {
  return name.toLowerCase();
}

/** 判断候选名称是否与同目录既有条目重名（不区分大小写）。 */
export function isWorkspaceFileNameTaken(name: string, siblingNames: string[]): boolean {
  const key = nameKey(name);
  return siblingNames.some((sibling) => nameKey(sibling) === key);
}

/**
 * 生成不与既有条目冲突的默认名：冲突时追加「 2」「 3」…
 * 用于「新建文档」对话框的预填名称，重命名场景不用（用户意图必须原样执行）。
 */
export function ensureUniqueFileName(desired: string, siblingNames: string[]): string {
  if (!isWorkspaceFileNameTaken(desired, siblingNames)) return desired;
  const dotIndex = desired.lastIndexOf('.');
  const stem = dotIndex > 0 ? desired.slice(0, dotIndex) : desired;
  const ext = dotIndex > 0 ? desired.slice(dotIndex) : '';
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} ${n}${ext}`;
    if (!isWorkspaceFileNameTaken(candidate, siblingNames)) return candidate;
  }
}
