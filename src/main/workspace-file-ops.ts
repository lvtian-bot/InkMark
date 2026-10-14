// 文件树基础操作的文件系统实现：在指定目录新建 Markdown 文档、重命名文件。
//
// 只做最小文件系统动作，IPC 校验与自身写入抑制由 index.ts 的 handler 层负责；
// 删除到回收站依赖 electron shell，同样留在 index.ts 内联。所有失败都以
// 结构化原因返回，不抛出异常，便于渲染层按原因给出可操作的提示。

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, isAbsolute, join, resolve } from 'path';
import {
  validateWorkspaceDocumentName,
  type WorkspaceFileOpResult,
} from '../shared/workspace-file-name';

export type {
  WorkspaceFileOpError,
  WorkspaceFileOpResult,
  WorkspaceFileOpSuccess,
} from '../shared/workspace-file-name';

/** 在 dirPath 下新建空 Markdown 文档，不覆盖既有文件。 */
export function createWorkspaceDocument(dirPath: string, fileName: string): WorkspaceFileOpResult {
  if (validateWorkspaceDocumentName(fileName)) return { error: 'invalid-name' };
  // 目录探测同样在错误边界内:目录在检查瞬间被移除或权限异常时返回结构化
  // parent-missing,不让异常穿透 IPC
  try {
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory())
      return { error: 'parent-missing' };
  } catch {
    return { error: 'parent-missing' };
  }

  const targetPath = join(dirPath, fileName);
  try {
    writeFileSync(targetPath, '', { flag: 'wx' });
    return { path: resolve(targetPath), mtime: statSync(targetPath).mtimeMs };
  } catch (error) {
    if (isAlreadyExistsError(error)) return { error: 'exists' };
    // 写入成功但读取元数据失败时同样返回结构化错误，不让 IPC Promise 拒绝;
    // 文件可能已创建,由渲染层刷新目录后可见。
    return { error: 'io-error' };
  }
}

/**
 * 重命名文件；新名针对同目录校验，不覆盖既有文件。
 *
 * expectedMtime 为调用方已知的磁盘基线（该文件有打开标签时为其 fileMtime）：
 * 磁盘当前修改时间与基线不一致说明存在尚未处理的外部版本，直接重命名会把
 * 基线洗成外部版本的修改时间、让下次保存无冲突地覆盖它，因此返回 conflict
 * 交由渲染层提示。与 file:save 的 knownMtime 检查同一模式。
 */
export function renameWorkspaceFile(
  oldPath: string,
  newName: string,
  expectedMtime?: number | null,
): WorkspaceFileOpResult {
  if (validateWorkspaceDocumentName(newName)) return { error: 'invalid-name' };
  // 源必须是普通文件:目录(含批准的工作区根本身)一律拒绝,否则整个工作区
  // 目录可被改名搬到批准边界之外;基线核对合并到同一次 stat
  let sourceMtime: number;
  try {
    const stat = statSync(oldPath);
    if (!stat.isFile()) return { error: 'source-missing' };
    sourceMtime = stat.mtimeMs;
  } catch {
    return { error: 'source-missing' };
  }
  if (expectedMtime != null && sourceMtime !== expectedMtime) return { error: 'conflict' };

  const targetPath = join(dirname(oldPath), newName);
  // Windows 上 rename 会静默替换已存在的目标条目，必须先显式拦截，
  // 不能依赖 rename 自身报错，否则重命名会覆盖同名文件造成数据丢失。
  // 存在性按目录条目判定（lstat）：悬空符号链接会让 existsSync（跟随链接
  // 找目标）误判为可用，rename 却会顶掉该条目。
  // 仅大小写差异的改名（note.md → Note.md）是同一文件的合法重命名，放行。
  // 显式检查与 rename 之间存在极小竞态窗口（另一进程恰好先创建同名目标），
  // Node 未提供原子的不覆盖 rename，此窗口与项目「保存依赖 mtime 检查、
  // 不提供文件锁」的并发保护立场一致，不承诺绝对无冲突。
  const isCaseOnlyRename =
    process.platform === 'win32' &&
    resolve(oldPath).toLowerCase() === resolve(targetPath).toLowerCase();
  if (!isCaseOnlyRename) {
    try {
      lstatSync(targetPath);
      return { error: 'exists' };
    } catch (error) {
      if (!isNoSuchEntryError(error)) return { error: 'io-error' };
    }
  }
  try {
    renameSync(oldPath, targetPath);
  } catch (error) {
    if (isAlreadyExistsError(error)) return { error: 'exists' };
    if (isNoSuchEntryError(error)) return { error: 'source-missing' };
    return { error: 'io-error' };
  }
  // rename 已完成即视为成功:网络盘上紧随的元数据读取可能瞬时失败,若按
  // 失败返回,渲染层会把标签与最近记录留在已不存在的旧路径、自动保存还
  // 会重建旧文件——读取失败时用源文件的 mtime 兜底(内容未变,基线可信)。
  try {
    return { path: resolve(targetPath), mtime: statSync(targetPath).mtimeMs };
  } catch {
    return { path: resolve(targetPath), mtime: sourceMtime };
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EEXIST'
  );
}

function isNoSuchEntryError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/** 为测试创建隔离的临时目录。 */
export function createTempWorkspaceDir(): string {
  const base = join(tmpdir(), 'inkmark-workspace-file-ops-');
  const dir = mkdtempSync(base);
  if (!isAbsolute(dir)) throw new Error('temp dir must be absolute');
  mkdirSync(dir, { recursive: true });
  return dir;
}
