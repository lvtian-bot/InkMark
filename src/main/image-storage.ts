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
  rmdirSync,
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
import type { MessageKey } from '../shared/i18n';
import { rewriteMarkdownImageSources } from './markdown-image-references';

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

interface DetectedImage {
  extension: '.png' | '.jpg' | '.gif' | '.webp' | '.svg';
}

export interface ImageStorage {
  store: (request: StoreImageRequest) => StoreImageResult;
  resolveSource: (request: ResolveImageSourceRequest) => ResolveImageSourceResult;
  copyAssetsForSaveAs: (
    sourceDocumentPath: string | null,
    targetDocumentPath: string,
    content: string,
  ) => string;
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
  t: Translate,
  key: MessageKey,
  params?: Record<string, string | number>,
): StoreImageResult {
  return { status: 'error', code, message: t(key, params) };
}

function ensureSafeDirectory(directoryPath: string): void {
  mkdirSync(directoryPath, { recursive: true });
  const stats = lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('The attachment directory is not a safe local directory.');
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

type ImageCopyError = Error & { code: 'IMAGE_COPY_FAILED' };

interface LocalImageReference {
  source: string;
  filePath: string;
  fileName: string;
}

function imageCopyError(message: string): ImageCopyError {
  return Object.assign(new Error(message), { code: 'IMAGE_COPY_FAILED' as const });
}

function isImageCopyError(error: unknown): error is ImageCopyError {
  return error instanceof Error && 'code' in error && error.code === 'IMAGE_COPY_FAILED';
}

function isRemoteImageSource(source: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(source) || source.startsWith('//');
}

function resolveLocalImagePathForCopy(source: string, documentDirectory: string): string | null {
  const candidates = [source];
  try {
    const decoded = decodeURIComponent(source);
    if (decoded !== source) candidates.push(decoded);
  } catch {
    // 文件名可以合法包含单独的 %，保留原始路径候选即可。
  }

  for (const candidate of candidates) {
    try {
      let candidatePath: string;
      if (candidate.startsWith('file:')) {
        candidatePath = fileURLToPath(candidate);
      } else if (isAbsolute(candidate)) {
        candidatePath = resolve(candidate);
      } else {
        candidatePath = resolve(documentDirectory, candidate);
      }
      if (!IMAGE_EXTENSIONS.has(extname(candidatePath).toLowerCase())) continue;
      if (existsSync(candidatePath)) return candidatePath;
    } catch {
      // 继续尝试原始路径或 URI 解码后的另一个候选路径。
    }
  }
  return null;
}

function validateLocalImageForCopy(filePath: string, t: Translate): void {
  let stats;
  try {
    const linkStats = lstatSync(filePath);
    if (linkStats.isSymbolicLink() || !linkStats.isFile()) {
      throw imageCopyError(t('image.sourceNotFound'));
    }
    stats = statSync(filePath);
  } catch (error) {
    if (isImageCopyError(error)) throw error;
    throw imageCopyError(t('image.sourceNotFound'));
  }
  if (stats.size > MAX_IMAGE_BYTES) throw imageCopyError(t('image.tooLarge'));
}

function targetImageFileName(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  return `${safeFileStem(basename(filePath))}${extension}`;
}

/** 按 URI 逐段编码目标路径，保留 `/` 作为 Markdown 路径分隔符。 */
function encodeMarkdownImagePath(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

export function createImageStorage(options: { t: Translate }): ImageStorage {
  const { t } = options;
  const protocolPaths = new Map<string, string>();

  return {
    store: (request) => {
      if (
        !request ||
        (request.documentPath !== null && typeof request.documentPath !== 'string') ||
        !(request.data instanceof Uint8Array) ||
        typeof request.fileName !== 'string'
      ) {
        return errorResult('invalid-request', t, 'image.invalidRequest');
      }
      if (!request.documentPath) {
        return errorResult('document-not-saved', t, 'image.docNotSaved');
      }
      const documentDirectory = getDocumentDirectory(request.documentPath);
      if (!documentDirectory) {
        return errorResult('invalid-document-path', t, 'image.invalidDocPath');
      }

      const data = Buffer.from(request.data);
      if (data.length === 0) return errorResult('empty-image', t, 'image.empty');
      if (data.length > MAX_IMAGE_BYTES) {
        return errorResult('image-too-large', t, 'image.tooLarge');
      }

      const detected = detectImage(data);
      if (!detected) {
        return errorResult('unsupported-image-type', t, 'image.unsupportedType');
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
        return errorResult('storage-failed', t, 'image.storageFailed');
      }

      return errorResult('storage-failed', t, 'image.nameCollision');
    },

    resolveSource: (request) => {
      if (
        !request ||
        typeof request.source !== 'string' ||
        (request.documentPath !== null && typeof request.documentPath !== 'string')
      ) {
        return { status: 'error', code: 'invalid-source', message: t('image.invalidRequest') };
      }
      const source = request.source.trim();
      if (!source)
        return { status: 'error', code: 'invalid-source', message: t('image.pathEmpty') };
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
          message: t('image.needSavedDoc'),
        };
      }
      if (!filePath && !hasSupportedExtension) {
        return {
          status: 'error',
          code: 'invalid-source',
          message: t('image.unsupportedSourceType'),
        };
      }
      if (!filePath) {
        return { status: 'error', code: 'source-not-found', message: t('image.sourceNotFound') };
      }

      const keyPath = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
      const token = createHash('sha256').update(keyPath).digest('hex');
      protocolPaths.set(token, filePath);
      return { status: 'ok', url: `inkmark-local://image/${token}` };
    },

    copyAssetsForSaveAs: (sourceDocumentPath, targetDocumentPath, content) => {
      if (!sourceDocumentPath || !isAbsolute(sourceDocumentPath)) return content;
      const sourceDirectory = dirname(resolve(sourceDocumentPath));
      const targetDirectory = dirname(resolve(targetDocumentPath));
      if (sourceDirectory === targetDirectory) return content;

      const sources = new Set<string>();
      rewriteMarkdownImageSources(content, (source) => {
        sources.add(source);
        return source;
      });

      const references: LocalImageReference[] = [];
      const referenceByPath = new Map<string, LocalImageReference>();
      const sourceToReference = new Map<string, LocalImageReference>();
      for (const source of sources) {
        if (isRemoteImageSource(source)) continue;
        const filePath = resolveLocalImagePathForCopy(source, sourceDirectory);
        if (!filePath) throw imageCopyError(t('image.sourceNotFound'));
        validateLocalImageForCopy(filePath, t);
        const key = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
        let reference = referenceByPath.get(key);
        if (!reference) {
          reference = { source, filePath, fileName: targetImageFileName(filePath) };
          referenceByPath.set(key, reference);
          references.push(reference);
        }
        sourceToReference.set(source, reference);
      }
      if (references.length === 0) return content;

      const targetDocumentName = basename(targetDocumentPath, extname(targetDocumentPath));
      const targetAssets = join(targetDirectory, `${targetDocumentName}.assets`);
      let targetAssetsCreated = false;
      const createdFiles: string[] = [];
      const copiedPathByReference = new Map<LocalImageReference, string>();
      try {
        if (!existsSync(targetAssets)) targetAssetsCreated = true;
        else {
          const targetStats = lstatSync(targetAssets);
          if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
            throw imageCopyError(t('image.storageFailed'));
          }
        }
        ensureSafeDirectory(targetAssets);
        for (const reference of references) {
          const sourceData = readFileSync(reference.filePath);
          let targetPath: string | null = null;
          const targetBase = basename(reference.fileName, extname(reference.fileName));
          const extension = extname(reference.fileName);
          for (let index = 0; index < 10_000; index += 1) {
            const suffix = index === 0 ? '' : `-${index}`;
            const candidate = join(targetAssets, `${targetBase}${suffix}${extension}`);
            if (existsSync(candidate)) {
              const candidateStats = lstatSync(candidate);
              if (candidateStats.isSymbolicLink() || !candidateStats.isFile()) {
                throw imageCopyError(t('image.storageFailed'));
              }
              if (readFileSync(candidate).equals(sourceData)) {
                targetPath = candidate;
                break;
              }
              continue;
            }
            if (copyFileAtomicExclusive(reference.filePath, candidate) === 'written') {
              createdFiles.push(candidate);
              targetPath = candidate;
              break;
            }
          }
          if (!targetPath) throw imageCopyError(t('image.storageFailed'));
          copiedPathByReference.set(
            reference,
            encodeMarkdownImagePath(relative(targetDirectory, targetPath).replace(/\\/g, '/')),
          );
        }
        return rewriteMarkdownImageSources(content, (source) => {
          const reference = sourceToReference.get(source);
          return reference ? (copiedPathByReference.get(reference) ?? source) : source;
        });
      } catch (error) {
        for (const filePath of createdFiles) {
          try {
            unlinkSync(filePath);
          } catch {
            // 失败清理尽力而为，保留原文件和已有目标文件。
          }
        }
        if (targetAssetsCreated) {
          try {
            rmdirSync(targetAssets);
          } catch {
            // 目录非空或已被并发写入时保留，不能删除其他内容。
          }
        }
        if (isImageCopyError(error)) throw error;
        throw imageCopyError(t('image.storageFailed'));
      }
    },

    discard: (request) => {
      if (
        !request ||
        typeof request.documentPath !== 'string' ||
        typeof request.relativePath !== 'string'
      ) {
        return { status: 'error', message: t('image.invalidRequest') };
      }
      const documentDirectory = getDocumentDirectory(request.documentPath);
      if (!documentDirectory) return { status: 'error', message: t('image.docPathInvalid') };

      const documentName = basename(request.documentPath, extname(request.documentPath));
      const assetsDirectory = resolve(documentDirectory, `${documentName}.assets`);
      try {
        const assetsStats = lstatSync(assetsDirectory);
        if (!assetsStats.isDirectory() || assetsStats.isSymbolicLink()) {
          return { status: 'error', message: t('image.attachmentDirInvalid') };
        }
      } catch {
        return { status: 'error', message: t('image.attachmentDirMissing') };
      }
      const targetPath = resolve(documentDirectory, request.relativePath);
      const pathPrefix = `${assetsDirectory}${process.platform === 'win32' ? '\\' : '/'}`;
      const comparableTarget = process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;
      const comparablePrefix = process.platform === 'win32' ? pathPrefix.toLowerCase() : pathPrefix;
      if (!comparableTarget.startsWith(comparablePrefix)) {
        return { status: 'error', message: t('image.cleanupPathInvalid') };
      }

      try {
        unlinkSync(targetPath);
        return { status: 'ok' };
      } catch {
        return { status: 'error', message: t('image.cleanupFailed') };
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
