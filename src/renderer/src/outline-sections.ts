import { markdownLanguage } from '@codemirror/lang-markdown';

/** 元信息不参与 Markdown 正文解析；保留字符长度和换行，维持原文坐标。 */
export function parseOutlineMarkdown(doc: string) {
  const frontmatter = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(doc);
  const masked = frontmatter
    ? frontmatter[0].replace(/[^\r\n]/g, ' ') + doc.slice(frontmatter[0].length)
    : doc;
  return markdownLanguage.parser.parse(masked);
}

/**
 * 大纲拖动移动的纯逻辑：把大纲标题映射回正文的字符区间，
 * 并计算「把一整节搬到另一处」之后的新正文。与编辑器、DOM 无关，便于单元测试。
 *
 * 所有位置都以正文的字符偏移为准，与源码编辑器坐标一致。
 */

export interface OutlineSection {
  /** 标题所在行首偏移（含标题标记）。 */
  from: number;
  /** 整节正文结束偏移（不含）；末尾空行不算在章节内容里。 */
  to: number;
  /** `to` 之后延续到下一节之前的分隔空白（空行与缩进），搬移时一并让出。 */
  gapTo: number;
}

export interface HeadingRange {
  pos: number;
  level: number;
}

function clampToDoc(doc: string, offset: number): number {
  return Math.max(0, Math.min(offset, doc.length));
}

/** 把偏移收缩到所在行的行首。 */
export function expandToLineStart(doc: string, offset: number): number {
  const clamped = clampToDoc(doc, offset);
  if (clamped === 0) return 0;
  const previous = doc[clamped - 1];
  if (previous === '\n' || previous === '\r') return clamped;
  const lf = doc.lastIndexOf('\n', clamped - 1);
  const cr = doc.lastIndexOf('\r', clamped - 1);
  return Math.max(lf, cr) + 1;
}

/**
 * 把偏移延伸到所在行的行尾之后（含换行符）。
 * 偏移恰在行首时按「尚未消费本行」处理，先找到本行的换行符再跨越。
 */
export function expandToLineEnd(doc: string, offset: number): number {
  const clamped = clampToDoc(doc, offset);
  if (clamped >= doc.length) return doc.length;
  // 已是行首：本行内容从该偏移开始，按普通字符向后找到本行行尾。
  const lf = doc.indexOf('\n', clamped);
  const cr = doc.indexOf('\r', clamped);
  if (lf < 0 && cr < 0) return doc.length;
  if (cr >= 0 && (lf < 0 || cr < lf)) return cr + 1;
  return lf + 1;
}

/**
 * 计算每个标题所属章节的正文区间。
 *
 * 章节从标题所在行开始，到下一个同级或更高级标题所在行之前结束，
 * 即连同全部更深层级的子标题与正文一起归入本章节。
 * 章节内容不含末尾空行，这些空行作为分隔记录在 `gapTo` 中。
 */
export function computeSectionRanges(
  doc: string,
  headings: readonly HeadingRange[],
): OutlineSection[] {
  const order = headings
    .map((heading, index) => ({ heading, index }))
    .sort((a, b) => a.heading.pos - b.heading.pos || a.index - b.index);
  if (order.length === 0) return [];

  const starts = order.map(({ heading }) => expandToLineStart(doc, heading.pos));
  const levels = order.map(({ heading }) => heading.level);
  // 从右向左维护最近的同级或更高级标题，避免长文档逐项向后扫描。
  const boundaries = order.map(() => doc.length);
  const candidates: number[] = [];
  for (let i = order.length - 1; i >= 0; i -= 1) {
    while (candidates.length > 0 && levels[candidates[candidates.length - 1]] > levels[i]) {
      candidates.pop();
    }
    if (candidates.length > 0) boundaries[i] = starts[candidates[candidates.length - 1]];
    candidates.push(i);
  }

  return order
    .map(({ heading }, index) => {
      const from = starts[index];
      const lineEnd = expandToLineEnd(doc, heading.pos);
      const boundary = Math.max(boundaries[index], lineEnd);
      // 章节内容止于最后一个非空行的行尾（保留其行尾字面空格），
      // 其后的空白行作为分隔记录在 gapTo 中。
      // gapTo 不得越过下一章节边界，否则会把相邻标题前的缩进一并让出，
      // 改变那个未移动标题的容器归属。
      const contentEnd = Math.max(trimTrailingBlankLines(doc, from, boundary), from + 1);
      const gapTo = Math.min(skipBlankLines(doc, contentEnd, boundary), boundary);
      return { from, to: contentEnd, gapTo: Math.max(gapTo, contentEnd) };
    })
    .sort((a, b) => a.from - b.from);
}

/**
 * 去掉区间末尾的空白行，但保留最后一个有内容的那一行（含其行尾空格）。
 * 只按行判断：整行都由空白组成才算空行，行尾空格属于字面内容。
 */
