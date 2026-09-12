/**
 * Markdown 文档内链接的分类与解析：主进程用它校验与解析跳转目标，
 * 渲染进程用它决定点击后的行为，两侧共用同一份判定逻辑。
 */

/** 应用内可打开的文档扩展名，与主进程 file:read 的白名单一致。 */
export const DOCUMENT_EXTENSION_PATTERN = /\.(md|markdown|txt)$/i;

/** 外部链接白名单，与主进程 will-navigate 放行的协议一致。 */
const EXTERNAL_URL_PATTERN = /^(https?:|mailto:)/i;

/**
 * 带「协议头」的地址（file:、javascript:、inkmark-local: 等）。协议名至少两个
 * 字符，避免把 Windows 盘符前缀（`C:\`）误判成协议；这类地址一律不处理，
 * 不论扩展名看起来像什么。
 */
const NON_PATH_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]+:/;

/** 主进程对文档链接解析请求的答复。 */
export type DocumentLinkResolution = { status: 'ok'; path: string } | { status: 'not-document' };

export type DocumentLinkHref =
  | { kind: 'external'; url: string }
  | { kind: 'document'; path: string; hash: string }
  | { kind: 'none' };

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    // 畸形百分号编码（如 `%zz`）按原样处理，让后续扩展名判定自然淘汰。
    return href;
  }
}

/**
 * 把链接 href 分类：
 * - external：http/https/mailto，交给系统默认处理；
 * - document：指向本地文档（相对或绝对路径），去掉原始 `#` 锚点后做百分号解码，
 *   锚点当前不参与跳转、仅保留在结果里；
 * - none：纯页内锚点、file:// 等其他协议、非文档类本地文件，维持点击前的行为。
 */
export function classifyDocumentLinkHref(href: string): DocumentLinkHref {
  const trimmed = href.trim();
  if (trimmed === '') return { kind: 'none' };
  if (EXTERNAL_URL_PATTERN.test(trimmed)) return { kind: 'external', url: trimmed };
  if (NON_PATH_SCHEME_PATTERN.test(trimmed)) return { kind: 'none' };

  const hashIndex = trimmed.indexOf('#');
  const rawPath = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : trimmed.slice(hashIndex + 1);
  const decoded = decodeHref(rawPath);
  if (decoded === '') return { kind: 'none' };
  if (!DOCUMENT_EXTENSION_PATTERN.test(decoded)) return { kind: 'none' };
  return { kind: 'document', path: decoded, hash };
}
