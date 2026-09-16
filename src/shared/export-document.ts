// 导出文档（HTML / PDF）的跨进程契约与纯逻辑：请求、结果、请求校验和
// 导出文件名清洗。主进程负责参数校验与落盘，渲染进程只提交文档内容与元信息。

export type ExportKind = 'html' | 'pdf';

export interface ExportDocumentRequest {
  kind: ExportKind;
  /** 标签页 sourceContent（单一真源），由渲染进程原样提交。 */
  markdown: string;
  /** 导出文件与 <title> 的默认名（标签页显示名，可能带 .md 等扩展名）。 */
  title: string;
  /** 源文档绝对路径；未落盘的新文档为 null（相对图片无法解析，保持原样）。 */
  sourcePath: string | null;
}

export type ExportDocumentResult =
  { status: 'ok'; path: string } | { status: 'canceled' } | { status: 'error'; message: string };

export function isExportDocumentRequest(value: unknown): value is ExportDocumentRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    (request.kind === 'html' || request.kind === 'pdf') &&
    typeof request.markdown === 'string' &&
    typeof request.title === 'string' &&
    (request.sourcePath === null ||
      (typeof request.sourcePath === 'string' && request.sourcePath.length > 0))
  );
}

/**
 * 清洗导出文件名：去掉 Markdown/TXT 扩展名后，替换文件系统非法字符
 * （与 image-storage 的附件命名同一规则），超出长度截断，空名回落 "document"。
 */
export function sanitizeExportFileName(title: string): string {
  const stem = title.replace(/\.(md|markdown|txt)$/i, '');
  const sanitized = Array.from(stem)
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*#%'.includes(character) ? '-' : character,
    )
    .join('')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, 80);
  return sanitized || 'document';
}
