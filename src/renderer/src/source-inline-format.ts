import { markdownLanguage } from '@codemirror/lang-markdown';

interface Span {
  from: number;
  to: number;
}
interface MarkedSpan extends Span {
  openEnd: number;
  closeStart: number;
}

const markNodes: Record<string, string> = {
  '**': 'StrongEmphasis',
  '*': 'Emphasis',
  '~~': 'Strikethrough',
  '`': 'InlineCode',
};

/** 只移除语法树确认为当前样式的成对标记，保留转义符号和其他格式。 */
export function toggleSourceMark(text: string, from: number, to: number, marker: string) {
  if (text.slice(from, to).includes('\n')) {
    const blocks: Span[] = [];
    markdownLanguage.parser.parse(text).iterate({
      from,
      to,
      enter(ref) {
        if (ref.name !== 'Paragraph' && !/^(?:ATX|Setext)Heading/.test(ref.name)) return;
        let left = ref.from,
          right = ref.to;
        if (ref.node.firstChild?.name === 'HeaderMark' && ref.node.firstChild.from === left) {
          left = ref.node.firstChild.to;
          while (left < right && /[ \t]/.test(text[left])) left++;
        }
        if (ref.node.lastChild?.name === 'HeaderMark' && ref.node.lastChild.to === right) {
          right = text.lastIndexOf('\n', ref.node.lastChild.from);
        }
        if (Math.max(from, left) < Math.min(to, right)) blocks.push({ from: left, to: right });
        return false;
      },
    });
    let result = '';
    let copied = 0,
      newFrom = from,
      newTo = to;
    for (const block of blocks) {
      result += text.slice(copied, block.from);
      const start = result.length;
      const piece = text.slice(block.from, block.to);
      const change = toggleInline(
        piece,
        Math.max(0, from - block.from),
        Math.min(to, block.to) - block.from,
        marker,
      );
      result += change.text;
      if (from >= block.from && from < block.to) newFrom = start + change.selection.from;
      if (to > block.from && to <= block.to) newTo = start + change.selection.to;
      else if (to > block.to) newTo += change.text.length - piece.length;
      copied = block.to;
    }
    return { text: result + text.slice(copied), selection: { from: newFrom, to: newTo } };
  }
  return toggleInline(text, from, to, marker);
}

function toggleInline(text: string, from: number, to: number, marker: string) {
  if (from === to) {
    const paired =
      text.slice(Math.max(0, from - marker.length), from) === marker &&
      text.slice(from, from + marker.length) === marker;
    const pos = paired ? from - marker.length : from + marker.length;
    return {
      text: paired
        ? text.slice(0, pos) + text.slice(to + marker.length)
        : text.slice(0, from) + marker + marker + text.slice(to),
      selection: { from: pos, to: pos },
    };
  }

  const spans: MarkedSpan[] = [];
  let formatFrom = from,
    formatTo = to;
  const tree = markdownLanguage.parser.parse(text);
  tree.iterate({
    from,
    to,
    leave(ref) {
      if (ref.name === markNodes[marker] || !Object.values(markNodes).includes(ref.name)) return;
      const { firstChild: open, lastChild: close } = ref.node;
      if (!open || !close || formatFrom > open.to || formatTo < close.from) return;
      if (formatFrom >= ref.from) formatFrom = ref.from;
      if (formatTo <= ref.to) formatTo = ref.to;
    },
    enter(ref) {
      if (ref.name !== markNodes[marker]) return;
      const { firstChild: open, lastChild: close } = ref.node;
      if (open && close && open.from !== close.from && open.to < to && close.from > from) {
        const body = text.slice(open.to, close.from);
        const padding = marker === '`' && /^ .* $/s.test(body) && /\S/.test(body) ? 1 : 0;
        spans.push({
          from: ref.from,
          to: ref.to,
          openEnd: open.to + padding,
          closeStart: close.from - padding,
        });
      }
    },
  });

  const deletions = spans
    .flatMap((s) => [
      { from: s.from, to: s.openEnd },
      { from: s.closeStart, to: s.to },
    ])
    .sort((a, b) => a.from - b.from);
  const cleanPos = (pos: number) =>
    pos - deletions.reduce((total, d) => total + Math.max(0, Math.min(pos, d.to) - d.from), 0);
  let clean = '';
  let offset = 0;
  for (const d of deletions) {
    clean += text.slice(offset, d.from);
    offset = d.to;
  }
  clean += text.slice(offset);
  const start = cleanPos(formatFrom);
  const end = cleanPos(formatTo);
  const existing: Span[] = [];
  for (const span of spans) {
    const left = cleanPos(span.openEnd),
      right = cleanPos(span.closeStart);
    const previous = existing.at(-1);
    if (previous && left <= previous.to) previous.to = Math.max(previous.to, right);
    else existing.push({ from: left, to: right });
  }
  const remove = existing.some((s) => s.from <= start && s.to >= end);
  const ranges: Span[] = [];
  if (remove) {
    for (const s of existing) {
      if (s.from < start) ranges.push({ from: s.from, to: start });
      if (s.to > end) ranges.push({ from: end, to: s.to });
    }
  } else {
    ranges.push({
      from: existing.reduce((n, s) => Math.min(n, s.from), start),
      to: existing.reduce((n, s) => Math.max(n, s.to), end),
    });
  }
  const inserts: { pos: number; value: string }[] = [];
  for (const range of ranges) {
    let left = range.from,
      right = range.to;
    if (marker !== '`') {
      while (left < right && /\s/.test(clean[left])) left++;
      while (left < right && /\s/.test(clean[right - 1])) right--;
    }
    if (left === right) continue;
    let open = marker,
      close = marker;
    if (marker === '`') {
      const body = clean.slice(left, right);
      const longest = Array.from(body.matchAll(/`+/g)).reduce(
        (n, m) => Math.max(n, m[0].length),
        0,
      );
      open = close = '`'.repeat(longest + 1);
      if (/^`|`$/.test(body) || (/^ .* $/s.test(body) && /\S/.test(body))) {
        open += ' ';
        close = ' ' + close;
      }
    }
    inserts.push({ pos: left, value: open }, { pos: right, value: close });
  }
  let result = clean;
  for (const i of [...inserts].reverse())
    result = result.slice(0, i.pos) + i.value + result.slice(i.pos);
  const position = (p: number, isStart: boolean) =>
    p +
    inserts.reduce((n, i) => n + (i.pos < p || (i.pos === p && isStart) ? i.value.length : 0), 0);
  return {
    text: result,
    selection: { from: position(cleanPos(from), true), to: position(cleanPos(to), false) },
  };
}
