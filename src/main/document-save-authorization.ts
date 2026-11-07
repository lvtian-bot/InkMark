import { lstatSync, realpathSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { createWorkspaceAuthorization } from './workspace-authorization';

/** 对同一个真实位置做权限判断和写入，避免目录联接或路径别名改变目标。 */
export function resolveDocumentSaveTarget(path: string): string | null {
  const resolved = resolve(path);
  const name = basename(resolved);
  if (process.platform === 'win32' && name.includes(':')) return null;
  try {
    return lstatSync(resolved).isFile() ? realpathSync(resolved) : null;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) return null;
    // 允许恢复已被移走的文档，但其父目录必须仍然存在。
    try {
      return join(realpathSync(dirname(resolved)), name);
    } catch {
      return null;
    }
  }
}

function documentSaveKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

export function createDocumentSaveAuthorization() {
  const files = new Set<string>();
  const workspaces = createWorkspaceAuthorization();
  return {
    approveFile(target: string): void {
      files.add(documentSaveKey(target));
    },
    moveFile(from: string, to: string): void {
      if (files.delete(documentSaveKey(from))) files.add(documentSaveKey(to));
    },
    approveWorkspace: workspaces.approve,
    isApproved(target: string): boolean {
      return files.has(documentSaveKey(target)) || workspaces.isApprovedDescendant(target);
    },
  };
}
