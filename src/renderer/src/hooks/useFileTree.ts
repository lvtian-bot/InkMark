import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../types';
import { decideFileTreeFollow, directoryChainFromRoot } from '../../../shared/file-tree-follow';

interface DirListResult {
  path: string;
  entries: WorkspaceEntry[];
}

/**
 * 文件树数据层。
 *
 * 根目录(rootPath)是文件树自身的本地状态,不进 store——它属于工作区导航,
 * 不属于某个文档标签。目录条目按展开懒加载:首次展开某目录时请求一次,
 * 之后缓存在 dirCache 里;收到工作区监听事件时清除缓存并重新加载当前已展开的目录。
 *
 * 文件树跟随活动文档:活动文档路径变化时,按规则决定就地展开定位、恢复历史根
 * 还是切换到文档所在文件夹。跟随只更新根目录,不自动展开/收起面板本身。
 * 用户明确「打开文件夹」直接设置根,优先于跟随;此时活动文档未变,跟随不触发。
 */
export function useFileTree(activeFilePath: string | null) {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [dirCache, setDirCache] = useState<Map<string, WorkspaceEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  // 用 ref 跟踪当前展开集合与根目录,供事件回调和跟随决策读取最新值,
  // 避免把它们放进订阅 effect 依赖导致每次变化都重新订阅。在 effect 中同步,不在 render 期间写 ref。
  const expandedRef = useRef<Set<string>>(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const rootPathRef = useRef<string | null>(rootPath);
  useEffect(() => {
    rootPathRef.current = rootPath;
  }, [rootPath]);

  const dirCacheRef = useRef<Map<string, WorkspaceEntry[]>>(dirCache);
  useEffect(() => {
    dirCacheRef.current = dirCache;
  }, [dirCache]);

  // 会话级记忆:离开某根时保存其展开集合,切回时恢复;rootOrder 按最近显示优先排序。
  const rootExpansionMemory = useRef<Map<string, Set<string>>>(new Map());
  const rootOrder = useRef<string[]>([]);

  const loadDir = useCallback(async (path: string): Promise<void> => {
    setLoadingDirs((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    try {
      const result = (await window.inkmark.listDirectory(path)) as DirListResult | null;
      setDirCache((prev) => {
        const next = new Map(prev);
        if (result) {
          next.set(result.path, result.entries);
        } else {
          // 读取失败或目录已删除:清掉缓存,目录行下次渲染会显示为空/可重新展开
          next.delete(path);
        }
        return next;
      });
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, []);

  // 切换根目录:离开旧根时保存其展开状态,记录/提升新根为最近显示,按模式决定展开集合。
  // fresh:只展开根(用于用户显式打开文件夹,或跟随切到一个新文件夹)。
  // restore:恢复该根上次离开时的展开集合(用于跟随切回一个历史根)。
  const switchRoot = useCallback(
    async (path: string, mode: 'fresh' | 'restore'): Promise<void> => {
      const prevRoot = rootPathRef.current;
      if (prevRoot && prevRoot !== path) {
        rootExpansionMemory.current.set(prevRoot, new Set(expandedRef.current));
      }
      rootOrder.current = [path, ...rootOrder.current.filter((r) => r !== path)];
      setRootPath(path);
      setDirCache(new Map());
      const restored = mode === 'restore' ? rootExpansionMemory.current.get(path) : undefined;
      const nextExpanded = restored ?? new Set([path]);
      setExpanded(nextExpanded);
      // 加载需要可见的目录:根一定加载;恢复模式下加载所有已展开目录
      await Promise.all([...nextExpanded].map((d) => loadDir(d)));
    },
    [loadDir],
  );

  // 沿文件所在目录链从根逐级加载并展开,使该文件在树中可见。
  // 这是跟随方案中唯一的异步链,集中在此函数;IPC 接受任意绝对路径,各层可并行加载。
  const revealFileInTree = useCallback(
    async (root: string, filePath: string): Promise<void> => {
      const chain = directoryChainFromRoot(filePath, root);
      if (!chain) return;
      // 仅加载未缓存的目录,已缓存直接复用,避免每次切换标签都重复请求
      await Promise.all(
        chain.map((dir) => (dirCacheRef.current.has(dir) ? Promise.resolve() : loadDir(dir))),
      );
      setExpanded((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const dir of chain) {
          if (!next.has(dir)) {
            next.add(dir);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [loadDir],
  );

  // 用户显式打开文件夹:直接设置根(优先于跟随),使用全新展开状态并记入会话历史。
  const openRoot = useCallback(
    async (path: string): Promise<void> => {
      await switchRoot(path, 'fresh');
    },
    [switchRoot],
  );

  const closeRoot = useCallback((): void => {
    setRootPath(null);
    setDirCache(new Map());
    setExpanded(new Set());
  }, []);

  const toggleExpand = useCallback(
    (path: string): void => {
      const willExpand = !expanded.has(path);
      if (willExpand) {
        setExpanded((prev) => {
          if (prev.has(path)) return prev;
          const next = new Set(prev);
          next.add(path);
          return next;
        });
        // 懒加载:首次展开时请求目录;若缓存里已有(例如刷新后)直接复用。
        // 副作用放在 updater 外,避免在 state reducer 中发起请求。
        if (!dirCache.has(path)) {
          void loadDir(path);
        }
      } else {
        setExpanded((prev) => {
          if (!prev.has(path)) return prev;
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [expanded, dirCache, loadDir],
  );

  const openFolderDialog = useCallback(async (): Promise<boolean> => {
    const result = (await window.inkmark.openFolderDialog()) as { path: string } | null;
    if (!result) return false;
    await openRoot(result.path);
    return true;
  }, [openRoot]);

  // 订阅工作区根目录的实时变化。收到事件时清空缓存并重新加载当前已展开的目录,
  // 保持用户已展开的状态。回调里通过 expandedRef 读取最新展开集合,因此 expanded
  // 无需作为依赖——避免每次展开都重新订阅。根变化时本 effect 自动重新订阅新根。
  useEffect(() => {
    if (!rootPath) return;
    window.inkmark.watchWorkspace(rootPath);
    const unsubscribe = window.inkmark.onWorkspaceWatchEvent(() => {
      setDirCache(new Map());
      for (const path of expandedRef.current) {
        void loadDir(path);
      }
    });
    return () => {
      unsubscribe();
      window.inkmark.unwatchWorkspace();
    };
  }, [rootPath, loadDir]);

  // 文件树跟随活动文档:唯一触发点是活动文档路径变化。
  // 决策为纯函数(见 shared/file-tree-follow),各分支在此执行;不引入额外状态。
  useEffect(() => {
    if (!activeFilePath) return;
    const decision = decideFileTreeFollow(activeFilePath, rootPathRef.current, rootOrder.current);
    switch (decision.type) {
      case 'none':
        return;
      case 'stay':
        void revealFileInTree(rootPathRef.current as string, activeFilePath);
        return;
      case 'restore':
        void switchRoot(decision.root, 'restore').then(() =>
          revealFileInTree(decision.root, activeFilePath),
        );
        return;
      case 'switch':
        void switchRoot(decision.folder, 'fresh').then(() =>
          revealFileInTree(decision.folder, activeFilePath),
        );
        return;
    }
  }, [activeFilePath, switchRoot, revealFileInTree]);

  return {
    rootPath,
    dirCache,
    expanded,
    loadingDirs,
    openRoot,
    closeRoot,
    toggleExpand,
    openFolderDialog,
  };
}
