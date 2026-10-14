// 文件树基础操作的工作区授权（主进程专用）。
//
// 授权含义：哪些目录之下允许执行新建/重命名/删除。授权只来自用户可感知
// 的可信途径（原生对话框、应用推送的打开、启动时从可信最近记录播种），
// 不能来自渲染层任意可控的 IPC 参数——否则被攻破的渲染层可自行扩大授权范围。
//
// 必须保持的规则：
// 1. 判定与登记前先规范化路径：resolve 处理 `..` 等文本段（防穿越），
//    再用 realpath 解析符号链接与 Windows 目录联接，批准目录内的链接
//    别名不把边界外的真实位置带进来；
// 2. 目标可能尚不存在（新建文档的目标文件），realpath 失败时向上找最近
//    存在的祖先再解析；
// 3. 盘符根/文件系统根不授权：在盘符根下打开文档不应放开整个盘。

import { realpathSync } from 'fs';
import { dirname, parse, resolve } from 'path';
import { isPathInside } from '../shared/file-tree-follow';

export interface WorkspaceAuthorization {
  /** 登记一个已获用户信任的目录（规范化为真实路径，根目录被忽略）。 */
  approve: (directoryPath: string) => void;
  /** 判断目标（解析链接后）是否落在任一已批准目录之内。 */
  isApproved: (targetPath: string) => boolean;
}

/** 解析已存在路径的真实位置；不存在或不可访问时退回文本规范化结果。 */
function canonicalizeExisting(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** 向上寻找最近存在的祖先并解析其真实位置；到根仍失败则返回规范化文本。 */
function canonicalizeNearestExisting(targetPath: string): string {
  let probe = resolve(targetPath);
  for (;;) {
    try {
      return realpathSync(probe);
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return probe;
      probe = parent;
    }
  }
}

export function createWorkspaceAuthorization(): WorkspaceAuthorization {
  const approvedRoots = new Set<string>();

  const approve = (directoryPath: string): void => {
    const canonical = canonicalizeExisting(directoryPath);
    if (parse(canonical).root === canonical) return;
    approvedRoots.add(canonical);
  };

  const isApproved = (targetPath: string): boolean => {
    const canonical = canonicalizeNearestExisting(targetPath);
    for (const root of approvedRoots) {
      if (isPathInside(canonical, root)) return true;
    }
    return false;
  };

  return { approve, isApproved };
}
