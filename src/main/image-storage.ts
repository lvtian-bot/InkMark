import { createHash, randomUUID } from 'crypto';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path';
import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { fileURLToPath } from 'url';
import type {
  DiscardStoredImageRequest,
  DiscardStoredImageResult,
  ResolveImageSourceRequest,
  ResolveImageSourceResult,
  StoreImageRequest,
  StoreImageResult,
} from '../shared/image-storage';

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

interface DetectedImage {
  extension: '.png' | '.jpg' | '.gif' | '.webp' | '.svg';
}

export interface ImageStorage {
  store: (request: StoreImageRequest) => StoreImageResult;
  resolveSource: (request: ResolveImageSourceRequest) => ResolveImageSourceResult;
  copyAssetsForSaveAs: (sourceDocumentPath: string | null, targetDocumentPath: string) => void;
  discard: (request: DiscardStoredImageRequest) => DiscardStoredImageResult;
  getProtocolFilePath: (requestUrl: string) => string | null;
  close: () => void;
}

function detectImage(data: Buffer): DetectedImage | null {
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { extension: '.png' };
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { extension: '.jpg' };
  }
  if (data.length >= 6) {
    const signature = data.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return { extension: '.gif' };
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: '.webp' };
  }

  const textPrefix = data.subarray(0, Math.min(data.length, 4096)).toString('utf8');
  if (/<svg(?:\s|>)/i.test(textPrefix)) return { extension: '.svg' };
  return null;
}

function safeFileStem(fileName: string): string {
  const rawStem = basename(fileName, extname(fileName));
  const sanitized = Array.from(rawStem)
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*#%'.includes(character) ? '-' : character,
    )
    .join('')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, 80);
  return sanitized || 'image';
}

function getDocumentDirectory(documentPath: string | null): string | null {
  if (!documentPath || !isAbsolute(documentPath)) return null;
  if (!/\.(md|markdown|txt)$/i.test(documentPath)) return null;
  return dirname(resolve(documentPath));
}

function errorResult(
  code: Extract<StoreImageResult, { status: 'error' }>['code'],
  message: string,
): StoreImageResult {
  return { status: 'error', code, message };
}

function ensureSafeDirectory(directoryPath: string): void {
  mkdirSync(directoryPath, { recursive: true });
  const stats = lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('附件目录不是安全的本地目录。');
  }
}

function copyDirectoryWithoutOverwrite(sourceDirectory: string, targetDirectory: string): void {
  ensureSafeDirectory(targetDirectory);
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = join(sourceDirectory, entry.name);
    const targetPath = join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryWithoutOverwrite(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) continue;

    const copyResult = copyFileAtomicExclusive(sourcePath, targetPath);
    if (copyResult === 'exists') {
      if (!readFileSync(sourcePath).equals(readFileSync(targetPath))) {
        throw new Error(`附件目录存在同名不同内容的文件：${entry.name}`);
      }
    }
  }
}

function publishTemporaryFile(tempPath: string, targetPath: string): 'written' | 'exists' {
  try {
    linkSync(tempPath, targetPath);
    return 'written';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
    throw error;
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // 临时文件可能尚未创建或已被清理。
    }
  }
}