function trimTrailingBlankLines(doc: string, from: number, to: number): number {
  let end = to;
  while (end > from) {
    // 定位 end 之前最后一个非换行字符（即上一行最后一个字符）。
    let cursor = end - 1;
    while (cursor >= from && (doc[cursor] === '\n' || doc[cursor] === '\r')) cursor -= 1;
    if (cursor < from) return from;
    let lineStart = cursor;
    while (lineStart > from && doc[lineStart - 1] !== '\n' && doc[lineStart - 1] !== '\r') {
      lineStart -= 1;
    }
    if (doc.slice(lineStart, cursor + 1).trim() !== '') return cursor + 1;
    end = lineStart;
  }
  return from;
}

/** 从 `from` 起跳过连续的空白行，返回下一个非空行的行首；不越过 `limit`。 */
function skipBlankLines(doc: string, from: number, limit: number): number {
  let cursor = from;
  while (cursor < limit) {
    let lineEnd = cursor;
    while (lineEnd < limit && doc[lineEnd] !== '\n' && doc[lineEnd] !== '\r') lineEnd += 1;
    if (doc.slice(cursor, lineEnd).trim() !== '') return cursor;
    while (lineEnd < limit && (doc[lineEnd] === '\n' || doc[lineEnd] === '\r')) lineEnd += 1;
    cursor = lineEnd;
  }
  return limit;
}

/** 落点：插到某个章节之前（`before`）或某个章节之后（`after`）。 */
export type DropAnchor = { kind: 'before'; index: number } | { kind: 'after'; index: number };

export interface MoveSectionResult {
  content: string;
  /** 搬移后整节在正文中的新起点，供界面重新定位。 */
  movedFrom: number;
}

/** 只在顶层标题边界切分，避免拆开列表、引用等 Markdown 容器。 */
export function hasSafeSectionBoundaries(
  doc: string,
  ranges: readonly OutlineSection[],
  fromIndex: number,
  anchor: DropAnchor,
): boolean {
  const source = ranges[fromIndex];
  const target = ranges[anchor.index];
  if (!source || !target) return false;
  const boundaries = new Set<number>([doc.length]);
  parseOutlineMarkdown(doc).iterate({
    enter(node) {
      if (
        /^(?:ATXHeading|SetextHeading)[1-6]$/.test(node.name) &&
        node.node.parent?.name === 'Document'
      ) {
        boundaries.add(expandToLineStart(doc, node.from));
      }
    },
  });
  const destination = anchor.kind === 'before' ? target.from : target.gapTo;
  return (
    boundaries.has(source.from) &&
    boundaries.has(source.gapTo) &&
    boundaries.has(target.from) &&
    boundaries.has(destination)
  );
}

/** 引用式链接使用全局定义；改变定义顺序可能改变未移动链接的目标。 */
export function hasStableLinkDefinitions(before: string, after: string): boolean {
  // 引用式定义的标签以 ]: 结束；普通正文不必为每个落点重复解析两遍。
  if (!before.includes(']:') && !after.includes(']:')) return true;
  const definitions = (doc: string): string[] => {
    const found: string[] = [];
    parseOutlineMarkdown(doc).iterate({
      enter(node) {
        if (node.name === 'LinkReference') found.push(doc.slice(node.from, node.to));
      },
    });
    return found;
  };
  const original = definitions(before);
  const moved = definitions(after);
  return (
    original.length === moved.length && original.every((value, index) => value === moved[index])
  );
}

/** 确认移动后所有标题仍按指定顺序存在，防止未闭合块吞掉后续章节。 */
export function hasExpectedHeadingOrder(
  before: string,
  after: string,
  ranges: readonly OutlineSection[],
  fromIndex: number,
  anchor: DropAnchor,
): boolean {
  const source = ranges[fromIndex];
  const target = ranges[anchor.index];
  if (!source || !target) return false;
  const destination = anchor.kind === 'before' ? target.from : target.gapTo;
  const headings = (doc: string) => {
    const found: Array<{ pos: number; name: string; text: string; ancestry: string }> = [];
    parseOutlineMarkdown(doc).iterate({
      enter(node) {
        if (/^(?:ATXHeading|SetextHeading)[1-6]$/.test(node.name)) {
          const ancestors: string[] = [];
          let parent = node.node.parent;
          while (parent) {
            ancestors.push(parent.name);
            parent = parent.parent;
          }
          found.push({
            pos: node.from,
            name: node.name,
            text: doc.slice(node.from, node.to),
            ancestry: ancestors.join('/'),
          });
        }
      },
    });
    return found;
  };
  const original = headings(before);
  const moved = original.filter(
    (heading) => heading.pos >= source.from && heading.pos < source.gapTo,
  );
  const remaining = original.filter(
    (heading) => heading.pos < source.from || heading.pos >= source.gapTo,
  );
  const expected = [
    ...remaining.filter((heading) => heading.pos < destination),
    ...moved,
    ...remaining.filter((heading) => heading.pos >= destination),
  ];
  const actual = headings(after);
  return (
    moved.length > 0 &&
    expected.length === actual.length &&
    expected.every(
      (heading, index) =>
        heading.name === actual[index].name &&
        heading.text === actual[index].text &&
        heading.ancestry === actual[index].ancestry,
    )
  );
}

