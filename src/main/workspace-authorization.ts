// 文件树基础操作的工作区授权（主进程专用的纯逻辑，不触文件系统）。
//
// 授权含义：哪些目录之下允许执行新建/重命名/删除。授权只来自用户可感知
// 的可信途径（原生对话框、应用推送的打开、启动时从最近记录播种），不能
// 来自渲染层任意可控的 IPC 参数——否则被攻破的渲染层可自行扩大授权范围。
//
// 两个必须保持的规则：
// 1. 判定与登记前先 resolve：`C:\work\..\Documents` 这类路径字面上落在
//    工作区内、实际指向外部，不规范化就会被文本包含比较放行；
// 2. 盘符根/文件系统根不授权：在盘符根下打开文档不应放开整个盘。

import { parse, resolve } from 'path';
import { isPathInside } from '../shared/file-tree-follow';

export interface WorkspaceAuthorization {
  /** 登记一个已获用户信任的目录（自动规范化，根目录被忽略）。 */
  approve: (directoryPath: string) => void;
  /** 判断目标（解析后）是否落在任一已批准目录之内。 */
  isApproved: (targetPath: string) => boolean;
}

export function createWorkspaceAuthorization(): WorkspaceAuthorization {
  const approvedRoots = new Set<string>();

  const approve = (directoryPath: string): void => {
    const resolved = resolve(directoryPath);
    if (parse(resolved).root === resolved) return;
    approvedRoots.add(resolved);
  };

  const isApproved = (targetPath: string): boolean => {
    const resolved = resolve(targetPath);
    for (const root of approvedRoots) {
      if (isPathInside(resolved, root)) return true;
    }
    return false;
  };

  return { approve, isApproved };
}
