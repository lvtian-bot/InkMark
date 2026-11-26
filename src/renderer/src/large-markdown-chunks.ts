import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype, { defaultHandlers, type Options as RemarkRehypeOptions } from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import type {
  Heading as MdastHeading,
  Image as MdastImage,
  ImageReference as MdastImageReference,
  Parent,
  Root,
} from 'mdast';
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
  continuedOrderedListStart?: number;
  frontmatterEndOffset?: number;
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
const INDENTED_FENCE_OPEN_RE = /^[ \t]+(`{3,}|~{3,})(.*)$/;
const TABLE_SEPARATOR_RE =
  /^ {0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$|^ {0,3}\|\s*:?-+:?\s*\|?\s*$/;
const TOP_LEVEL_LIST_RE = /^(?:[-*+]|\d{1,9}[.)])[ \t]/;
const ANY_LIST_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]/;
const LIST_ITEM_PREFIX_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const LIST_ITEM_INDENT_RE = /^( {0,3})(?:[-*+]|(\d{1,9})[.)])(?:([ \t]+)(.*)|[ \t]*)$/;
const ORDERED_LIST_ITEM_RE = /^( {0,3})(\d{1,9})([.)])(?:([ \t]+)(.*)|[ \t]*)$/;
const UNORDERED_LIST_ITEM_RE = /^( {0,3})[-*+](?:[ \t]|$)/;
const HR_LINE_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BLOCKQUOTE_LINE_RE = /^ {0,3}>/;
const BLOCKQUOTE_OR_HR_RE = /^ {0,3}(?:>|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/;
const REF_DEF_HEAD_RE = /^ {0,3}\[((?:[^\]\\]|\\.)+)\]:[ \t]*(.*)$/;
const STANDALONE_TITLE_RE = /^[ \t]*(?:"[^"]*"|'[^']*'|\([^)]*\))[ \t]*$/;

interface ActiveOrderedList {
  delimiter: '.' | ')';
  nextOrdinal: number;
  contentIndent: number;
}

function parseListItemIndent(
  line: string,
): { leadingSpaces: number; contentIndent: number } | null {
  if (HR_LINE_RE.test(line)) return null;
  const m = LIST_ITEM_INDENT_RE.exec(line);
  if (!m) return null;
  const leadingSpaces = m[1].length;
  const markerLen = m[2] ? m[2].length + 1 : 1;
  const spacesAfter = m[3] ?? '';
  const rest = m[4] ?? '';
  const spaceLen =
    spacesAfter.length > 0 && spacesAfter.length <= 4 && rest.trim().length > 0
      ? spacesAfter.length
      : 1;
  return { leadingSpaces, contentIndent: leadingSpaces + markerLen + spaceLen };
}

interface FenceOpenInfo {
  char: string;
  len: number;
  quoteDepth: number;
  allowIndentedClose: boolean;
  openedFromListItem: boolean;
}

function stripBlockquotePrefix(line: string): { quoteDepth: number; rest: string } {
  let pos = 0;
  let quoteDepth = 0;
  while (pos < line.length) {
    let spaces = 0;
    while (pos + spaces < line.length && line[pos + spaces] === ' ' && spaces < 3) {
      spaces += 1;
    }
    if (pos + spaces < line.length && line[pos + spaces] === '>') {
      quoteDepth += 1;
      pos += spaces + 1;
      if (pos < line.length && (line[pos] === ' ' || line[pos] === '\t')) {
        pos += 1;
      }
    } else {
      break;
    }
  }
  return { quoteDepth, rest: line.slice(pos) };
}

function stripExactBlockquoteDepth(line: string, targetDepth: number): string | null {
  if (targetDepth === 0) return line;
  let pos = 0;
  for (let d = 0; d < targetDepth; d++) {
    let spaces = 0;
    while (pos + spaces < line.length && line[pos + spaces] === ' ' && spaces < 3) {
      spaces += 1;
    }
    if (pos + spaces >= line.length || line[pos + spaces] !== '>') {
      return null;
    }
    pos += spaces + 1;
    if (pos < line.length && (line[pos] === ' ' || line[pos] === '\t')) {
      pos += 1;
    }
  }
  return line.slice(pos);
}

function matchFenceOpen(line: string, inList: boolean): FenceOpenInfo | null {
  const { quoteDepth, rest } = stripBlockquotePrefix(line);
  const direct = FENCE_OPEN_RE.exec(rest);
  if (direct) {
    const marker = direct[1];
    const info = direct[2];
    if (marker[0] !== '`' || !info.includes('`')) {
      return {
        char: marker[0],
        len: marker.length,
        quoteDepth,
        allowIndentedClose: false,
        openedFromListItem: false,
      };
    }
  }
  const listPrefix = LIST_ITEM_PREFIX_RE.exec(rest);
  if (listPrefix) {
    const inlineFence = FENCE_OPEN_RE.exec(listPrefix[1]);
    if (inlineFence) {
      const marker = inlineFence[1];
      const info = inlineFence[2];
      if (marker[0] !== '`' || !info.includes('`')) {
        return {
          char: marker[0],
          len: marker.length,
          quoteDepth,
          allowIndentedClose: true,
          openedFromListItem: true,
        };
      }
    }
  }
  if (inList) {
    const indented = INDENTED_FENCE_OPEN_RE.exec(rest);
    if (indented) {
      const marker = indented[1];
      const info = indented[2];
      if (marker[0] !== '`' || !info.includes('`')) {
        return {
          char: marker[0],
          len: marker.length,
          quoteDepth,
          allowIndentedClose: true,
          openedFromListItem: true,
        };
      }
    }
  }
  return null;
}

function leadingIndentWidth(line: string): number {
  let width = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === ' ') {
      width += 1;
    } else if (ch === '\t') {
      width += 4 - (width % 4);
    } else {
      break;
    }
  }
  return width;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function stripBracketConstructs(input: string, imagesOnly: boolean): string {
  const trigger = imagesOnly ? '![' : '[';
  let idx = input.indexOf(trigger);
  if (idx === -1) return input;

  let out = '';
  let cursor = 0;
  let noMoreCloseParen = false;
  let noMoreCloseRef = false;

  while (idx !== -1) {
    const labelStart = idx + trigger.length;
    const closeBracket = input.indexOf(']', labelStart);
    if (closeBracket === -1) break;

    const afterClose = closeBracket + 1;
    const nextCh = input[afterClose];
    const hasLabel = imagesOnly || closeBracket > labelStart;

    if (hasLabel && nextCh === '(' && !noMoreCloseParen) {
      const closeParen = input.indexOf(')', afterClose + 1);
      if (closeParen !== -1) {
        out += input.slice(cursor, idx) + input.slice(labelStart, closeBracket);
        cursor = closeParen + 1;
        idx = input.indexOf(trigger, cursor);
        continue;
      }
      noMoreCloseParen = true;
    } else if (hasLabel && nextCh === '[' && !noMoreCloseRef) {
      const closeRef = input.indexOf(']', afterClose + 1);
      if (closeRef !== -1) {
        out += input.slice(cursor, idx) + input.slice(labelStart, closeBracket);
        cursor = closeRef + 1;
        idx = input.indexOf(trigger, cursor);
        continue;
      }
      noMoreCloseRef = true;
    }

    idx = input.indexOf(trigger, closeBracket + 1);
  }

  if (cursor === 0) return input;
  return out + input.slice(cursor);
}

function stripInlineLinksAndImages(raw: string): string {
  return stripBracketConstructs(stripBracketConstructs(raw, true), false);
}

function stripInlineMarkdown(raw: string): string {
  return stripInlineLinksAndImages(raw)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|~~|\*|_)/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
    .trim();
}

function isClosingFence(
  line: string,
  fenceChar: string,
  fenceLen: number,
  allowAnyIndent = false,
): boolean {
  let i = 0;
  let spaces = 0;
  while (i < line.length && (line[i] === ' ' || (allowAnyIndent && line[i] === '\t'))) {
    i += 1;
    spaces += 1;
    if (!allowAnyIndent && spaces >= 4) return false;
  }
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

function resolveRefDefEndLine(lines: readonly string[], startIndex: number): number {
  const headMatch = REF_DEF_HEAD_RE.exec(lines[startIndex]);
  if (!headMatch) return -1;
  const lineCount = lines.length;
  const rest = headMatch[2].trim();
  if (rest.length > 0) {
    if (startIndex + 1 < lineCount && STANDALONE_TITLE_RE.test(lines[startIndex + 1])) {
      return startIndex + 1;
    }
    return startIndex;
  }
  if (startIndex + 1 >= lineCount) return -1;
  const nextLine = lines[startIndex + 1];
  if (
    isBlankLine(nextLine) ||
    ATX_HEADING_RE.test(nextLine) ||
    FENCE_OPEN_RE.test(nextLine) ||
    REF_DEF_HEAD_RE.test(nextLine) ||
    BLOCKQUOTE_OR_HR_RE.test(nextLine) ||
    TOP_LEVEL_LIST_RE.test(nextLine)
  ) {
    return -1;
  }
  if (startIndex + 2 < lineCount && STANDALONE_TITLE_RE.test(lines[startIndex + 2])) {
    return startIndex + 2;
  }
  return startIndex + 1;
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

  const lineCount = lines.length;
  const nextNonBlankLine = new Int32Array(lineCount + 1);
  nextNonBlankLine[lineCount] = -1;
  for (let i = lineCount - 1; i >= 0; i--) {
    nextNonBlankLine[i] = isBlankLine(lines[i]) ? nextNonBlankLine[i + 1] : i;
  }

  const frontmatterEndLine = scanFrontmatterEndLine(lines);
  const chunks: LargeMarkdownChunk[] = [];
  const headings: Heading[] = [];
  const headingToChunk = new Map<number, number>();
  const slugCount = new Map<string, number>();
  const usedIds = new Set<string>();
  const refDefBlocks: string[] = [];

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
  let fenceQuoteDepth = 0;
  let fenceAllowIndentedClose = false;
  let fenceOpenedFromListItem = false;
  let inTable = false;
  let tableQuoteDepth = 0;
  let inList = false;
  let listContentIndent = 0;
  let paragraphStartLine = -1;
  let refDefConsumedUntil = -1;
  const orderedListState: {
    active: ActiveOrderedList | null;
    carried: ActiveOrderedList | null;
  } = { active: null, carried: null };
  let chunkFirstNonBlankSeen = false;
  let chunkOrderedListStart: number | undefined = undefined;

  const flushChunk = (endLineInclusive: number): void => {
    const id = chunks.length;
    const startOffset = lineStarts[chunkStartLine];
    const endOffset = lineNextStarts[endLineInclusive];
    const chunkLineCount = endLineInclusive - chunkStartLine + 1;
    const chunkFmEndOffset =
      id === 0 && frontmatterEndLine >= 0 ? lineNextStarts[frontmatterEndLine] - startOffset : 0;
    chunks.push({
      id,
      startLine: chunkStartLine,
      endLine: endLineInclusive,
      startOffset,
      endOffset,
      markdown: markdown.slice(startOffset, endOffset),
      estimatedHeight: Math.max(MIN_CHUNK_HEIGHT, chunkLineCount * PIXELS_PER_LINE_ESTIMATE),
      headingPositions: currentHeadingPositions,
      ...(chunkOrderedListStart !== undefined
        ? { continuedOrderedListStart: chunkOrderedListStart }
        : {}),
      ...(chunkFmEndOffset > 0 ? { frontmatterEndOffset: chunkFmEndOffset } : {}),
    });
    chunkStartLine = endLineInclusive + 1;
    currentHeadingPositions = [];
    paragraphStartLine = -1;
    orderedListState.carried = orderedListState.active;
    chunkFirstNonBlankSeen = false;
    chunkOrderedListStart = undefined;
  };

  for (let i = 0; i < lineCount; i++) {
    const line = lines[i];
    const inFrontmatter = frontmatterEndLine >= 0 && i <= frontmatterEndLine;
    const chunkId = chunks.length;

    if (inFrontmatter) {
      paragraphStartLine = -1;
      inTable = false;
      tableQuoteDepth = 0;
      inList = false;
      listContentIndent = 0;
      orderedListState.active = null;
      if (!isBlankLine(line)) chunkFirstNonBlankSeen = true;
      // 前置 YAML 块禁止拆开，只在最后一行完成后考虑切分。
      if (i === frontmatterEndLine && i - chunkStartLine + 1 >= maxLines && i + 1 < lineCount) {
        flushChunk(i);
      }
      continue;
    }

    if (fenceChar !== '') {
      const fenceRest = stripExactBlockquoteDepth(line, fenceQuoteDepth);
      const exitedBlockquote = fenceRest === null;
      const exitedListItem =
        !exitedBlockquote &&
        fenceOpenedFromListItem &&
        !isBlankLine(fenceRest) &&
        leadingIndentWidth(fenceRest) < Math.max(1, listContentIndent) &&
        !isClosingFence(fenceRest, fenceChar, fenceLen, true);
      if (exitedBlockquote || exitedListItem) {
        // CommonMark 中引用块或列表项容器结束时，其内未闭合围栏同步隐式闭合，当前行按正常块处理。
        fenceChar = '';
        fenceLen = 0;
        fenceQuoteDepth = 0;
        fenceAllowIndentedClose = false;
        fenceOpenedFromListItem = false;
      } else {
        const closedQuoteDepth = fenceQuoteDepth;
        if (isClosingFence(fenceRest, fenceChar, fenceLen, fenceAllowIndentedClose)) {
          fenceChar = '';
          fenceLen = 0;
          fenceQuoteDepth = 0;
          fenceAllowIndentedClose = false;
          fenceOpenedFromListItem = false;
        }
        paragraphStartLine = -1;
        inTable = false;
        tableQuoteDepth = 0;
        if (!isBlankLine(line)) chunkFirstNonBlankSeen = true;
        if (fenceChar === '' && i - chunkStartLine + 1 >= targetLines && i + 1 < lineCount) {
          const nextLine = lines[i + 1];
          const nextNonBlankIdx = nextNonBlankLine[i + 1];
          const nextContinuesList =
            inList &&
            nextNonBlankIdx !== -1 &&
            leadingIndentWidth(lines[nextNonBlankIdx]) >= listContentIndent;
          const nextContinuesQuote =
            closedQuoteDepth > 0 && stripExactBlockquoteDepth(nextLine, closedQuoteDepth) !== null;
          if (
            !nextContinuesList &&
            !nextContinuesQuote &&
            (isBlankLine(nextLine) || ATX_HEADING_RE.test(nextLine))
          ) {
            flushChunk(i);
          }
        }
        continue;
      }
    }

    const fenceOpen = matchFenceOpen(line, inList);
    if (fenceOpen) {
      fenceChar = fenceOpen.char;
      fenceLen = fenceOpen.len;
      fenceQuoteDepth = fenceOpen.quoteDepth;
      fenceAllowIndentedClose = fenceOpen.allowIndentedClose;
      fenceOpenedFromListItem = fenceOpen.openedFromListItem;
      paragraphStartLine = -1;
      inTable = false;
      tableQuoteDepth = 0;
      if (fenceOpen.openedFromListItem && fenceOpen.quoteDepth === 0) {
        const listIndent = parseListItemIndent(line);
        if (listIndent && (!inList || listIndent.leadingSpaces < listContentIndent)) {
          listContentIndent = listIndent.contentIndent;
        }
        inList = true;
        const ordInline = ORDERED_LIST_ITEM_RE.exec(line);
        if (ordInline) {
          const leadingSpaces = ordInline[1].length;
          const digits = ordInline[2];
          const delimiter = ordInline[3] as '.' | ')';
          const spacesAfter = ordInline[4] ?? '';
          const rest = ordInline[5] ?? '';
          const contentIndent =
            leadingSpaces +
            digits.length +
            1 +
            (spacesAfter.length > 0 && spacesAfter.length <= 4 && rest.trim().length > 0
              ? spacesAfter.length
              : 1);
          const currentOrd = orderedListState.active;
          if (currentOrd && leadingSpaces >= currentOrd.contentIndent) {
            // 子列表项
          } else if (currentOrd && currentOrd.delimiter === delimiter) {
            if (!chunkFirstNonBlankSeen && orderedListState.carried === currentOrd) {
              chunkOrderedListStart = currentOrd.nextOrdinal;
            }
            currentOrd.nextOrdinal += 1;
            currentOrd.contentIndent = contentIndent;
          } else {
            orderedListState.active = {
              delimiter,
              nextOrdinal: Number.parseInt(digits, 10) + 1,
              contentIndent,
            };
          }
        } else if (
          UNORDERED_LIST_ITEM_RE.test(line) &&
          orderedListState.active &&
          leadingIndentWidth(line) < orderedListState.active.contentIndent
        ) {
          orderedListState.active = null;
        }
      } else if (
        orderedListState.active &&
        (fenceOpen.quoteDepth > 0 ||
          leadingIndentWidth(line) < orderedListState.active.contentIndent)
      ) {
        orderedListState.active = null;
      }
      chunkFirstNonBlankSeen = true;
      if (
        !fenceOpen.openedFromListItem &&
        (fenceOpen.quoteDepth > 0 ||
          (leadingIndentWidth(line) < listContentIndent && (i === 0 || isBlankLine(lines[i - 1]))))
      ) {
        inList = false;
        listContentIndent = 0;
      }
      continue;
    }

    if (i <= refDefConsumedUntil) {
      paragraphStartLine = -1;
      inTable = false;
      tableQuoteDepth = 0;
      if (!isBlankLine(line)) chunkFirstNonBlankSeen = true;
      if (i < refDefConsumedUntil || i + 1 >= lineCount) continue;
    } else {
      // 表格状态追踪：支持顶层及引用块内的 GFM 表格，避免拆开后退化为普通文本。
      if (!inTable && i + 1 < lineCount) {
        const curQuote = stripBlockquotePrefix(line);
        const nextQuote = stripBlockquotePrefix(lines[i + 1]);
        if (
          curQuote.quoteDepth === nextQuote.quoteDepth &&
          looksLikeTableRow(curQuote.rest) &&
          TABLE_SEPARATOR_RE.test(nextQuote.rest)
        ) {
          inTable = true;
          tableQuoteDepth = curQuote.quoteDepth;
          paragraphStartLine = -1;
          if (curQuote.quoteDepth > 0 || leadingIndentWidth(line) < listContentIndent) {
            inList = false;
            listContentIndent = 0;
          }
          if (
            orderedListState.active &&
            (curQuote.quoteDepth > 0 ||
              leadingIndentWidth(line) < orderedListState.active.contentIndent)
          ) {
            orderedListState.active = null;
          }
        }
      } else if (inTable) {
        const tableRest = stripExactBlockquoteDepth(line, tableQuoteDepth);
        if (
          tableRest === null ||
          isBlankLine(tableRest) ||
          ATX_HEADING_RE.test(tableRest) ||
          !looksLikeTableRow(tableRest)
        ) {
          inTable = false;
          tableQuoteDepth = 0;
        }
      }

      // 收集单行或跨行引用式链接定义候选块，切分后经 remark 解析筛选有效定义并按首次定义去重。
      const refHeadMatch = !inTable ? REF_DEF_HEAD_RE.exec(line) : null;
      const refEndLine = refHeadMatch ? resolveRefDefEndLine(lines, i) : -1;
      if (refHeadMatch && refEndLine !== -1) {
        refDefBlocks.push(lines.slice(i, refEndLine + 1).join('\n'));
        refDefConsumedUntil = refEndLine;
        paragraphStartLine = -1;
        chunkFirstNonBlankSeen = true;
        if (
          orderedListState.active &&
          leadingIndentWidth(line) < orderedListState.active.contentIndent
        ) {
          orderedListState.active = null;
        }
        if (
          leadingIndentWidth(line) < listContentIndent &&
          (i === 0 || isBlankLine(lines[i - 1]))
        ) {
          inList = false;
          listContentIndent = 0;
        }
        if (i < refDefConsumedUntil) continue;
      } else {
        // 标题提取（ATX 或单行/多行 Setext）与列表上下文追踪
        const atxMatch = ATX_HEADING_RE.exec(line);
        if (atxMatch) {
          const level = atxMatch[1].length;
          const rawBody = (atxMatch[2] ?? '').replace(/[ \t]+#*[ \t]*$/, '').trim();
          const pos = lineStarts[i];
          currentHeadingPositions.push(pos);
          registerHeading(level, rawBody, pos, chunkId);
          paragraphStartLine = -1;
          inList = false;
          listContentIndent = 0;
          orderedListState.active = null;
          chunkFirstNonBlankSeen = true;
        } else if (paragraphStartLine !== -1 && !inTable && SETEXT_UNDERLINE_RE.test(line)) {
          const level = line.trimStart()[0] === '=' ? 1 : 2;
          const pos = lineStarts[paragraphStartLine];
          const rawBody = lines
            .slice(paragraphStartLine, i)
            .map((item) => item.trim())
            .join(' ');
          currentHeadingPositions.push(pos);
          registerHeading(level, rawBody, pos, chunkId);
          paragraphStartLine = -1;
          inList = false;
          listContentIndent = 0;
          orderedListState.active = null;
          chunkFirstNonBlankSeen = true;
        } else {
          const listItemIndent = !inTable ? parseListItemIndent(line) : null;
          if (listItemIndent) {
            if (!inList || listItemIndent.leadingSpaces < listContentIndent) {
              listContentIndent = listItemIndent.contentIndent;
            }
            inList = true;
            paragraphStartLine = -1;
          } else if (
            inList &&
            !isBlankLine(line) &&
            leadingIndentWidth(line) < listContentIndent &&
            (i === 0 || isBlankLine(lines[i - 1]) || BLOCKQUOTE_OR_HR_RE.test(line))
          ) {
            inList = false;
            listContentIndent = 0;
          }

          if (!isBlankLine(line)) {
            const currentOrd = orderedListState.active;
            const ordMatch = !inTable ? ORDERED_LIST_ITEM_RE.exec(line) : null;
            if (ordMatch) {
              const leadingSpaces = ordMatch[1].length;
              const digits = ordMatch[2];
              const delimiter = ordMatch[3] as '.' | ')';
              const spacesAfter = ordMatch[4] ?? '';
              const rest = ordMatch[5] ?? '';
              const contentIndent =
                leadingSpaces +
                digits.length +
                1 +
                (spacesAfter.length > 0 && spacesAfter.length <= 4 && rest.trim().length > 0
                  ? spacesAfter.length
                  : 1);
              if (currentOrd && leadingSpaces >= currentOrd.contentIndent) {
                // 缩进落在当前列表内容缩进之后，属于子列表项，不递增外层序号。
              } else if (currentOrd && currentOrd.delimiter === delimiter) {
                if (!chunkFirstNonBlankSeen && orderedListState.carried === currentOrd) {
                  chunkOrderedListStart = currentOrd.nextOrdinal;
                }
                currentOrd.nextOrdinal += 1;
                currentOrd.contentIndent = contentIndent;
              } else {
                orderedListState.active = {
                  delimiter,
                  nextOrdinal: Number.parseInt(digits, 10) + 1,
                  contentIndent,
                };
              }
            } else if (!inTable && UNORDERED_LIST_ITEM_RE.test(line)) {
              if (currentOrd && leadingIndentWidth(line) < currentOrd.contentIndent) {
                orderedListState.active = null;
              }
            } else if (
              currentOrd &&
              leadingIndentWidth(line) < currentOrd.contentIndent &&
              (i === 0 || isBlankLine(lines[i - 1]) || BLOCKQUOTE_OR_HR_RE.test(line))
            ) {
              orderedListState.active = null;
            }
            chunkFirstNonBlankSeen = true;
          }

          const isPlainCandidate =
            !inTable &&
            !isBlankLine(line) &&
            !ANY_LIST_ITEM_RE.test(line) &&
            !BLOCKQUOTE_OR_HR_RE.test(line);
          if (isPlainCandidate) {
            if (paragraphStartLine === -1) paragraphStartLine = i;
          } else {
            paragraphStartLine = -1;
          }
        }
      }
    }

    // 决定是否在当前行后切分
    if (i + 1 >= lineCount) continue;
    // GFM 表格无论多少行都保持完整，避免拆开后后续行退化为普通文本。
    if (inTable) continue;

    const countInChunk = i - chunkStartLine + 1;
    if (countInChunk < targetLines) continue;

    const nextLine = lines[i + 1];
    // 正在累积的段落若紧跟 Setext 下划线，不得提前拆开。
    if (paragraphStartLine !== -1 && SETEXT_UNDERLINE_RE.test(nextLine)) continue;

    const nextNonBlankIdx = nextNonBlankLine[i + 1];
    const nextNonBlank = nextNonBlankIdx !== -1 ? lines[nextNonBlankIdx] : null;
    // 仅当后续非空行缩进达到当前列表项内容缩进列时，才属于同一列表项的续行或子列表；
    // 1..3 空格缩进的顶层兄弟列表项（如 `  - Item`）缩进小于 listContentIndent，允许在其边界切分。
    const nextContinuesListItem =
      inList && nextNonBlank !== null && leadingIndentWidth(nextNonBlank) >= listContentIndent;
    const nextListIndent = parseListItemIndent(nextLine);
    const isTopLevelSiblingList =
      nextListIndent !== null && (!inList || nextListIndent.leadingSpaces < listContentIndent);
    const isLazyListContinuation =
      inList &&
      !isBlankLine(line) &&
      !isBlankLine(nextLine) &&
      !isTopLevelSiblingList &&
      !ATX_HEADING_RE.test(nextLine) &&
      !BLOCKQUOTE_OR_HR_RE.test(nextLine);
    if (nextContinuesListItem || isLazyListContinuation) continue;

    const atSafeGap = isBlankLine(line) || isBlankLine(nextLine) || ATX_HEADING_RE.test(nextLine);
    if (atSafeGap) {
      flushChunk(i);
      continue;
    }

    if (countInChunk >= maxLines) {
      const lineIsBlockquote = BLOCKQUOTE_LINE_RE.test(line);
      const atListOrBlockBoundary =
        isTopLevelSiblingList ||
        HR_LINE_RE.test(nextLine) ||
        (!lineIsBlockquote && BLOCKQUOTE_LINE_RE.test(nextLine));
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
    referenceDefs: normalizeReferenceDefs(refDefBlocks),
  };
}

interface GlobalDefinition {
  url: string;
  title: string | null;
}

interface ActiveRenderContext {
  chunkStartOffset: number;
  bodyOffsetShift: number;
  headingSet: Set<number>;
  continuedOrderedListStart?: number;
  globalDefs: ReadonlyMap<string, GlobalDefinition>;
}

let activeRenderContext: ActiveRenderContext | null = null;

const refDefParser = unified().use(remarkParse);

function normalizeReferenceDefs(blocks: readonly string[]): string {
  if (blocks.length === 0) return '';
  const candidateRaw = blocks.join('\n\n');
  const tree = refDefParser.parse(candidateRaw);
  const seen = new Set<string>();
  const validBlocks: string[] = [];
  for (const node of tree.children) {
    if (node.type !== 'definition' || seen.has(node.identifier)) continue;
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (typeof start === 'number' && typeof end === 'number' && end > start) {
      seen.add(node.identifier);
      validBlocks.push(candidateRaw.slice(start, end));
    }
  }
  return validBlocks.join('\n');
}

let cachedGlobalDefs: {
  raw: string;
  map: Map<string, GlobalDefinition>;
} | null = null;

function getGlobalDefinitions(referenceDefs: string): ReadonlyMap<string, GlobalDefinition> {
  if (!referenceDefs) return new Map();
  if (cachedGlobalDefs?.raw === referenceDefs) return cachedGlobalDefs.map;
  const map = new Map<string, GlobalDefinition>();
  const tree = refDefParser.parse(referenceDefs);
  for (const node of tree.children) {
    if (node.type === 'definition' && !map.has(node.identifier)) {
      map.set(node.identifier, { url: node.url, title: node.title ?? null });
    }
  }
  cachedGlobalDefs = { raw: referenceDefs, map };
  return map;
}

function applyRenderContextToTree(tree: Root, ctx: ActiveRenderContext | null): void {
  if (!ctx) return;
  if (ctx.continuedOrderedListStart !== undefined) {
    const firstContentNode = tree.children.find(
      (node) => node.type !== 'definition' && node.type !== 'yaml',
    );
    if (firstContentNode?.type === 'list' && firstContentNode.ordered) {
      firstContentNode.start = ctx.continuedOrderedListStart;
    }
  }
  if (ctx.globalDefs.size > 0) {
    const stack: Parent[] = [tree];
    while (stack.length > 0) {
      const parent = stack.pop()!;
      for (const child of parent.children) {
        if (child.type === 'definition') {
          const globalDef = ctx.globalDefs.get(child.identifier);
          if (globalDef) {
            child.url = globalDef.url;
            child.title = globalDef.title;
          }
        } else if ('children' in child && Array.isArray(child.children)) {
          stack.push(child as Parent);
        }
      }
    }
  }
}

function resolveHeadingDocPos(node: MdastHeading): number | null {
  if (!activeRenderContext) return null;
  const rawOffset = node.position?.start?.offset;
  if (typeof rawOffset !== 'number') return null;
  const relOffset = rawOffset - activeRenderContext.bodyOffsetShift;
  if (relOffset < 0) return null;
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
  imageReference: (state, node) => {
    const refNode = node as MdastImageReference;
    const def = state.definitionById.get(String(refNode.identifier).toUpperCase());
    if (!def) {
      return defaultHandlers.imageReference(state, refNode);
    }
    const properties: Record<string, string> = {
      dataInkmarkSrc: def.url ?? '',
      alt: refNode.alt ?? '',
    };
    if (def.title) {
      properties.title = def.title;
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
      applyRenderContextToTree(tree, activeRenderContext);
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
  // 将经过校验的全局引用定义注入正文前方（chunk 0 若含 YAML frontmatter 则紧随其后），
  // 既避免末尾未闭合代码围栏或 HTML 块吞掉定义，又通过 bodyOffsetShift 精确还原标题偏移。
  let input = chunk.markdown;
  let bodyOffsetShift = 0;
  if (referenceDefs.length > 0) {
    const fmEnd = chunk.frontmatterEndOffset ?? 0;
    if (fmEnd > 0 && fmEnd <= chunk.markdown.length) {
      const fmPart = chunk.markdown.slice(0, fmEnd);
      const bodyPart = chunk.markdown.slice(fmEnd);
      const injected = `\n${referenceDefs}\n\n`;
      input = `${fmPart}${injected}${bodyPart}`;
      bodyOffsetShift = injected.length;
    } else {
      const injected = `${referenceDefs}\n\n`;
      input = `${injected}${chunk.markdown}`;
      bodyOffsetShift = injected.length;
    }
  }
  const processor = chunk.id === 0 ? processorChunkZero : processorChunkBody;
  activeRenderContext = {
    chunkStartOffset: chunk.startOffset,
    bodyOffsetShift,
    headingSet: new Set(chunk.headingPositions),
    continuedOrderedListStart: chunk.continuedOrderedListStart,
    globalDefs: getGlobalDefinitions(referenceDefs),
  };
  try {
    return String(processor.processSync(input));
  } finally {
    activeRenderContext = null;
  }
}

/**
 * 提取大 Markdown 文档的可读正文文本（剔除 YAML frontmatter、链接定义、
 * 围栏标记与常见 Markdown 语法符号），使只读预览下的字数统计与源码模式保持同源口径。
 */
export function extractReadableMarkdownText(markdown: string): string {
  if (!markdown) return '';
  const lines = markdown.split(/\r?\n/);
  const fmEnd = scanFrontmatterEndLine(lines);
  const startLine = fmEnd >= 0 ? fmEnd + 1 : 0;
  const output: string[] = [];

  let fenceChar = '';
  let fenceLen = 0;
  let fenceQuoteDepth = 0;
  let refEndUntil = -1;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];

    if (fenceChar !== '') {
      const fenceRest = stripExactBlockquoteDepth(line, fenceQuoteDepth);
      if (fenceRest === null) {
        fenceChar = '';
        fenceLen = 0;
        fenceQuoteDepth = 0;
      } else {
        if (isClosingFence(fenceRest, fenceChar, fenceLen)) {
          fenceChar = '';
          fenceLen = 0;
          fenceQuoteDepth = 0;
        } else {
          output.push(fenceRest);
        }
        continue;
      }
    }

    const fenceOpen = matchFenceOpen(line, false);
    if (fenceOpen && !fenceOpen.openedFromListItem) {
      fenceChar = fenceOpen.char;
      fenceLen = fenceOpen.len;
      fenceQuoteDepth = fenceOpen.quoteDepth;
      continue;
    }

    if (i <= refEndUntil) continue;
    if (REF_DEF_HEAD_RE.test(line)) {
      const resolvedEnd = resolveRefDefEndLine(lines, i);
      if (resolvedEnd !== -1) {
        refEndUntil = resolvedEnd;
        continue;
      }
    }

    if (TABLE_SEPARATOR_RE.test(line)) continue;
    if (i > startLine && !isBlankLine(lines[i - 1]) && SETEXT_UNDERLINE_RE.test(line)) continue;
    if (/^ {0,3}(?:[-*_])(?:[ \t]*[-*_]){2,}[ \t]*$/.test(line)) continue;

    let text = line;
    const atx = ATX_HEADING_RE.exec(text);
    if (atx) {
      text = (atx[2] ?? '').replace(/[ \t]+#*[ \t]*$/, '');
    } else {
      text = text
        .replace(/^(?: {0,3}>[ \t]?)+/, '')
        .replace(/^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '');
    }

    text = stripInlineLinksAndImages(text)
      .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/gi, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/(\*\*|__|~~|\*|_)/g, '')
      .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
      .replace(/[ \t]*\|[ \t]*/g, ' ');

    output.push(text);
  }

  return output.join('\n');
}
