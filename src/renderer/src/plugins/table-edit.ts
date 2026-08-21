import type { Ctx } from '@milkdown/ctx';
import type { Node } from '@milkdown/kit/prose/model';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { TextSelection } from '@milkdown/kit/prose/state';
import {
  type TableRect,
  addColumn,
  cellAround,
  deleteTable,
  isInTable,
  removeColumn,
  removeRow,
  selectedRect,
  TableMap,
} from '@milkdown/kit/prose/tables';
import { addRowWithAlignment } from '@milkdown/kit/preset/gfm';

export type TableLineKind = 'row' | 'col';
export type TablePos = 'before' | 'after';

// ---- 源码模式：纯文本表格增删行列 ----

/// 定位光标落在哪段连续表格行里。表格由表头行 / 分隔行 / 数据行组成，
/// 上下边界都必须是空行或非表格内容。返回行的起止下标（含），否则 null。
export function locateSourceTable(
  lines: string[],
  cursorLine: number,
): { start: number; end: number } | null {
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  if (!isTableRow(lines[cursorLine] ?? '')) return null;
  let start = cursorLine;
  while (start > 0 && isTableRow(lines[start - 1])) start -= 1;
  let end = cursorLine;
  while (end + 1 < lines.length && isTableRow(lines[end + 1])) end += 1;
  // 至少要有表头 + 分隔（两行以上才构成表格）。
  if (end - start < 1) return null;
  return { start, end };
}

/// 把一行表格文本拆成单元格内容（去掉首尾 |）。
export function splitTableRow(line: string): string[] {
  const s = line.trim();
  const body = s.startsWith('|') ? s.slice(1) : s;
  const trimmed = body.endsWith('|') ? body.slice(0, -1) : body;
  return trimmed.split('|').map((c) => c.trim());
}

/// 把单元格序列重新拼成一行表格文本（保留用户格式的宽松风格）。
export function joinTableRow(cells: string[]): string {
  return '| ' + cells.join(' | ') + ' |';
}

export type SourceTableOp =
  | { kind: 'add-row'; position: TablePos }
  | { kind: 'add-col'; position: TablePos }
  | { kind: 'delete-row' }
  | { kind: 'delete-col' }
  | { kind: 'delete-table' };

/// 对文本做一次表格操作，返回新文本；操作不适用时返回 null。
export function editSourceTable(text: string, cursor: number, op: SourceTableOp): string | null {
  const lines = text.split('\n');
  const cursorLine = text.slice(0, cursor).split('\n').length - 1;
  const range = locateSourceTable(lines, cursorLine);
  if (!range) return null;

  const rows: string[][] = [];
  for (let i = range.start; i <= range.end; i++) rows.push(splitTableRow(lines[i]));

  // 光标所在列：以光标行的字符偏移计算（光标在单元格内时都算该列）。
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
  const lineText = text.slice(lineStart, lineStart + lines[cursorLine].length);
  const beforeCells = splitTableRow(lineText.slice(0, cursor - lineStart + 1));
  const col = Math.min(Math.max(beforeCells.length - 1, 0), rows[0].length - 1);

  const colCount = rows[0].length;

  if (op.kind === 'add-row') {
    const localRow = cursorLine - range.start;
    // 表头（第 0 行）与分隔行（第 1 行）必须保持在最前，新数据行只能插到其后。
    let insertAt = op.position === 'before' ? localRow : localRow + 1;
    if (insertAt < 2) insertAt = 2;
    rows.splice(insertAt, 0, Array(colCount).fill(''));
  } else if (op.kind === 'add-col') {
    const insertAt = op.position === 'before' ? col : col + 1;
    for (const row of rows) row.splice(insertAt, 0, '');
  } else if (op.kind === 'delete-row') {
    const localRow = cursorLine - range.start;
    // 表头（第 0 行）与分隔行（第 1 行）不可删，删掉会破坏表格结构。
    if (localRow <= 1) return null;
    rows.splice(localRow, 1);
  } else if (op.kind === 'delete-col') {
    if (colCount <= 1) return null;
    for (const row of rows) row.splice(col, 1);
  } else if (op.kind === 'delete-table') {
    const start = text.split('\n').slice(0, range.start).join('\n');
    const end = text
      .split('\n')
      .slice(range.end + 1)
      .join('\n');
    return (start ? start + '\n' : '') + end;
  }

  const newLines = text.split('\n');
  newLines.splice(range.start, range.end - range.start + 1, ...rows.map(joinTableRow));
  return newLines.join('\n');
}

