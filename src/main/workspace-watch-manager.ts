import { type WebContents } from 'electron';
import { watch, type FSWatcher } from 'fs';
import { resolve } from 'path';
import { isPathInside } from '../shared/file-tree-follow';

const WATCH_DEBOUNCE_MS = 200;
const SELF_WRITE_SUPPRESSION_MS = 2_000;

export interface WorkspaceWatchManager {
  subscribe: (webContents: WebContents, directoryPath: string) => void;
  unsubscribe: (webContentsId: number) => void;
  recordSelfWrite: (filePath: string) => void;
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
 * 影响的目录。工作区改动主要来自外部(AI、其他程序或用户在资源管理器里
 * 的操作);但应用自身保存文件时,原子写入(临时文件 + rename)也会触发根
 * 目录事件,若不抑制会被当成外部变更广播,导致文件树整树闪烁。
 *
 * 自身写入抑制由保存路径调用 recordSelfWrite 标记:落在某个被监听工作区
 * 根下的文件写入,会在该根上开一个短期抑制窗口(SELF_WRITE_SUPPRESSION_MS),
 * 窗口内的目录变更不广播。窗口短且仅作用于"文件确实在该根下"的情形,正常
 * 的外部变更不受影响;极罕见的"保存同时外部改同一目录"会被吞一次,由下次
 * 外部变更或标签切换刷新兜底。
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
  // 自身写入抑制:directoryKey → 过期时间。保存路径写入前调 recordSelfWrite,
  // broadcastChange 命中未过期记录则跳过广播,避免自身保存触发文件树刷新。
  private readonly selfWrites = new Map<string, { expiresAt: number }>();

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

  recordSelfWrite(filePath: string): void {
    if (this.watchers.size === 0) return;
    const absoluteFilePath = resolve(filePath);
    const expiresAt = Date.now() + SELF_WRITE_SUPPRESSION_MS;
    for (const watcher of this.watchers.values()) {
      if (isPathInside(absoluteFilePath, watcher.path)) {
        this.selfWrites.set(this.pathKey(watcher.path), { expiresAt });
      }
    }
  }

  close(): void {
    for (const watcher of this.watchers.values()) {
      if (watcher.debounceTimer) clearTimeout(watcher.debounceTimer);
      watcher.watcher.close();
    }
    this.watchers.clear();
    this.trackedWebContents.clear();
    this.selfWrites.clear();
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
    // 自身写入抑制窗口内跳过广播;过期则清理记录,恢复正常监听。
    const selfWrite = this.selfWrites.get(directoryKey);
    if (selfWrite) {
      if (selfWrite.expiresAt >= Date.now()) return;
      this.selfWrites.delete(directoryKey);
    }
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
