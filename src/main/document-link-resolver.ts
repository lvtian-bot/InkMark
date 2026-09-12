import { dirname, resolve } from 'path';
import { classifyDocumentLinkHref } from '../shared/document-link';
import type { DocumentLinkResolution } from '../shared/document-link';

export type { DocumentLinkResolution };

/**
 * 以链接所在文档的位置为基准解析目标路径。渲染进程运行在沙箱里没有 Node 的
 * path 模块，相对路径、盘符与反斜杠等平台细节统一交给主进程的 path.resolve。
 * 不在这里检查文件是否存在：读取交给既有的 file:read，由它按统一文案提示丢失。
 */
export function resolveDocumentLink(sourcePath: string, href: string): DocumentLinkResolution {
  const classified = classifyDocumentLinkHref(href);
  if (classified.kind !== 'document') return { status: 'not-document' };
  return { status: 'ok', path: resolve(dirname(sourcePath), classified.path) };
}
