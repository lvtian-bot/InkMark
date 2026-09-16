// 导出文档的 Markdown → HTML 渲染（无 Electron 依赖，可独立测试）。
//
// 与编辑器同源的解析语义：commonmark + GFM（表格、删除线、任务列表、自动链接）
// + 文档开头 frontmatter（编辑器把它渲染为可见的 YAML 块，导出时保留为代码块）。
// 原始 HTML 片段与编辑器一致地按字面文本显示（不执行，导出文件也不会引入脚本）。
//
// 图片处理：http(s)/data/blob 引用原样保留；本地图片（相对源文档目录、绝对路径
// 或 file: URL）在 standalone 目标下内嵌为 base64（单文件可携带），在 print
// 目标（PDF 打印窗口）下改写为 file:// URL。

import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, extname, isAbsolute, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype, { type Options as RemarkRehypeOptions } from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import githubMarkdownCss from 'github-markdown-css/github-markdown-light.css?raw';
import { transformBreaksInTree } from '../shared/markdown-breaks';
import type { Root } from 'mdast';

export type ExportTarget = 'standalone' | 'print';

export interface RenderExportOptions {
  markdown: string;
  title: string;
  sourcePath: string | null;
  target: ExportTarget;
}

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

interface MdastParent {
  children?: MdastNode[];
}

interface MdastNode extends MdastParent {
  type: string;
  url?: string;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** 编辑器 resolveSource 的同源规则：把图片引用解析为存在的本地文件绝对路径。 */
function resolveLocalImagePath(source: string, documentDirectory: string | null): string | null {
  const trimmed = source.trim();
  if (trimmed === '') return null;
  if (/^(https?|data|blob):/i.test(trimmed)) return null;
  if (trimmed.startsWith('//')) return null;

  const candidates = [trimmed];
  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded !== trimmed) candidates.push(decoded);
  } catch {
    // 文件名可以合法包含单独的 %，保留原始路径候选即可。
  }

  for (const candidate of candidates) {
    let candidatePath: string;
    try {
      if (candidate.startsWith('file:')) {
        candidatePath = fileURLToPath(candidate);
      } else if (isAbsolute(candidate)) {
        candidatePath = resolve(candidate);
      } else {
        if (documentDirectory === null) continue;
        candidatePath = resolve(documentDirectory, candidate);
      }
    } catch {
      continue;
    }
    const extension = extname(candidatePath).toLowerCase();
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) continue;
    try {
      if (existsSync(candidatePath) && statSync(candidatePath).isFile()) return candidatePath;
    } catch {
      // 文件不存在或不可读：换下一个候选。
    }
  }
  return null;
}

function rewriteLocalImages(tree: Root, options: RenderExportOptions): void {
  const documentDirectory =
    options.sourcePath !== null && isAbsolute(options.sourcePath)
      ? dirname(options.sourcePath)
      : null;

  const visit = (parent: MdastParent): void => {
    if (!parent.children) return;
    for (let index = 0; index < parent.children.length; index += 1) {
      const node: MdastNode = parent.children[index];
      if (node.type === 'image' && typeof node.url === 'string') {
        const source = node.url.trim();
        let replacement: string | null = null;

        if (source.startsWith('file:')) {
          if (options.target === 'standalone') {
            const localPath = resolveLocalImagePath(source, documentDirectory);
            if (localPath) replacement = readLocalImageAsDataUrl(localPath);
          } else {
            // print 目标由隐藏窗口以 file:// 打开，file: 引用可直接加载。
            replacement = source;
          }
        } else {
          const localPath = resolveLocalImagePath(source, documentDirectory);
          if (localPath) {
            replacement =
              options.target === 'standalone'
                ? readLocalImageAsDataUrl(localPath)
                : pathToFileURL(localPath).href;
          }
        }
        if (replacement !== null) node.url = replacement;
        continue;
      }
      if (node.children) visit(node);
    }
  };
  visit(tree);
}

function readLocalImageAsDataUrl(localPath: string): string | null {
  const mime = IMAGE_MIME_BY_EXTENSION[extname(localPath).toLowerCase()];
  if (!mime) return null;
  try {
    const data = readFileSync(localPath);
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * 渲染 Markdown 正文为 HTML 片段（不含文档外壳）。
 * 换行语义与编辑器一致：先用统一的树变换把段内裸换行提升为 break 节点，
 * 渲染为 <br>（宽松换行）。
 */
export async function renderExportBodyHtml(options: RenderExportOptions): Promise<string> {
  const rehypeHandlers: RemarkRehypeOptions['handlers'] = {
    break: () => ({ type: 'element', tagName: 'br', properties: {}, children: [] }),
    // 编辑器不执行原始 HTML，导出同样按字面文本显示（自动转义，无脚本注入）。
    html: (_state, node) =>
      node.type === 'html' ? { type: 'text', value: node.value } : undefined,
    // frontmatter 保留为可见的 YAML 代码块，与编辑器渲染一致。
    yaml: (_state, node) => {
      if (node.type !== 'yaml') return undefined;
      return {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: ['language-yaml'] },
            children: [{ type: 'text', value: node.value }],
          },
        ],
      };
    },
  };

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, 'yaml')
    .use(() => (tree: Root) => {
      transformBreaksInTree(tree);
      rewriteLocalImages(tree, options);
    })
    .use(remarkRehype, { handlers: rehypeHandlers })
    .use(rehypeStringify);

  const file = await processor.process(options.markdown);
  return String(file);
}

/** 打印场景的分页保护：标题不与正文拆开，表格/代码块/引用尽量不跨页。 */
const PRINT_BREAK_CSS = `
@media print {
  h1, h2, h3, h4, h5, h6 { break-after: avoid; break-inside: avoid; }
  pre, blockquote, table, img, hr { break-inside: avoid; }
}
`;

const SHARED_OVERRIDE_CSS = `
body { margin: 0; background: #ffffff; }
.markdown-body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei",
    "PingFang SC", "Noto Sans CJK SC", sans-serif;
}
`;

function buildExportStylesheet(target: ExportTarget): string {
  if (target === 'print') {
    // 页边距由 printToPDF 的 margins 提供，正文不再叠加内边距。
    return `${githubMarkdownCss}\n${SHARED_OVERRIDE_CSS}\n.markdown-body { max-width: none; padding: 0; }\n${PRINT_BREAK_CSS}`;
  }
  return `${githubMarkdownCss}\n${SHARED_OVERRIDE_CSS}\n.markdown-body { max-width: 880px; margin: 0 auto; padding: 40px 48px; box-sizing: border-box; }\n${PRINT_BREAK_CSS}`;
}

/** 渲染完整导出文档：standalone 用于落盘的 .html，print 用于 PDF 打印窗口。 */
export async function renderExportDocument(options: RenderExportOptions): Promise<string> {
  const bodyHtml = await renderExportBodyHtml(options);
  const title = escapeHtmlAttribute(options.title);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${buildExportStylesheet(options.target)}
</style>
</head>
<body>
<article class="markdown-body">
${bodyHtml}
</article>
</body>
</html>
`;
}
