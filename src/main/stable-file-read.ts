import { readFileSync, statSync } from 'fs';

export interface FileVersion {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

interface StableFileReadIO {
  stat: (filePath: string) => FileVersion;
  read: (filePath: string) => Buffer;
}

const defaultIO: StableFileReadIO = {
  stat: (filePath) => {
    const stat = statSync(filePath);
    return {
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
    };
  },
  read: (filePath) => readFileSync(filePath),
};

function isSameVersion(before: FileVersion, after: FileVersion): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

/**
 * 读取同一个稳定磁盘版本的正文和 mtime。
 *
 * 外部工具可能在 readFile 与 stat 之间原子替换文件。单纯“先读正文、再取
 * mtime”会把旧正文和新 mtime 错配，后续保存冲突检查因此失效。这里在读取
 * 前后核对文件身份与版本；撞上写入就重读，绝不返回拼接出来的伪快照。
 */
export function readStableTextFile(
  filePath: string,
  io: StableFileReadIO = defaultIO,
  maxAttempts = 5,
): { content: string; mtime: number } {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = io.stat(filePath);
    const bytes = io.read(filePath);
    const after = io.stat(filePath);
    if (isSameVersion(before, after) && bytes.byteLength === after.size) {
      return { content: bytes.toString('utf-8'), mtime: after.mtimeMs };
    }
  }
  throw new Error('File changed repeatedly while being read.');
}
