import {
  computeSectionRanges,
  expandToLineStart,
  hasSafeSectionBoundaries,
  hasStableLinkDefinitions,
  parseOutlineMarkdown,
} from './outline-sections';

export type OutlineAction = 'delete' | 'promote' | 'demote';

function readHeadings(doc: string) {
  const headings: Array<{
    from: number;
    to: number;
    pos: number;
    level: number;
    setext: boolean;
    ancestry: string;
    body: string;
    marks: Array<{ from: number; to: number }>;
  }> = [];
  parseOutlineMarkdown(doc).iterate({
    enter(node) {
      const match = /^(ATXHeading|SetextHeading)([1-6])$/.exec(node.name);
      if (!match) return;
      const marks = node.node.getChildren('HeaderMark').map(({ from, to }) => ({ from, to }));
      let body = doc.slice(node.from, node.to);
      for (const mark of [...marks].reverse()) {
        body = body.slice(0, mark.from - node.from) + body.slice(mark.to - node.from);
      }
      const ancestors: string[] = [];
      let parent = node.node.parent;
      while (parent) {
        ancestors.push(parent.name);
        parent = parent.parent;
      }
      headings.push({
        from: node.from,
        to: node.to,
        pos: expandToLineStart(doc, node.from),
        level: Number(match[2]),
        setext: match[1] === 'SetextHeading',
        ancestry: ancestors.join('/'),
        body: body.trim(),
        marks,
      });
    },
  });
  return headings;
}

/** 按章节层级编辑正文；无法保持 Markdown 结构和其他章节内容时拒绝操作。 */
export function editOutlineSection(
  doc: string,
  index: number,
  action: OutlineAction,
): string | null {
  const headings = readHeadings(doc);
  const heading = headings[index];
  if (!heading) return null;
  const ranges = computeSectionRanges(doc, headings);
  const range = ranges[index];
  const inside = (pos: number): boolean => pos >= range.from && pos < range.gapTo;
  let next: string;
  let expected: typeof headings;

  if (action === 'delete') {
    // 章节边界不能切开引用或列表；删除定义也不能改变其他章节的引用链接。
    if (!hasSafeSectionBoundaries(doc, ranges, index, { kind: 'before', index })) return null;
    next = doc.slice(0, range.from) + doc.slice(range.gapTo);
    if (!hasStableLinkDefinitions(doc, next)) return null;
    expected = headings.filter((item) => !inside(item.pos));
  } else {
    const delta = action === 'promote' ? -1 : 1;
    const edits: Array<{ from: number; to: number; insert: string }> = [];
    expected = headings.map((item) => ({ ...item }));
    for (let i = index; i < headings.length && inside(headings[i].pos); i += 1) {
      const item = headings[i];
      const level = item.level + delta;
      const mark = item.marks[0];
      if (level < 1 || level > 6 || !mark) return null;
      expected[i].level = level;
      if (!item.setext) {
        edits.push({ ...mark, insert: '#'.repeat(level) });
      } else if (level <= 2) {
        edits.push({ ...mark, insert: (level === 1 ? '=' : '-').repeat(mark.to - mark.from) });
      } else {
        // 多行 Setext 标题不能直接变成 ATX，否则后续行会变成普通正文。
        // 容器内转换还涉及逐行前缀，暂不改写，避免破坏引用或列表结构。
        if (item.ancestry !== 'Document' || /[\r\n]/.test(item.body)) return null;
        edits.push({ from: item.from, to: item.to, insert: `${'#'.repeat(level)} ${item.body}` });
      }
    }
    next = doc;
    for (const edit of edits.sort((a, b) => b.from - a.from)) {
      next = next.slice(0, edit.from) + edit.insert + next.slice(edit.to);
    }
  }

  const actual = readHeadings(next);
  if (
    actual.length !== expected.length ||
    expected.some(
      (item, i) =>
        item.level !== actual[i].level ||
        item.body !== actual[i].body ||
        item.ancestry !== actual[i].ancestry,
    )
  )
    return null;
  return next === doc ? null : next;
}
