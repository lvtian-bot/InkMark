import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../types';

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
 */
export function useFileTree() {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [dirCache, setDirCache] = useState<Map<string, WorkspaceEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  // 用 ref 跟踪当前展开集合,供事件回调读取最新值而无需把它放进订阅 effect 依赖,
  // 避免每次展开变化都重新订阅监听。在 effect 中同步,不在 render 期间写 ref。
  const expandedRef = useRef<Set<string>>(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

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

  // 打开根目录:加载根层并默认展开根
  const openRoot = useCallback(
    async (path: string): Promise<void> => {
      setRootPath(path);
      setDirCache(new Map());
      setExpanded(new Set([path]));
      await loadDir(path);
    },
    [loadDir],
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
  // 无需作为依赖——避免每次展开都重新订阅。
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
