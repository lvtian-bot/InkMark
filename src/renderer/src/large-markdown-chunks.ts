import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype, { defaultHandlers, type Options as RemarkRehypeOptions } from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import type { Heading as MdastHeading, Image as MdastImage, Root } from 'mdast';
import { transformBreaksInTree } from '../../shared/markdown-breaks';
import { transformCellBrInTree } from './plugins/table-cell-breaks';
import type { Heading } from './types';

export interface LargeMarkdownChunk {
  id: number;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  markdown: string;
  estimatedHeight: number;
  headingPositions: number[];
}

export interface LargeMarkdownDocument {
  chunks: LargeMarkdownChunk[];
  headings: Heading[];
  headingToChunk: Map<number, number>;
  referenceDefs: string;
}

const DEFAULT_TARGET_LINES = 80;
const DEFAULT_MAX_LINES = 120;
const PIXELS_PER_LINE_ESTIMATE = 28;
const MIN_CHUNK_HEIGHT = 48;

const ATX_HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/;
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const TABLE_SEPARATOR_RE =
  /^ {0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$|^ {0,3}\|\s*:?-+:?\s*\|?\s*$/;
const TOP_LEVEL_LIST_RE = /^(?:[-*+]|\d{1,9}[.)])[ \t]/;
const BLOCKQUOTE_OR_HR_RE = /^ {0,3}(?:>|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/;
const REF_DEF_RE = /^ {0,3}\[((?:[^\]\\]|\\.)+)\]:[ \t]*\S/;
const STANDALONE_TITLE_RE = /^[ \t]*(?:"[^"]*"|'[^']*'|\([^)]*\))[ \t]*$/;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function stripInlineMarkdown(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|~~|\*|_)/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
    .trim();
}

function isClosingFence(line: string, fenceChar: string, fenceLen: number): boolean {
  let i = 0;
  let spaces = 0;
  while (i < line.length && line[i] === ' ' && spaces < 4) {
    i += 1;
    spaces += 1;
  }
  if (spaces >= 4) return false;
  let count = 0;
  while (i < line.length && line[i] === fenceChar) {
    count += 1;
    i += 1;
  }
  if (count < fenceLen) return false;
  while (i < line.length) {
    if (line[i] !== ' ' && line[i] !== '\t') return false;
    i += 1;
  }
  return true;
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function scanFrontmatterEndLine(lines: string[]): number {
  if (lines.length < 2) return -1;
  if (!/^---[ \t]*$/.test(lines[0])) return -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i])) {
      return i;
    }
  }
  return -1;
}

function looksLikeTableRow(line: string): boolean {
  return line.includes('|');
}

/**
 * 在单一线性扫描中将大 Markdown 切分为保持块级语义完整的片段，
 * 同时提取标题大纲（pos 为全文字符偏移）与跨片段链接引用定义。
 */
