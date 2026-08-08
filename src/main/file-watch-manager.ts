import { type WebContents } from 'electron';
import { watch, statSync, type FSWatcher } from 'fs';
import { dirname, join, resolve } from 'path';

const WATCH_DEBOUNCE_MS = 150;
const SELF_WRITE_SUPPRESSION_MS = 2_000;

interface FileWatchEvent {
  path: string;
  status: 'changed' | 'missing';
  mtime?: number;
}

interface FileSubscription {
  path: string;
  directoryKey: string;
  subscribers: Map<number, { webContents: WebContents; count: number }>;
  debounceTimer: NodeJS.Timeout | null;
  missingNotified: boolean;
  selfWrite?: {
    inProgress: boolean;
    mtime?: number;
    expiresAt: number;
  };
}

interface DirectorySubscription {
  path: string;
  watcher: FSWatcher;
  fileKeys: Set<string>;
}

export interface FileWatchManager {
  subscribe: (webContents: WebContents, filePath: string) => void;
  unsubscribe: (webContentsId: number, filePath: string) => void;
  performSelfWrite: (filePath: string, write: () => number) => number;
  close: () => void;
}

class FileWatchManagerImpl implements FileWatchManager {
  private readonly fileSubscriptions = new Map<string, FileSubscription>();
  private readonly directorySubscriptions = new Map<string, DirectorySubscription>();
  private readonly trackedWebContents = new Set<number>();

  subscribe(webContents: WebContents, filePath: string): void {
    const absolutePath = resolve(filePath);
    const fileKey = this.pathKey(absolutePath);
    let subscription = this.fileSubscriptions.get(fileKey);

    if (!subscription) {
      const directoryPath = dirname(absolutePath);
      const directory = this.ensureDirectoryWatcher(directoryPath);
      if (!directory) return;
      subscription = {
        path: absolutePath,
        directoryKey: this.pathKey(directoryPath),
        subscribers: new Map(),
        debounceTimer: null,
        missingNotified: false,
      };
      this.fileSubscriptions.set(fileKey, subscription);
      directory.fileKeys.add(fileKey);
    }

    const existing = subscription.subscribers.get(webContents.id);
    subscription.subscribers.set(webContents.id, {
      webContents,
      count: (existing?.count ?? 0) + 1,
    });

    if (!this.trackedWebContents.has(webContents.id)) {
      this.trackedWebContents.add(webContents.id);
      webContents.once('destroyed', () => this.unsubscribeAllForWebContents(webContents.id));
    }
  }

  unsubscribe(webContentsId: number, filePath: string): void {
    const fileKey = this.pathKey(filePath);
    const subscription = this.fileSubscriptions.get(fileKey);
    if (!subscription) return;

    const existing = subscription.subscribers.get(webContentsId);
    if (!existing) return;
    if (existing.count > 1) {
      existing.count -= 1;
      return;
    }
    subscription.subscribers.delete(webContentsId);
    if (subscription.subscribers.size > 0) return;

    if (subscription.debounceTimer) clearTimeout(subscription.debounceTimer);
    this.fileSubscriptions.delete(fileKey);
    const directory = this.directorySubscriptions.get(subscription.directoryKey);
    if (!directory) return;
    directory.fileKeys.delete(fileKey);
    if (directory.fileKeys.size === 0) {
      directory.watcher.close();
      this.directorySubscriptions.delete(subscription.directoryKey);
    }
  }

  performSelfWrite(filePath: string, write: () => number): number {
    this.beginSelfWrite(filePath);
    try {
      const mtime = write();
      this.finishSelfWrite(filePath, mtime);
      return mtime;
    } catch (error) {
      this.finishSelfWrite(filePath);
      throw error;
    }
  }

  close(): void {
    for (const subscription of this.fileSubscriptions.values()) {
      if (subscription.debounceTimer) clearTimeout(subscription.debounceTimer);
    }
    for (const directory of this.directorySubscriptions.values()) directory.watcher.close();
    this.fileSubscriptions.clear();
    this.directorySubscriptions.clear();
    this.trackedWebContents.clear();
  }

