import { type WebContents } from 'electron';
import { watch, type FSWatcher } from 'fs';
import { resolve } from 'path';

const WATCH_DEBOUNCE_MS = 200;

export interface WorkspaceWatchManager {
  subscribe: (webContents: WebContents, directoryPath: string) => void;
  unsubscribe: (webContentsId: number) => void;
  close: () => void;
}

interface DirectoryWatcher {
  path: string;
  watcher: FSWatcher;
  debounceTimer: NodeJS.Timeout | null;
  subscriberIds: Set<number>;
}

/**
 * 工作区文件树目录监听。
 *
 * 与 FileWatchManager 的单文件监听不同,这里只关心"目录内容是否有变化":
 * 工作区里任何新增/删除/重命名,都广播一次 changed 信号让渲染端重新列受
 * 影响的目录。不区分事件类型,也不做自身写入抑制——文件树是只读浏览,
 * 工作区改动一律来自外部(AI、其他程序或用户在资源管理器里的操作)。
 *
 * 监听对象只覆盖已订阅的工作区根目录本身;子目录的变化依赖根目录收到
 * 事件后刷新可见层,避免递归监听在 Windows 上不稳定且开销大。
 */
class WorkspaceWatchManagerImpl implements WorkspaceWatchManager {
  private readonly watchers = new Map<string, DirectoryWatcher>();
  private readonly trackedWebContents = new Map<
    number,
    { webContents: WebContents; directoryKeys: Set<string> }
  >();

  subscribe(webContents: WebContents, directoryPath: string): void {
    const absolutePath = resolve(directoryPath);
    const directoryKey = this.pathKey(absolutePath);

    let watcher = this.watchers.get(directoryKey);
    if (!watcher) {
      const created = this.createWatcher(absolutePath, directoryKey);
      if (!created) return;
      watcher = created;
    }
    watcher.subscriberIds.add(webContents.id);

    let tracked = this.trackedWebContents.get(webContents.id);
    if (!tracked) {
      tracked = { webContents, directoryKeys: new Set() };
      this.trackedWebContents.set(webContents.id, tracked);
      webContents.once('destroyed', () => this.unsubscribe(webContents.id));
    }
    tracked.directoryKeys.add(directoryKey);
  }

  unsubscribe(webContentsId: number): void {
    const tracked = this.trackedWebContents.get(webContentsId);
    if (!tracked) return;
    for (const directoryKey of tracked.directoryKeys) {
      const watcher = this.watchers.get(directoryKey);
      if (!watcher) continue;
      watcher.subscriberIds.delete(webContentsId);
      if (watcher.subscriberIds.size === 0) {
        if (watcher.debounceTimer) clearTimeout(watcher.debounceTimer);
        watcher.watcher.close();
        this.watchers.delete(directoryKey);
      }
    }
    this.trackedWebContents.delete(webContentsId);
  }

  close(): void {
    for (const watcher of this.watchers.values()) {
      if (watcher.debounceTimer) clearTimeout(watcher.debounceTimer);
      watcher.watcher.close();
    }
    this.watchers.clear();
    this.trackedWebContents.clear();
  }

  private pathKey(directoryPath: string): string {
    const absolutePath = resolve(directoryPath);
    return process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath;
  }

  private createWatcher(absolutePath: string, directoryKey: string): DirectoryWatcher | null {
    try {
      const watcher: DirectoryWatcher = {
        path: absolutePath,
        watcher: watch(absolutePath, () => this.scheduleChange(directoryKey)),
        debounceTimer: null,
        subscriberIds: new Set(),
      };
      watcher.watcher.on('error', () => {
        // OS watcher 失效时静默关闭,渲染端仍可在切换标签/重新打开时重新列目录
        if (watcher.debounceTimer) clearTimeout(watcher.debounceTimer);
        this.watchers.delete(directoryKey);
        try {
          watcher.watcher.close();
        } catch {
          /* already closing */
        }
      });
      this.watchers.set(directoryKey, watcher);
      return watcher;
    } catch {
      return null;
    }
  }

  private scheduleChange(directoryKey: string): void {
    const watcher = this.watchers.get(directoryKey);
    if (!watcher) return;
    if (watcher.debounceTimer) clearTimeout(watcher.debounceTimer);
    watcher.debounceTimer = setTimeout(() => this.broadcastChange(directoryKey), WATCH_DEBOUNCE_MS);
  }

  private broadcastChange(directoryKey: string): void {
    const watcher = this.watchers.get(directoryKey);
    if (!watcher) return;
    watcher.debounceTimer = null;
    for (const subscriberId of watcher.subscriberIds) {
      const tracked = this.trackedWebContents.get(subscriberId);
      if (tracked && !tracked.webContents.isDestroyed()) {
        tracked.webContents.send('workspace:watch-event', { path: watcher.path });
      }
    }
  }
}

export function createWorkspaceWatchManager(): WorkspaceWatchManager {
  return new WorkspaceWatchManagerImpl();
}
