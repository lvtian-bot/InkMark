import { closeSync, fstatSync, openSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { readStableTextFile } from './stable-file-read';

export interface ReviewedFileSaveRequest {
  content: string;
  path: string;
  expectedContent: string;
  expectedMtime: number;
}

type SaveResult = { status: 'ok'; mtime: number } | { status: 'conflict' };

/** 审阅只授权覆盖进入时的版本；读取失败或正文/时间不符均保留磁盘原件。 */
export function saveReviewedFileVersion(
  request: ReviewedFileSaveRequest,
  write: () => number,
  read: typeof readStableTextFile = readStableTextFile,
): SaveResult {
  let current: ReturnType<typeof readStableTextFile>;
  try {
    current = read(request.path);
  } catch {
    return { status: 'conflict' };
  }
  if (current.content !== request.expectedContent || current.mtime !== request.expectedMtime) {
    return { status: 'conflict' };
  }
  return { status: 'ok', mtime: write() };
}

/** 排他创建新文件；即使对话框确认过同名覆盖，也绝不打开现有文件写入。 */
export function writeNewReviewCopy(filePath: string, content: string, sourcePath: string): number {
  const pathKey = (path: string): string => {
    const absolute = resolve(path);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  };
  // 原件可能已被外部删除；另存副本也不能借此重建原路径。
  if (pathKey(filePath) === pathKey(sourcePath)) {
    throw Object.assign(new Error('Choose a new file name for the reviewed copy.'), {
      code: 'EEXIST',
    });
  }
  const descriptor = openSync(filePath, 'wx');
  try {
    writeFileSync(descriptor, content, 'utf-8');
    return fstatSync(descriptor).mtimeMs;
  } finally {
    closeSync(descriptor);
  }
}
