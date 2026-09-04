// 外部改动审阅的纯文本层：行级 diff、改动块计算与锚定解析。
// 只做字符串运算，不依赖编辑器、store 或 IPC，全部逻辑可单元测试。
import { diffArrays } from 'diff';

// 分词粒度（change-review.md「按行」，2026-09-04 修订）：整行（含换行符）
// 为一个 token，一行内的任何改动整行构成一个决策块，与 Git / VS Code 的
// 行级 diff 一致。初版按词对比会把 AI 润色的一段话拆成十几个待决块，
// 逐块处理反而不堪其扰，实际体验后调整为整行粒度。
export function tokenizeReviewText(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

// 相邻改动块之间少于该行数的等值段并入前一个改动块。行级下同一行内的多处
// 改动本就是同一个 token，这里只吸收紧邻改动的零星等值行；相隔数行的独立
// 段落改动仍各自成块，不绑成一个决策。
const COALESCE_TOKENS = 1;
// 每个改动块记录的锚定上下文长度（token 数，即行数），前后各取这么多。
const CONTEXT_TOKENS = 10;

interface TokenDiffPart {
  removed: boolean;
  added: boolean;
  tokens: string[];
}

function diffTokens(oldText: string, newText: string): TokenDiffPart[] {
  return diffArrays(tokenizeReviewText(oldText), tokenizeReviewText(newText)).map((part) => ({
    removed: !!part.removed,
    added: !!part.added,
    tokens: part.value,
  }));
}

function tokenLength(tokens: string[]): number {
  let length = 0;
  for (const token of tokens) length += token.length;
  return length;
}

export interface ReviewDiffChunk {
  /** 紧贴改动之前的等值上下文（取自 base），用于锚定。 */
  beforeContext: string;
  /** 紧贴改动之后的等值上下文（base 与磁盘版相同），用于锚定。 */
  afterContext: string;
  /** 旧侧文本（base 中被删除/替换的内容），纯新增时为空。 */
  removedText: string;
  /** 新侧文本（磁盘版中的新增/替换内容），纯删除时为空。 */
  insertedText: string;
  /** removedText 在 base 中的起始偏移；纯新增时为插入点。 */
  baseOffset: number;
}

/**
 * 计算外部改动块：diff(用户已知基线, 磁盘新版本) → 连续改动区域的列表。
 * 结构性大改动按 Git 惯例展示为「删除块 + 新增块」，不做移动识别。
 */
export function computeReviewChunks(base: string, disk: string): ReviewDiffChunk[] {
  if (base === disk) return [];
  const parts = diffTokens(base, disk);
  const chunks: ReviewDiffChunk[] = [];

  let basePos = 0;
  let equalTail: string[] = [];
  let inChunk = false;
  let chunkBaseStart = 0;
  let chunkBefore: string[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  // 块内遇到的短等值段先挂起：只有后面还有改动时才并入（否则吞掉文档
  // 尾部/中部的正常文本，把未变化内容也标成改动）。
  let heldEqual: string[] = [];

  const closeChunk = (afterTokens: string[]): void => {
    chunks.push({
      beforeContext: chunkBefore.join(''),
      afterContext: afterTokens.join(''),
      removedText: removed.join(''),
      insertedText: added.join(''),
      baseOffset: chunkBaseStart,
    });
    inChunk = false;
    removed = [];
    added = [];
    equalTail = [];
  };

  for (const part of parts) {
    const length = tokenLength(part.tokens);
    if (!part.removed && !part.added) {
      if (inChunk && part.tokens.length < COALESCE_TOKENS) {
        heldEqual.push(...part.tokens);
        basePos += length;
        continue;
      }
      if (inChunk) {
        closeChunk([...heldEqual, ...part.tokens.slice(0, CONTEXT_TOKENS)]);
      }
      equalTail.push(...heldEqual, ...part.tokens);
      heldEqual = [];
      basePos += length;
    } else if (part.removed) {
      if (inChunk) {
        // 挂起的等值段确认属于块内部（后面还有改动），并入两侧。
        removed.push(...heldEqual);
        added.push(...heldEqual);
        heldEqual = [];
      } else {
        chunkBaseStart = basePos;
        chunkBefore = equalTail.slice(-CONTEXT_TOKENS);
        inChunk = true;
      }
      removed.push(...part.tokens);
      basePos += length;
    } else {
      if (inChunk) {
        removed.push(...heldEqual);
        added.push(...heldEqual);
        heldEqual = [];
      } else {
        chunkBaseStart = basePos;
        chunkBefore = equalTail.slice(-CONTEXT_TOKENS);
        inChunk = true;
      }
      added.push(...part.tokens);
    }
  }
  if (inChunk) closeChunk(heldEqual);
  return chunks;
}

/** 锚定到当前编辑器内容后的改动块，anchor 坐标系为 buffer。 */
export interface AnchoredReviewChunk extends ReviewDiffChunk {
  id: number;
  /** removedText 在 buffer 中的起始偏移；纯新增时为插入点。 */
  anchor: number;
}

/**
 * 构建 base → buffer 的偏移映射（buffer = base + 用户编辑 + 已接受的审阅决定）。
 * 等值段内做线性插值；base 中被用户删除的区间折叠到段边界。
 */
function createOffsetMapper(base: string, buffer: string): (offset: number) => number {
  interface Segment {
    baseStart: number;
    baseEnd: number;
    bufferStart: number;
    equal: boolean;
  }
  const segments: Segment[] = [];
  let basePos = 0;
  let bufferPos = 0;
  for (const part of diffTokens(base, buffer)) {
    const length = tokenLength(part.tokens);
    if (part.removed) {
      segments.push({
        baseStart: basePos,
        baseEnd: basePos + length,
        bufferStart: bufferPos,
        equal: false,
      });
      basePos += length;
    } else if (!part.added) {
      segments.push({
        baseStart: basePos,
        baseEnd: basePos + length,
        bufferStart: bufferPos,
        equal: true,
      });
      basePos += length;
      bufferPos += length;
    } else {
      bufferPos += length;
    }
  }
  return (offset: number): number => {
    let mapped = 0;
    for (const segment of segments) {
      if (offset < segment.baseStart) break;
      if (offset >= segment.baseEnd) {
        mapped = segment.equal
          ? segment.bufferStart + (segment.baseEnd - segment.baseStart)
          : segment.bufferStart;
        continue;
      }
      return segment.equal
        ? segment.bufferStart + (offset - segment.baseStart)
        : segment.bufferStart;
    }
    return mapped;
  };
}

// 纯新增块的宽松校验：只看紧随插入点的 3 个字符。上下文窗口取自 base，
// 用户或未决改动可能已改写窗口内容，不能作为硬性否决条件。
function looseInsertionMatch(chunk: ReviewDiffChunk, buffer: string, anchor: number): boolean {
  const probe = chunk.afterContext.slice(0, 3);
  if (!probe) return true;
  return buffer.startsWith(probe, anchor);
}

/**
 * 在 buffer 中定位一个改动块。主判据是「旧侧文本就在期望位置」——这是
 * 锚定成立的本质事实，且不受上下文窗口被用户/未决改动改写的影响；
 * 纯新增块用插入点后 3 个字符做宽松校验。主判据失败再回退到全文唯一
 * 匹配（兼容「用户已删掉旧文本」和「等值衔接点」两种形态）。找不到或
 * 出现多处匹配（歧义）时返回 null，调用方按「用户编辑优先」丢弃。
 */
function locateChunk(
  chunk: ReviewDiffChunk,
  buffer: string,
  expectedAnchor: number,
): number | null {
  if (chunk.removedText) {
    if (buffer.startsWith(chunk.removedText, expectedAnchor)) return expectedAnchor;
  } else if (looseInsertionMatch(chunk, buffer, expectedAnchor)) {
    return expectedAnchor;
  }
  const pattern = chunk.removedText
    ? chunk.beforeContext + chunk.removedText + chunk.afterContext
    : chunk.beforeContext + chunk.afterContext;
  if (!pattern) return null;
  const first = buffer.indexOf(pattern);
  if (first === -1) return null;
  if (buffer.indexOf(pattern, first + 1) !== -1) return null;
  const anchor = first + chunk.beforeContext.length;
  if (anchor + chunk.removedText.length > buffer.length) return null;
  return anchor;
}

/**
 * 把 diff(base, disk) 得到的改动块锚定到当前 buffer。
 * 用户改动过的区域锚定失败即丢弃（该处外部改动视为已被用户处理）。
 */
export function anchorReviewChunks(
  chunks: ReviewDiffChunk[],
  base: string,
  buffer: string,
): AnchoredReviewChunk[] {
  const mapOffset = createOffsetMapper(base, buffer);
  const anchored: AnchoredReviewChunk[] = [];
  let id = 1;
  for (const chunk of chunks) {
    const anchor = locateChunk(chunk, buffer, mapOffset(chunk.baseOffset));
    if (anchor !== null) {
      anchored.push({ ...chunk, id: id++, anchor });
    }
  }
  return anchored;
}

/**
 * 重新校验已锚定的改动块（注入视图前 buffer 可能又变了）：
 * 逐块确认上下文仍成立，失效的尝试重新定位，仍失败则丢弃。
 */
export function verifyAnchoredChunks(
  chunks: AnchoredReviewChunk[],
  buffer: string,
): AnchoredReviewChunk[] {
  const verified: AnchoredReviewChunk[] = [];
  let id = 1;
  for (const chunk of chunks) {
    const anchor = locateChunk(chunk, buffer, chunk.anchor);
    if (anchor !== null) {
      verified.push({ ...chunk, id: id++, anchor });
    }
  }
  return verified;
}
