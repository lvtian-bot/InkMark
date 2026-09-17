import { serializerCtx } from '@milkdown/kit/core';
import { DOMSerializer, type Node as ProseNode, type Schema } from '@milkdown/kit/prose/model';
import { type EditorState, NodeSelection, Plugin, PluginKey } from '@milkdown/kit/prose/state';
import {
  CellSelection,
  TableMap,
  findTable,
  selectedRect,
  selectionCell,
} from '@milkdown/kit/prose/tables';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export interface TableRectInfo {
  top: number;
  bottom: number;
  left: number;
  right: number;
  map: TableMap;
  table: ProseNode;
  tableStart: number;
}

/**
 * 将单个表格单元格内的 Markdown 文本安全转义：
 * - 内部换行转为 <br>（表格单元格标准）
 * - 转义非代码块内的未转义管道符 | 为 \|
 */
export function escapeTableCellMarkdown(text: string): string {
  const withBrs = text.replace(/\r?\n/g, '<br>');
  const parts = withBrs.split(/(`+[^`]+`+)/g);
  return parts
    .map((part, index) => {
      // 奇数项为行内代码片段，保留原样
      if (index % 2 === 1) return part;
      // 偶数项为普通文本，转义未转义的管道符
      return part.replace(/(?<!\\)\|/g, '\\|');
    })
    .join('');
}

/**
 * 格式化输出标准的 GFM Markdown 表格
 */
export function formatMarkdownTable(
  headers: string[],
  alignments: (string | null)[],
  rows: string[][],
): string {
  const delimiters = alignments.map((align) => {
    if (align === 'center') return ':---:';
    if (align === 'right') return '---:';
    return '---';
  });

  const headerLine = `| ${headers.map(escapeTableCellMarkdown).join(' | ')} |`;
  const delimiterLine = `| ${delimiters.join(' | ')} |`;
  const dataLines = rows.map((row) => `| ${row.map(escapeTableCellMarkdown).join(' | ')} |`);

  return [headerLine, delimiterLine, ...dataLines].join('\n') + '\n';
}

/**
 * 格式化输出 HTML 表格（供 Excel、Word、飞书等外部应用粘贴）
 */
export function formatHtmlTable(
  rows: { isHeader: boolean; cells: { html: string; align?: string | null }[] }[],
): string {
  const trs = rows.map((r) => {
    const tag = r.isHeader ? 'th' : 'td';
    const cellsHtml = r.cells
      .map((c) => {
        const alignStyle = c.align ? ` style="text-align: ${c.align};"` : '';
        return `<${tag}${alignStyle}>${c.html}</${tag}>`;
      })
      .join('');
    return `<tr>${cellsHtml}</tr>`;
  });

  return `<table><tbody>${trs.join('')}</tbody></table>`;
}

/**
 * 将单个单元格内容序列化为 Markdown 字符串
 */
export function serializeTableCellToMarkdown(
  cell: ProseNode,
  schema: Schema,
  serializer: (doc: ProseNode) => string,
): string {
  if (cell.content.size === 0) return '';
  const doc = schema.topNodeType.create(null, cell.content);
  return serializer(doc).trim().replace(/\r?\n/g, '<br>');
}

/**
 * 根据表格矩形区域序列化为 Markdown 与 HTML
 */
export function serializeTableRect(
  rectInfo: TableRectInfo,
  schema: Schema,
  serializer: (doc: ProseNode) => string,
): { text: string; html: string } | null {
  const { top, bottom, left, right, map, table } = rectInfo;
  const numRows = bottom - top;
  const numCols = right - left;
  if (numRows <= 0 || numCols <= 0) return null;

  const domSerializer = DOMSerializer.fromSchema(schema);

  // 单个单元格选中：直接输出单元格内容，不生成表格包装
  if (numRows === 1 && numCols === 1) {
    const pos = map.positionAt(top, left, table);
    const cell = table.nodeAt(pos);
    if (!cell) return null;
    const text = serializeTableCellToMarkdown(cell, schema, serializer);
    const dom = domSerializer.serializeNode(cell) as HTMLElement;
    const html = dom.innerHTML || dom.outerHTML;
    return { text, html };
  }

  // 提取各列对齐方式（优先从表头行 0 获取）
  const alignments: (string | null)[] = [];
  for (let c = left; c < right; c++) {
    const headerPos = map.positionAt(0, c, table);
    const headerCell = table.nodeAt(headerPos);
    alignments.push((headerCell?.attrs.alignment as string | null) ?? null);
  }

  // 提取单元格矩阵
  const matrix: string[][] = [];
  const htmlRows: { isHeader: boolean; cells: { html: string; align?: string | null }[] }[] = [];

  for (let r = top; r < bottom; r++) {
    const isHeaderRow = r === 0;
    const rowStrings: string[] = [];
    const htmlCells: { html: string; align?: string | null }[] = [];

    for (let c = left; c < right; c++) {
      const pos = map.positionAt(r, c, table);
      const cell = table.nodeAt(pos);
      if (cell) {
        rowStrings.push(serializeTableCellToMarkdown(cell, schema, serializer));
        const cellDOM = domSerializer.serializeNode(cell) as HTMLElement;
        htmlCells.push({
          html: cellDOM.innerHTML,
          align: (cell.attrs.alignment as string | null) ?? alignments[c - left],
        });
      } else {
        rowStrings.push('');
        htmlCells.push({ html: '', align: alignments[c - left] });
      }
    }
    matrix.push(rowStrings);
    htmlRows.push({ isHeader: isHeaderRow, cells: htmlCells });
  }

  // 构建 Markdown 表格
  let headers: string[];
  let dataRows: string[][];

  if (top === 0) {
    headers = matrix[0];
    dataRows = matrix.slice(1);
  } else {
    // 选区不包含表头行时，从原表第 0 行提取对应列的真实表头
    headers = [];
    for (let c = left; c < right; c++) {
      const pos = map.positionAt(0, c, table);
      const cell = table.nodeAt(pos);
      headers.push(cell ? serializeTableCellToMarkdown(cell, schema, serializer) : '');
    }
    dataRows = matrix;
  }

  const text = formatMarkdownTable(headers, alignments, dataRows);
  const html = formatHtmlTable(htmlRows);

  return { text, html };
}

/**
 * 序列化当前的表格选区（CellSelection 或 Table NodeSelection）
 */
export function serializeTableSelection(
  state: EditorState,
  serializer: (doc: ProseNode) => string,
): { text: string; html: string } | null {
  const { selection } = state;

  if (selection instanceof CellSelection) {
    const rectInfo = selectedRect(state);
    return serializeTableRect(rectInfo, state.schema, serializer);
  }

  if (selection instanceof NodeSelection && selection.node.type.name === 'table') {
    const table = selection.node;
    const map = TableMap.get(table);
    const rectInfo: TableRectInfo = {
      top: 0,
      bottom: map.height,
      left: 0,
      right: map.width,
      map,
      table,
      tableStart: selection.from,
    };
    return serializeTableRect(rectInfo, state.schema, serializer);
  }

  return null;
}

/**
 * 统一写入系统剪贴板（优先尝试同时写入 text/plain 与 text/html）
 */
export async function writeTableToClipboard(text: string, html: string): Promise<void> {
  try {
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const item = new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      });
      await navigator.clipboard.write([item]);
      return;
    }
  } catch (err) {
    console.warn('navigator.clipboard.write failed, falling back to copyText', err);
  }
  await window.inkmark.copyText(text);
}

/**
 * 复制指定位置（或当前光标所在）的整张表格
 */
export async function copyTableAtPos(
  view: EditorView,
  serializer: (doc: ProseNode) => string,
  pos?: number,
): Promise<boolean> {
  const $pos =
    pos != null
      ? view.state.doc.resolve(pos)
      : (selectionCell(view.state) ?? view.state.selection.$from);
  const tableNode = findTable($pos);
  if (!tableNode) return false;

  const map = TableMap.get(tableNode.node);
  const rectInfo: TableRectInfo = {
    top: 0,
    bottom: map.height,
    left: 0,
    right: map.width,
    map,
    table: tableNode.node,
    tableStart: tableNode.start,
  };

  const result = serializeTableRect(rectInfo, view.state.schema, serializer);
  if (!result) return false;

  await writeTableToClipboard(result.text, result.html);
  return true;
}

/**
 * 选中指定位置（或当前光标所在）的整张表格
 */
export function selectTableAtPos(view: EditorView, pos?: number): boolean {
  const $pos =
    pos != null
      ? view.state.doc.resolve(pos)
      : (selectionCell(view.state) ?? view.state.selection.$from);
  const tableNode = findTable($pos);
  if (!tableNode) return false;

  const map = TableMap.get(tableNode.node);
  if (map.height === 0 || map.width === 0) return false;

  const firstPos = tableNode.start + map.positionAt(0, 0, tableNode.node);
  const lastPos = tableNode.start + map.positionAt(map.height - 1, map.width - 1, tableNode.node);

  const $firstCell = view.state.doc.resolve(firstPos);
  const $lastCell = view.state.doc.resolve(lastPos);

  const selection = new CellSelection($lastCell, $firstCell);
  view.dispatch(view.state.tr.setSelection(selection));
  view.focus();
  return true;
}

export const tableCopyPluginKey = new PluginKey('inkmark-table-copy');

/**
 * 表格剪贴板复制/剪切增强插件：
 * 拦截 CellSelection 与 Table NodeSelection，按标准 GFM Markdown 与 HTML 写入剪贴板
 */
export const tableCopyPlugin = $prose((ctx) => {
  return new Plugin({
    key: tableCopyPluginKey,
    props: {
      handleDOMEvents: {
        copy: (view, event) => {
          const serializer = ctx.get(serializerCtx);
          const result = serializeTableSelection(view.state, serializer);
          if (!result) return false;

          const clipEvent = event as ClipboardEvent;
          if (clipEvent.clipboardData) {
            clipEvent.preventDefault();
            clipEvent.clipboardData.clearData();
            clipEvent.clipboardData.setData('text/html', result.html);
            clipEvent.clipboardData.setData('text/plain', result.text);
            return true;
          }
          return false;
        },
        cut: (view, event) => {
          const serializer = ctx.get(serializerCtx);
          const result = serializeTableSelection(view.state, serializer);
          if (!result) return false;

          const clipEvent = event as ClipboardEvent;
          if (clipEvent.clipboardData) {
            clipEvent.preventDefault();
            clipEvent.clipboardData.clearData();
            clipEvent.clipboardData.setData('text/html', result.html);
            clipEvent.clipboardData.setData('text/plain', result.text);
            view.dispatch(
              view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'),
            );
            return true;
          }
          return false;
        },
      },
    },
  });
});
