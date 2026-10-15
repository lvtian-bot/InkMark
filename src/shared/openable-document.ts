// 可打开文档的共享判定：扩展名白名单、文档类型（Markdown / 纯文本）与
// 打开文件的大小上限。文件树过滤、文档内链接解析和主进程 file:read 的
// 放行共用这一份清单，三端口径必须一致。

/** Markdown 文档扩展名（小写，含点），支持所见即所得模式。 */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const;

/**
 * 纯文本扩展名（小写，含点）：常见代码、配置与数据文件。
 * 这类文件只在源码模式打开；日志等易超限的扩展名不在清单内。
 */
export const PLAIN_TEXT_EXTENSIONS = [
  '.txt',
  '.csv',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
  '.xml',
  '.svg',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.vue',
  '.svelte',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.cs',
  '.php',
  '.sql',
  '.lua',
  '.dart',
  '.r',
  '.sh',
  '.bash',
  '.bat',
  '.cmd',
  '.ps1',
  '.gradle',
  '.cmake',
] as const;

/** 应用内可打开的全部文档扩展名。 */
export const OPENABLE_DOCUMENT_EXTENSIONS = [
  ...MARKDOWN_EXTENSIONS,
  ...PLAIN_TEXT_EXTENSIONS,
] as const;

/** 文档类型：markdown 支持所见即所得，text 固定源码模式。 */
export type DocumentKind = 'markdown' | 'text';

/** 打开文件的大小上限。超过此值的文件拒绝打开（提示文案与此保持一致：10 MB）。 */
export const MAX_OPEN_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** 判断文件名/路径是否落在可打开文档的扩展名白名单内（大小写不敏感）。 */
export function hasOpenableDocumentExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return OPENABLE_DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isMarkdownDocumentPath(path: string | null): path is string {
  return path !== null && MARKDOWN_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

/**
 * 按文件路径判定文档类型。无路径的标签（新建文档、开始页）按 Markdown 对待。
 * 另存为改变扩展名后，类型随路径自动变化，无需额外迁移。
 */
export function resolveDocumentKind(path: string | null): DocumentKind {
  if (path === null) return 'markdown';
  return isMarkdownDocumentPath(path) ? 'markdown' : 'text';
}