export function splitMarkdownForReader(
  markdown: string,
  targetLines = DEFAULT_TARGET_LINES,
  maxLines = DEFAULT_MAX_LINES,
): LargeMarkdownDocument {
  if (markdown.length === 0) {
    return {
      chunks: [
        {
          id: 0,
          startLine: 0,
          endLine: 0,
          startOffset: 0,
          endOffset: 0,
          markdown: '',
          estimatedHeight: MIN_CHUNK_HEIGHT,
          headingPositions: [],
        },
      ],
      headings: [],
      headingToChunk: new Map(),
      referenceDefs: '',
    };
  }

  const lines: string[] = [];
  const lineStarts: number[] = [];
  const lineNextStarts: number[] = [];

  let cursor = 0;
  const totalLen = markdown.length;
  while (cursor < totalLen) {
    const nl = markdown.indexOf('\n', cursor);
    const lineEnd = nl === -1 ? totalLen : nl;
    const contentEnd = lineEnd > cursor && markdown[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    lines.push(markdown.slice(cursor, contentEnd));
    lineStarts.push(cursor);
    const nextStart = nl === -1 ? totalLen : nl + 1;
    lineNextStarts.push(nextStart);
    cursor = nextStart;
  }

  const frontmatterEndLine = scanFrontmatterEndLine(lines);
  const chunks: LargeMarkdownChunk[] = [];
  const headings: Heading[] = [];
  const headingToChunk = new Map<number, number>();
  const slugCount = new Map<string, number>();
  const usedIds = new Set<string>();
  const refDefLines: string[] = [];
  const seenRefLabels = new Set<string>();

  const registerHeading = (level: number, rawText: string, pos: number, chunkId: number): void => {
    const text = stripInlineMarkdown(rawText);
    const base = slugify(text) || `heading-${pos}`;
    let dup = slugCount.get(base) ?? 0;
    let id = dup === 0 ? base : `${base}-${dup}`;
    while (usedIds.has(id)) {
      dup += 1;
      id = `${base}-${dup}`;
    }
    slugCount.set(base, dup + 1);
    usedIds.add(id);
    headings.push({ id, level, text, pos });
    headingToChunk.set(pos, chunkId);
  };

  let chunkStartLine = 0;
  let currentHeadingPositions: number[] = [];
  let fenceChar = '';
  let fenceLen = 0;
  let inTable = false;
  let prevLineCanBeSetext = false;

  const flushChunk = (endLineInclusive: number): void => {
    const id = chunks.length;
    const startOffset = lineStarts[chunkStartLine];
    const endOffset = lineNextStarts[endLineInclusive];
    const lineCount = endLineInclusive - chunkStartLine + 1;
    chunks.push({
      id,
      startLine: chunkStartLine,
      endLine: endLineInclusive,
      startOffset,
      endOffset,
      markdown: markdown.slice(startOffset, endOffset),
      estimatedHeight: Math.max(MIN_CHUNK_HEIGHT, lineCount * PIXELS_PER_LINE_ESTIMATE),
      headingPositions: currentHeadingPositions,
    });
    chunkStartLine = endLineInclusive + 1;
    currentHeadingPositions = [];
  };

  const lineCount = lines.length;
  for (let i = 0; i < lineCount; i++) {
    const line = lines[i];
    const inFrontmatter = frontmatterEndLine >= 0 && i <= frontmatterEndLine;
    const chunkId = chunks.length;

    if (inFrontmatter) {
      prevLineCanBeSetext = false;
      inTable = false;
      // 前置 YAML 块禁止拆开，只在最后一行完成后考虑切分。
      if (i === frontmatterEndLine && i - chunkStartLine + 1 >= maxLines && i + 1 < lineCount) {
        flushChunk(i);
      }
      continue;
    }

    if (fenceChar !== '') {
      if (isClosingFence(line, fenceChar, fenceLen)) {
        fenceChar = '';
        fenceLen = 0;
      }
      prevLineCanBeSetext = false;
      inTable = false;
      if (fenceChar === '' && i - chunkStartLine + 1 >= targetLines && i + 1 < lineCount) {
        const nextLine = lines[i + 1];
        if (isBlankLine(nextLine) || ATX_HEADING_RE.test(nextLine)) {
          flushChunk(i);
        }
      }
      continue;
    }

    const fenceMatch = FENCE_OPEN_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const info = fenceMatch[2];
      if (marker[0] !== '`' || !info.includes('`')) {
        fenceChar = marker[0];
        fenceLen = marker.length;
        prevLineCanBeSetext = false;
        inTable = false;
        continue;
      }
    }

    // 表格状态追踪：标题行 + 分隔行启动表格，直到空行、代码块、标题或无管道字符行结束。
    if (
      !inTable &&
      i + 1 < lineCount &&
      looksLikeTableRow(line) &&
      TABLE_SEPARATOR_RE.test(lines[i + 1])
    ) {
      inTable = true;
    } else if (inTable) {
      if (isBlankLine(line) || ATX_HEADING_RE.test(line) || !looksLikeTableRow(line)) {
        inTable = false;
      }
    }

    // 标题提取（ATX 或两行 Setext）
    const atxMatch = ATX_HEADING_RE.exec(line);
    if (atxMatch) {
      const level = atxMatch[1].length;
      const rawBody = (atxMatch[2] ?? '').replace(/[ \t]+#*[ \t]*$/, '').trim();
      const pos = lineStarts[i];
      currentHeadingPositions.push(pos);
      registerHeading(level, rawBody, pos, chunkId);
      prevLineCanBeSetext = false;
    } else {
      const nextLine = i + 1 < lineCount ? lines[i + 1] : null;
      const setextNextMatch =
        nextLine !== null && !inTable && !isBlankLine(line) && prevLineCanBeSetext !== null
          ? SETEXT_UNDERLINE_RE.exec(nextLine)
          : null;
      const isPlainCandidate =
        !inTable &&
        !isBlankLine(line) &&
        !TOP_LEVEL_LIST_RE.test(line.trimStart()) &&
        !BLOCKQUOTE_OR_HR_RE.test(line) &&
        !REF_DEF_RE.test(line);

      if (isPlainCandidate && setextNextMatch) {
        const level = setextNextMatch[1][0] === '=' ? 1 : 2;
        const pos = lineStarts[i];
        currentHeadingPositions.push(pos);
        registerHeading(level, line.trim(), pos, chunkId);
        // 下划线行留在同一个 chunk 内
        prevLineCanBeSetext = false;
        continue;
      }
      prevLineCanBeSetext = isPlainCandidate;
    }

    // 收集引用式链接定义，确保跨片段也能正常解析。
    const refMatch = REF_DEF_RE.exec(line);
    if (refMatch) {
      const labelKey = refMatch[1].trim().toLowerCase().replace(/\s+/g, ' ');
      if (!seenRefLabels.has(labelKey)) {
        seenRefLabels.add(labelKey);
        refDefLines.push(line);
        if (i + 1 < lineCount && STANDALONE_TITLE_RE.test(lines[i + 1])) {
          refDefLines.push(lines[i + 1]);
        }
      }
    }

    // 决定是否在当前行后切分
    if (i + 1 >= lineCount) continue;
    const countInChunk = i - chunkStartLine + 1;
    if (countInChunk < targetLines) continue;

    // 不在块级元素内部切分
    if (inTable) {
      if (countInChunk < maxLines * 3) continue;
    }

    const nextLine = lines[i + 1];
    const isNextSetextUnderline = prevLineCanBeSetext && SETEXT_UNDERLINE_RE.test(nextLine);
    if (isNextSetextUnderline) continue;

    const atSafeGap = isBlankLine(line) || isBlankLine(nextLine) || ATX_HEADING_RE.test(nextLine);
    if (atSafeGap) {
      flushChunk(i);
      continue;
    }

    if (countInChunk >= maxLines) {
      const atListOrBlockBoundary =
        TOP_LEVEL_LIST_RE.test(nextLine) || BLOCKQUOTE_OR_HR_RE.test(nextLine);
      if (atListOrBlockBoundary || countInChunk >= maxLines * 3) {
        flushChunk(i);
      }
    }
  }

  if (chunkStartLine < lineCount) {
    flushChunk(lineCount - 1);
  }

  return {
    chunks,
    headings,
    headingToChunk,
    referenceDefs: refDefLines.join('\n'),
  };
}

interface ActiveRenderContext {
  chunkStartOffset: number;
  headingSet: Set<number>;
}

let activeRenderContext: ActiveRenderContext | null = null;

function resolveHeadingDocPos(node: MdastHeading): number | null {
  if (!activeRenderContext) return null;
  const relOffset = node.position?.start?.offset;
  if (typeof relOffset !== 'number') return null;
  const candidate = activeRenderContext.chunkStartOffset + relOffset;
  if (activeRenderContext.headingSet.has(candidate)) return candidate;
  // 行首可能有 0..3 个前导空格，行偏移落在 [candidate - 3, candidate]
  for (let delta = 1; delta <= 3; delta++) {
    if (activeRenderContext.headingSet.has(candidate - delta)) {
      return candidate - delta;
    }
  }
  return null;
}

const chunkHandlers: RemarkRehypeOptions['handlers'] = {
  break: () => ({ type: 'element', tagName: 'br', properties: {}, children: [] }),
  // 安全约束：大文档只读视图不执行原始 HTML，按纯文本转义展示，与 Milkdown / 导出对齐。
  html: (_state, node) => (node.type === 'html' ? { type: 'text', value: node.value } : undefined),
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
  heading: (state, node) => {
    const headingNode = node as MdastHeading;
    const result = defaultHandlers.heading(state, headingNode);
    const pos = resolveHeadingDocPos(headingNode);
    if (pos !== null) {
      result.properties = {
        ...result.properties,
        dataHeadingPos: String(pos),
      };
    }
    return result;
  },
  image: (_state, node) => {
    const imageNode = node as MdastImage;
    const properties: Record<string, string> = {
      dataInkmarkSrc: imageNode.url ?? '',
      alt: imageNode.alt ?? '',
    };
    if (imageNode.title) {
      properties.title = imageNode.title;
    }
    return {
      type: 'element',
      tagName: 'img',
      properties,
      children: [],
    };
  },
};

function createChunkProcessor(withFrontmatter: boolean) {
  const base = unified().use(remarkParse).use(remarkGfm);
  const withFm = withFrontmatter ? base.use(remarkFrontmatter, 'yaml') : base;
  return withFm
    .use(() => (tree: Root) => {
      transformCellBrInTree(tree);
      transformBreaksInTree(tree);
    })
    .use(remarkRehype, { handlers: chunkHandlers })
    .use(rehypeStringify);
}

const processorChunkZero = createChunkProcessor(true);
const processorChunkBody = createChunkProcessor(false);

/**
 * 将单个片段同步渲染为安全 HTML 片段。
 * - chunk 0 启用 YAML frontmatter 解析，其余片段关闭，避免主题分隔线 `---` 误判为 frontmatter。
 * - 图片 `src` 暂存为 `data-inkmark-src`，由挂载后统一解析本地/远程路径。
 */
export function renderMarkdownChunkToHtml(
  chunk: LargeMarkdownChunk,
  referenceDefs: string,
): string {
  const input = referenceDefs.length > 0 ? `${chunk.markdown}\n\n${referenceDefs}` : chunk.markdown;
  const processor = chunk.id === 0 ? processorChunkZero : processorChunkBody;
  activeRenderContext = {
    chunkStartOffset: chunk.startOffset,
    headingSet: new Set(chunk.headingPositions),
  };
  try {
    return String(processor.processSync(input));
  } finally {
    activeRenderContext = null;
  }
}
