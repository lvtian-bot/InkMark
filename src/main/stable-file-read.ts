import { closeSync, fstatSync, openSync, readFileSync, readSync, statSync } from 'fs';

export interface FileVersion {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

interface StableFileReadIO {
  stat: (filePath: string) => FileVersion;
  /** maxBytes 传入时读取最多 maxBytes + 1 字节，限制竞态下的单次内存占用。 */
  read: (filePath: string, maxBytes?: number) => Buffer;
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
  read: (filePath, maxBytes) => {
    if (maxBytes === undefined) return readFileSync(filePath);
    // 通过同一文件描述符 fstat + 读取：即使路径在此期间被原子替换，
    // 读到的也是同一个 inode 的连续内容，且字节数有硬上限。
    const fd = openSync(filePath, 'r');
    try {
      const size = fstatSync(fd).size;
      const buffer = Buffer.alloc(Math.min(size, maxBytes + 1));
      let read = 0;
      while (read < buffer.length) {
        const n = readSync(fd, buffer, read, buffer.length - read, read);
        if (n <= 0) break;
        read += n;
      }
      return read === buffer.length ? buffer : buffer.subarray(0, read);
    } finally {
      closeSync(fd);
    }
  },
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

/** 文件内容不是合法 UTF-8 时抛出：调用方据此拒绝打开，避免乱码被写回损坏原文件。 */
export class UnsupportedEncodingError extends Error {
  constructor() {
    super('File is not valid UTF-8.');
    this.name = 'UnsupportedEncodingError';
  }
}

/** 文件超过打开大小上限时抛出。 */
export class FileTooLargeError extends Error {
  constructor() {
    super('File exceeds the open size limit.');
    this.name = 'FileTooLargeError';
  }
}

// ignoreBOM: true 表示保留文件头部的 UTF-8 BOM 原样输出（与旧 Buffer.toString
// 行为一致），避免打开再保存悄悄丢掉 BOM，影响依赖它识别编码的 Windows 工具。
const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function decodeUtf8Strict(bytes: Buffer): string | null {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 读取同一个稳定磁盘版本的正文和 mtime。
 *
 * 外部工具可能在 readFile 与 stat 之间原子替换文件。单纯“先读正文、再取
 * mtime”会把旧正文和新 mtime 错配，后续保存冲突检查因此失效。这里在读取
 * 前后核对文件身份与版本；撞上写入就重读，绝不返回拼接出来的伪快照。
 * 正文按严格 UTF-8 解码，字节流不合法（如 GBK 编码的 txt）时抛出
 * UnsupportedEncodingError，绝不返回替换字符拼成的乱码。
 */
export function readStableTextFile(
  filePath: string,
  io: StableFileReadIO = defaultIO,
  maxAttempts = 5,
  maxBytes?: number,
): { content: string; mtime: number } {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = io.stat(filePath);
    // 在读取该版本字节前核对大小上限：预检 stat 与真正读取之间文件可能被
    // 原子替换或追加重写，只有落在稳定校验内的检查才能保证读到的大小有界。
    if (maxBytes !== undefined && before.size > maxBytes) {
      throw new FileTooLargeError();
    }
    const bytes = io.read(filePath, maxBytes);
    const after = io.stat(filePath);
    if (isSameVersion(before, after) && bytes.byteLength === after.size) {
      const content = decodeUtf8Strict(bytes);
      if (content === null) throw new UnsupportedEncodingError();
      return { content, mtime: after.mtimeMs };
    }
  }
  throw new Error('File changed repeatedly while being read.');
}