  private pathKey(filePath: string): string {
    const absolutePath = resolve(filePath);
    return process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath;
  }

  private sendFileWatchEvent(subscription: FileSubscription, event: FileWatchEvent): void {
    for (const { webContents } of subscription.subscribers.values()) {
      if (!webContents.isDestroyed()) {
        webContents.send('file:watch-event', event);
      }
    }
  }

  private inspectWatchedFile(fileKey: string): void {
    const subscription = this.fileSubscriptions.get(fileKey);
    if (!subscription) return;

    subscription.debounceTimer = null;
    if (subscription.selfWrite?.inProgress) {
      this.scheduleFileInspection(fileKey);
      return;
    }

    try {
      const mtime = statSync(subscription.path).mtimeMs;
      subscription.missingNotified = false;

      const selfWrite = subscription.selfWrite;
      if (selfWrite?.mtime === mtime && selfWrite.expiresAt >= Date.now()) {
        return;
      }
      if (selfWrite && selfWrite.expiresAt < Date.now()) {
        subscription.selfWrite = undefined;
      }

      this.sendFileWatchEvent(subscription, {
        path: subscription.path,
        status: 'changed',
        mtime,
      });
    } catch {
      if (subscription.missingNotified) return;
      subscription.missingNotified = true;
      this.sendFileWatchEvent(subscription, { path: subscription.path, status: 'missing' });
    }
  }

  private scheduleFileInspection(fileKey: string): void {
    const subscription = this.fileSubscriptions.get(fileKey);
    if (!subscription) return;
    if (subscription.debounceTimer) clearTimeout(subscription.debounceTimer);
    subscription.debounceTimer = setTimeout(
      () => this.inspectWatchedFile(fileKey),
      WATCH_DEBOUNCE_MS,
    );
  }

  private ensureDirectoryWatcher(directoryPath: string): DirectorySubscription | null {
    const directoryKey = this.pathKey(directoryPath);
    const existing = this.directorySubscriptions.get(directoryKey);
    if (existing) return existing;

    try {
      const directory: DirectorySubscription = {
        path: directoryPath,
        watcher: watch(directoryPath, (_eventType, filename) => {
          const current = this.directorySubscriptions.get(directoryKey);
          if (!current) return;

          if (filename == null) {
            for (const fileKey of current.fileKeys) this.scheduleFileInspection(fileKey);
            return;
          }

          const changedKey = this.pathKey(join(current.path, filename.toString()));
          if (current.fileKeys.has(changedKey)) this.scheduleFileInspection(changedKey);
        }),
        fileKeys: new Set(),
      };
      directory.watcher.on('error', () => {
        // focus/visibility mtime checks remain the fallback if an OS watcher fails
        directory.watcher.close();
        this.directorySubscriptions.delete(directoryKey);
      });
      this.directorySubscriptions.set(directoryKey, directory);
      return directory;
    } catch {
      return null;
    }
  }

  private unsubscribeAllForWebContents(webContentsId: number): void {
    for (const subscription of [...this.fileSubscriptions.values()]) {
      const subscriber = subscription.subscribers.get(webContentsId);
      if (!subscriber) continue;
      subscriber.count = 1;
      this.unsubscribe(webContentsId, subscription.path);
    }
    this.trackedWebContents.delete(webContentsId);
  }

  private beginSelfWrite(filePath: string): void {
    const subscription = this.fileSubscriptions.get(this.pathKey(filePath));
    if (!subscription) return;
    subscription.selfWrite = {
      inProgress: true,
      expiresAt: Date.now() + SELF_WRITE_SUPPRESSION_MS,
    };
  }

  private finishSelfWrite(filePath: string, mtime?: number): void {
    const subscription = this.fileSubscriptions.get(this.pathKey(filePath));
    if (!subscription) return;
    if (mtime == null) {
      subscription.selfWrite = undefined;
      return;
    }
    subscription.selfWrite = {
      inProgress: false,
      mtime,
      expiresAt: Date.now() + SELF_WRITE_SUPPRESSION_MS,
    };
  }
}

export function createFileWatchManager(): FileWatchManager {
  return new FileWatchManagerImpl();
}
