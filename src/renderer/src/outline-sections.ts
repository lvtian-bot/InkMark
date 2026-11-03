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
  // 章节止于其右侧第一个「同级或更高级」标题；没有则直到文末。
  const boundaries = order.map(() => doc.length);
  for (let i = 0; i < order.length; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) {
      if (levels[j] <= levels[i]) {
        boundaries[i] = starts[j];
        break;
      }
    }
  }

  return order
    .map(({ heading }, index) => {
      const from = starts[index];
      const lineEnd = expandToLineEnd(doc, heading.pos);
      const boundary = Math.max(boundaries[index], lineEnd);
      // 章节内容止于最后一个非空行的行尾（不含换行符），之后的空行记为 gapTo。
      const contentEnd = Math.max(trimTrailingBlankLines(doc, from, boundary), from + 1);
      let gapTo = contentEnd;
      while (gapTo < doc.length && /\s/.test(doc[gapTo])) gapTo += 1;
      return { from, to: contentEnd, gapTo: Math.max(gapTo, boundary) };
    })
    .sort((a, b) => a.from - b.from);
}

/** 返回区间内最后一个非空白行末尾之后的位置（不含行尾换行符）。 */
function trimTrailingBlankLines(doc: string, from: number, to: number): number {
  let cursor = to - 1;
  while (cursor >= from && /\s/.test(doc[cursor])) cursor -= 1;
  return cursor < from ? from : cursor + 1;
}

/** 落点：插到某个章节之前（`before`）或某个章节之后（`after`）。 */
export type DropAnchor = { kind: 'before'; index: number } | { kind: 'after'; index: number };

export interface MoveSectionResult {
  content: string;
  /** 搬移后整节在正文中的新起点，供界面重新定位。 */
  movedFrom: number;
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

  const moving = doc.slice(source.from, source.to).replace(/\s+$/, '');
  // 章节连同其尾部空行一起移除，搬移后不会在原地留下空行。
  const removed = doc.slice(0, source.from) + doc.slice(source.gapTo);
  const removedCount = source.gapTo - source.from;
  // 目标偏移换算到删除之后的坐标系：源区间之后的内容整体前移。
  const target = clampToDoc(
    removed,
    anchorOffset > source.gapTo ? anchorOffset - removedCount : anchorOffset,
  );

  // 拼接两侧的现有空白一律收敛为一个空行，避免出现多余空行或正文粘连。
  const prefix = removed.slice(0, target).replace(/\s+$/, '');
  const suffix = removed.slice(target).replace(/^\s+/, '').replace(/\s+$/, '');
  const before = prefix.length > 0 ? '\n\n' : '';
  // 章节位于文末时不再补尾部空行。
  const after = suffix.length > 0 ? '\n\n' : '';
  const content = prefix + before + moving + after + suffix;
  if (content === doc) return null;
  return { content, movedFrom: prefix.length + before.length };
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