function writeFileAtomicExclusive(targetPath: string, data: Buffer): 'written' | 'exists' {
  const tempPath = join(dirname(targetPath), `.inkmark-image-${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, data, { flag: 'wx' });
    return publishTemporaryFile(tempPath, targetPath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // 临时文件可能尚未创建。
    }
    throw error;
  }
}

function copyFileAtomicExclusive(sourcePath: string, targetPath: string): 'written' | 'exists' {
  const tempPath = join(dirname(targetPath), `.inkmark-image-${randomUUID()}.tmp`);
  try {
    copyFileSync(sourcePath, tempPath, constants.COPYFILE_EXCL);
    return publishTemporaryFile(tempPath, targetPath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // 临时文件可能尚未创建。
    }
    throw error;
  }
}

export function createImageStorage(): ImageStorage {
  const protocolPaths = new Map<string, string>();

  return {
    store: (request) => {
      if (
        !request ||
        (request.documentPath !== null && typeof request.documentPath !== 'string') ||
        !(request.data instanceof Uint8Array) ||
        typeof request.fileName !== 'string'
      ) {
        return errorResult('invalid-request', '图片请求格式无效。');
      }
      if (!request.documentPath) {
        return errorResult('document-not-saved', '请先保存 Markdown 文档，再插入图片。');
      }
      const documentDirectory = getDocumentDirectory(request.documentPath);
      if (!documentDirectory) {
        return errorResult('invalid-document-path', '当前文档路径无效，无法保存图片。');
      }

      const data = Buffer.from(request.data);
      if (data.length === 0) return errorResult('empty-image', '图片内容为空。');
      if (data.length > MAX_IMAGE_BYTES) {
        return errorResult('image-too-large', '图片超过 50 MB，未保存。');
      }

      const detected = detectImage(data);
      if (!detected) {
        return errorResult('unsupported-image-type', '仅支持 PNG、JPEG、GIF、WebP 和 SVG 图片。');
      }

      const documentName = basename(request.documentPath, extname(request.documentPath));
      const assetsDirectory = join(documentDirectory, `${documentName}.assets`);
      const stem = safeFileStem(request.fileName);

      try {
        ensureSafeDirectory(assetsDirectory);
        for (let index = 0; index < 10_000; index += 1) {
          const suffix = index === 0 ? '' : `-${index}`;
          const targetPath = join(assetsDirectory, `${stem}${suffix}${detected.extension}`);
          try {
            if (writeFileAtomicExclusive(targetPath, data) === 'exists') continue;
            return {
              status: 'ok',
              relativePath: relative(documentDirectory, targetPath).replace(/\\/g, '/'),
            };
          } catch (error) {
            try {
              unlinkSync(targetPath);
            } catch {
              // 写入失败时目标文件可能尚未创建。
            }
            throw error;
          }
        }
      } catch {
        return errorResult('storage-failed', '图片保存失败，请检查目录权限或磁盘空间。');
      }

      return errorResult('storage-failed', '同名图片过多，无法生成可用文件名。');
    },

    resolveSource: (request) => {
      if (
        !request ||
        typeof request.source !== 'string' ||
        (request.documentPath !== null && typeof request.documentPath !== 'string')
      ) {
        return { status: 'error', code: 'invalid-source', message: '图片请求格式无效。' };
      }
      const source = request.source.trim();
      if (!source) return { status: 'error', code: 'invalid-source', message: '图片路径为空。' };
      if (
        /^https?:\/\//i.test(source) ||
        /^data:image\//i.test(source) ||
        source.startsWith('blob:')
      ) {
        return { status: 'ok', url: source };
      }
      if (source.startsWith('//')) return { status: 'ok', url: `https:${source}` };

      const sourceCandidates = [source];
      try {
        const decodedSource = decodeURIComponent(source);
        if (decodedSource !== source) sourceCandidates.push(decodedSource);
      } catch {
        // 文件名可以合法包含单独的 %，优先按原始本地路径继续解析。
      }

      const documentDirectory = getDocumentDirectory(request.documentPath);
      let filePath: string | null = null;
      let hasSupportedExtension = false;
      let needsDocumentPath = false;
      for (const candidate of sourceCandidates) {
        try {
          let candidatePath: string;
          if (candidate.startsWith('file:')) {
            candidatePath = fileURLToPath(candidate);
          } else if (isAbsolute(candidate)) {
            candidatePath = resolve(candidate);
          } else {
            if (!documentDirectory) {
              needsDocumentPath = true;
              continue;
            }
            candidatePath = resolve(documentDirectory, candidate);
          }

          if (!IMAGE_EXTENSIONS.has(extname(candidatePath).toLowerCase())) continue;
          hasSupportedExtension = true;
          if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
            filePath = candidatePath;
            break;
          }
        } catch {
          // 继续尝试原始路径或 URI 解码后的另一个候选路径。
        }
      }

      if (!filePath && needsDocumentPath) {
        return {
          status: 'error',
          code: 'document-not-saved',
          message: '保存文档后才能显示相对路径图片。',
        };
      }
      if (!filePath && !hasSupportedExtension) {
        return { status: 'error', code: 'invalid-source', message: '图片类型不受支持。' };
      }
      if (!filePath) {
        return { status: 'error', code: 'source-not-found', message: '找不到本地图片。' };
      }

      const keyPath = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
      const token = createHash('sha256').update(keyPath).digest('hex');
      protocolPaths.set(token, filePath);
      return { status: 'ok', url: `inkmark-local://image/${token}` };
    },

    copyAssetsForSaveAs: (sourceDocumentPath, targetDocumentPath) => {
      if (!sourceDocumentPath || !isAbsolute(sourceDocumentPath)) return;
      const sourceDirectory = dirname(resolve(sourceDocumentPath));
      const targetDirectory = dirname(resolve(targetDocumentPath));
      if (sourceDirectory === targetDirectory) return;

      const sourceDocumentName = basename(sourceDocumentPath, extname(sourceDocumentPath));
      const sourceAssets = join(sourceDirectory, `${sourceDocumentName}.assets`);
      if (!existsSync(sourceAssets)) return;
      const sourceStats = lstatSync(sourceAssets);
      if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
        throw new Error('源附件目录不是安全的本地目录。');
      }
      copyDirectoryWithoutOverwrite(
        sourceAssets,
        join(targetDirectory, `${sourceDocumentName}.assets`),
      );
    },

    discard: (request) => {
      if (
        !request ||
        typeof request.documentPath !== 'string' ||
        typeof request.relativePath !== 'string'
      ) {
        return { status: 'error', message: '图片清理请求格式无效。' };
      }
      const documentDirectory = getDocumentDirectory(request.documentPath);
      if (!documentDirectory) return { status: 'error', message: '文档路径无效。' };

      const documentName = basename(request.documentPath, extname(request.documentPath));
      const assetsDirectory = resolve(documentDirectory, `${documentName}.assets`);
      try {
        const assetsStats = lstatSync(assetsDirectory);
        if (!assetsStats.isDirectory() || assetsStats.isSymbolicLink()) {
          return { status: 'error', message: '附件目录不是安全的本地目录。' };
        }
      } catch {
        return { status: 'error', message: '附件目录不存在。' };
      }
      const targetPath = resolve(documentDirectory, request.relativePath);
      const pathPrefix = `${assetsDirectory}${process.platform === 'win32' ? '\\' : '/'}`;
      const comparableTarget = process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;
      const comparablePrefix = process.platform === 'win32' ? pathPrefix.toLowerCase() : pathPrefix;
      if (!comparableTarget.startsWith(comparablePrefix)) {
        return { status: 'error', message: '图片清理路径无效。' };
      }

      try {
        unlinkSync(targetPath);
        return { status: 'ok' };
      } catch {
        return { status: 'error', message: '未能清理未插入的图片。' };
      }
    },

    getProtocolFilePath: (requestUrl) => {
      try {
        const url = new URL(requestUrl);
        if (url.protocol !== 'inkmark-local:' || url.hostname !== 'image') return null;
        const token = url.pathname.replace(/^\//, '');
        return /^[a-f0-9]{64}$/.test(token) ? (protocolPaths.get(token) ?? null) : null;
      } catch {
        return null;
      }
    },

    close: () => protocolPaths.clear(),
  };
}