/**
 * 把第 `fromIndex` 节整体搬到 `anchor` 指定的位置，返回移动后的新正文。
 * 返回 null 表示无需移动（找不到章节、原地搬回、或落点落在自己内部）。
 */
export function moveSection(
  doc: string,
  ranges: readonly OutlineSection[],
  fromIndex: number,
  anchor: DropAnchor,
): MoveSectionResult | null {
  const source = ranges[fromIndex];
  const anchorRange = ranges[anchor.index];
  if (!source || !anchorRange) return null;

  // 落点落在自己区间内（含两端）：要么原地不动，要么会把自己搬进自己内部。
  const anchorOffset = anchor.kind === 'before' ? anchorRange.from : anchorRange.gapTo;
  if (anchorOffset >= source.from && anchorOffset <= source.gapTo) return null;

  // 章节内容本身就是「最后一个非空行的行尾」，不在此处再裁空白，
  // 否则会删掉末行里字面意义的空格（如缩进代码块的行尾空格）。
  const moving = doc.slice(source.from, source.to);
  // 章节连同其尾部空行一起移除，搬移后不会在原地留下空行。
  const removedAll = doc.slice(0, source.from) + doc.slice(source.gapTo);
  // 被搬章节原本位于文末时，被移走的是它自己这部分分隔空白；
  // 剩下的尾部空行必须一并清掉，否则新文末会残留空行。只按整行去掉空行。
  const removed =
    source.gapTo >= doc.length
      ? removedAll.slice(0, trimTrailingBlankLines(removedAll, 0, removedAll.length))
      : removedAll;
  const removedCount = source.gapTo - source.from;
  // 目标偏移换算到删除之后的坐标系：源区间之后的内容整体前移。
  const target = clampToDoc(
    removed,
    anchorOffset > source.gapTo ? anchorOffset - removedCount : anchorOffset,
  );

  // 只在拼接边界上归一空白：去掉左侧末尾的空白行与右侧开头的空白行，
  // 两侧正文其余内容逐字保留，避免误删未移动章节里有意义的行尾空格。
  const prefix = removed.slice(0, target);
  const prefixEnd = trimTrailingBlankLines(prefix, 0, prefix.length);
  const prefixTrimmed = prefix.slice(0, prefixEnd);
  const rawSuffix = removed.slice(target);
  const suffixStart = skipBlankLines(rawSuffix, 0, rawSuffix.length);
  // 被搬章节自带开头，不加前导空行；两侧都有内容时补一个空行分隔。
  const before = prefixTrimmed.length > 0 ? '\n\n' : '';
  const suffix = rawSuffix.slice(suffixStart);
  // 章节移到文末后不再补尾部空行。
  const after = suffix.length > 0 ? '\n\n' : '';
  const content = prefixTrimmed + before + moving + after + suffix;
  if (content === doc) return null;
  return { content, movedFrom: prefixTrimmed.length + before.length };
}

/**
 * 判断从 `from` 起（到文末）是否存在未闭合的代码围栏。
 * 未闭合围栏在 Markdown 中合法且会一直延续到文末；若把这样的章节搬到中间，
 * 后续章节会被吞进代码块，因此这类移动需要拒绝。
 */
export function hasUnclosedFence(doc: string, from: number): boolean {
  if (!doc.includes('```', from) && !doc.includes('~~~', from)) return false;
  let unclosed = false;
  parseOutlineMarkdown(doc).iterate({
    from,
    enter(node) {
      if (node.name !== 'FencedCode') return;
      // 使用编辑器的 Markdown 解析器识别围栏，避免遗漏缩进和错误的闭合行。
      if (node.node.getChildren('CodeMark').length < 2) unclosed = true;
      return false;
    },
  });
  return unclosed;
}

/**
 * 判断 `targetIndex` 章节是否属于 `fromIndex` 章节（含自身）或位于其内部。
 * 只依赖标题层级：被拖章节覆盖其后所有更深层级的标题，直到遇到同级或更高级标题。
 * 用于拖动时立即给出「禁止放置」反馈，无需读取正文。
 */
export function isSectionAncestor(
  headings: ReadonlyArray<{ level: number }>,
  fromIndex: number,
  targetIndex: number,
): boolean {
  const source = headings[fromIndex];
  if (!source) return false;
  if (targetIndex === fromIndex) return true;
  if (targetIndex < fromIndex) return false;
  for (let index = fromIndex + 1; index <= targetIndex; index += 1) {
    if (headings[index].level <= source.level) return false;
  }
  return true;
}

/**
 * 把「拖到某个标题行的鼠标相对位置」换算成落点。
 * 与 Word 导航窗格一致：落在标题行上半区表示插到该章节之前，
 * 下半区表示插到该章节（连同其全部子章节）之后。
 */
export function resolveDropAnchor(targetIndex: number, pointerRatio: number): DropAnchor {
  return pointerRatio < 0.5
    ? { kind: 'before', index: targetIndex }
    : { kind: 'after', index: targetIndex };
}