// ---- 所见即所得模式（ProseMirror 文档树）----

/// 找到光标所在的表格，返回表格节点、起始位置和 TableMap。
function currentTable(state: EditorState): TableRect | null {
  if (!isInTable(state)) return null;
  return selectedRect(state);
}

function tableAt(doc: Node, pos: number): Node | null {
  const resolved = doc.resolve(pos);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.spec.tableRole === 'table') return node;
  }
  return null;
}

/// 在编辑后的表里把光标放到 (row, col) 对应的单元格。
/// table 必须是编辑后新文档里的 table 节点，map 也是对它重新取的。
function placeCursor(tr: Transaction, tableStart: number, row: number, col: number): void {
  const table = tableAt(tr.doc, tableStart);
  if (!table) return;
  const map = TableMap.get(table);
  const cellStart = tableStart + map.positionAt(row, col, table);
  const resolved = tr.doc.resolve(cellStart);
  const inCell = cellAround(resolved);
  if (inCell) tr.setSelection(TextSelection.near(tr.doc.resolve(inCell.pos + 1)));
}

/// 在 WYSIWYG 模式插入一行/列。方向相对于光标所在行/列。
/// 返回 null 表示光标不在表格中。
export function addTableLine(
  state: EditorState,
  ctx: Ctx,
  kind: TableLineKind,
  position: TablePos,
): Transaction | null {
  const rect = currentTable(state);
  if (!rect) return null;

  const tr = state.tr;
  if (kind === 'row') {
    const { top, bottom } = rect;
    // rect.bottom 是排他边界：单元格选中时 bottom = top + 1。
    // 在表头行（top===0）上方插行会让数据行跑到表头前，违反 schema，退化为插到表头下方。
    const beforeHeader = position === 'before' && top === 0;
    const targetRow = position === 'before' ? top : bottom;
    addRowWithAlignment(ctx, tr, rect, beforeHeader ? 1 : targetRow);
    const newRow = beforeHeader ? 1 : position === 'before' ? top : bottom;
    placeCursor(tr, rect.tableStart, newRow, rect.left);
  } else {
    const { left, right } = rect;
    const targetCol = position === 'before' ? left : right;
    addColumn(tr, rect, targetCol);
    const newCol = position === 'before' ? left : right;
    placeCursor(tr, rect.tableStart, rect.top, newCol);
  }
  return tr;
}

/// 在 WYSIWYG 模式删除一行/列，并保证表格符合 table_header_row table_row+ 约束：
/// 表头行不能删，删到最后一行数据时直接删除整张表。
/// 返回 null 表示无法操作（如光标不在表格、表头行、单列表格）。
export function deleteTableLine(state: EditorState, kind: TableLineKind): Transaction | null {
  const rect = currentTable(state);
  if (!rect) return null;

  const { table, map, tableStart } = rect;
  const tr = state.tr;

  if (kind === 'row') {
    const { top } = rect;
    const rowCount = map.height;
    // 表头行（第一行）不能删。
    if (top === 0) return null;
    if (rowCount <= 2) {
      // 只有表头 + 1 行数据：删掉这行后表格只剩表头，违反 schema。
      const tableEnd = tableStart + table.nodeSize;
      tr.delete(tableStart, tableEnd);
      tr.setSelection(TextSelection.near(tr.doc.resolve(tableStart)));
      return tr;
    }
    removeRow(tr, rect, top);
    return tr;
  }

  const width = map.width;
  if (width <= 1) return null;
  removeColumn(tr, rect, rect.left);
  return tr;
}

/// 在 WYSIWYG 模式删除光标所在表格。
/// 返回 null 表示光标不在表格中。
export function deleteTableAt(state: EditorState): Transaction | null {
  if (!isInTable(state)) return null;
  let result: Transaction | null = null;
  const ok = deleteTable(state, (tr) => {
    result = tr;
  });
  return ok ? result : null;
}
