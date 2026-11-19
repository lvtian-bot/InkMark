import type { Node, ResolvedPos } from '@milkdown/kit/prose/model';
import { TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';

/** 文本块内以硬换行或代码中的换行符划分逻辑行，自动折行不参与计算。 */
function lineStarts(block: Node): number[] {
  const starts = [0];
  block.forEach((child, offset) => {
    if (child.type.name === 'hardbreak') starts.push(offset + child.nodeSize);
    if (child.isText && child.text) {
      for (const match of child.text.matchAll(/\n/g)) starts.push(offset + match.index + 1);
    }
  });
  return starts;
}

function deleteBlock(tr: Transaction, pos: ResolvedPos, block: Node): void {
  const parent = pos.parent;
  if (parent.type.name === 'list_item' && pos.index() === 0) {
    const list = pos.node(-1);
    const itemStart = pos.before();
    const itemEnd = itemStart + parent.nodeSize;
    if (parent.childCount === 1) {
      if (list.childCount === 1) tr.deleteRange(pos.before(-1), pos.after(-1));
      else tr.delete(itemStart, itemEnd);
      return;
    }
    const next = parent.child(1);
    if (
      parent.childCount === 2 &&
      next.sameMarkup(list) &&
      list.canReplace(pos.index(-1), pos.index(-1) + 1, next.content)
    ) {
      tr.replaceWith(itemStart, itemEnd, next.content);
      return;
    }
    if (!parent.canReplace(0, 1)) {
      // 保留类型不同的子列表及后续块，把它们放回当前列表所在层级。
      // 先分开前后兄弟项，避免整体替换列表导致同一选区的其他位置丢失。
      const index = pos.index(-1);
      if (index + 1 < list.childCount) tr.split(itemEnd);
      if (index > 0) tr.split(itemStart);
      const listStart = index > 0 ? itemStart + 1 : pos.before(-1);
      tr.replaceWith(
        listStart,
        listStart + parent.nodeSize + 2,
        parent.content.cut(block.nodeSize),
      );
      return;
    }
  }
  tr.deleteRange(pos.pos, pos.pos + block.nodeSize);
}

export function deleteEditorLines(state: EditorState): Transaction | null {
  const { selection, doc } = state;
  if (!(selection instanceof TextSelection)) return null;
  const edits: { pos: number; start: number; end: number; whole: boolean }[] = [];
  let touchesTable = false;
  doc.nodesBetween(selection.from, selection.to, (block, pos) => {
    if (block.type.spec.tableRole === 'table') {
      touchesTable = true;
      return false;
    }
    if (!block.isTextblock) return true;
    const from = Math.max(0, selection.from - pos - 1);
    const to = Math.min(block.content.size, selection.to - pos - 1);
    if (
      to < 0 ||
      from > block.content.size ||
      (!selection.empty && to === 0 && pos + 1 === selection.to)
    )
      return false;
    const starts = lineStarts(block);
    const start = starts.filter((n) => n <= from).at(-1) ?? 0;
    const next = starts.find((n) => (selection.empty ? n > to : n >= to && n > start));
    edits.push({
      pos,
      start: next === undefined && start > 0 ? start - 1 : start,
      end: next ?? block.content.size,
      whole: start === 0 && next === undefined,
    });
    return false;
  });
  if (touchesTable || !edits.length) return null;
  const tr = state.tr;
  for (const edit of edits.reverse()) {
    const pos = tr.mapping.map(edit.pos, 1);
    const block = tr.doc.nodeAt(pos);
    if (!block?.isTextblock) continue;
    if (edit.whole) deleteBlock(tr, tr.doc.resolve(pos), block);
    else tr.delete(pos + 1 + edit.start, pos + 1 + edit.end);
  }
  return tr.docChanged ? tr.scrollIntoView() : null;
}
