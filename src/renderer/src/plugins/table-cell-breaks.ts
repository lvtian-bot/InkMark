import { $remark } from '@milkdown/kit/utils';
import { hardbreakSchema } from '@milkdown/kit/preset/commonmark';
import { CELL_BREAK_FLAG, type MdastNode } from '../../../shared/markdown-breaks';

// 表格单元格内换行的双向打通。
//
// GFM 管道表格一行就是一行，单元格内容放不下真实换行符，格内换行唯一的
// 标准写法是行内 HTML `<br>`（GitHub/Obsidian/Typora 通用）。此前两个方向都是断的：
// - 解析：Milkdown commonmark 预设的 remark-preserve-empty-line 会把所有值为
//   `<br>` 的 html 节点当空行占位删除，外部文档单元格里的 `<br>` 打开即被吞并；
// - 序列化：格内硬换行（Shift+Enter）经 remark 输出为裸换行，直接把表格行撕成
//   两行，保存即破坏表格结构。
//
// 方案：格内换行统一以 `<br>` 落盘。
// - 解析方向（cellBrRemark）：把单元格子树内的 `<br>` html 节点转成硬换行 break
//   节点，并打上 CELL_BREAK_FLAG。remark 变换按注册顺序执行，本插件必须在
//   commonmark 之前注册（Editor.tsx），先于 preserve-empty-line 的删除抢救出 `<br>`；
//   标记让后续的 transformBreaksInTree 不按软换行设置改写它。
// - 序列化方向（cellAwareHardbreak）：通过 extendSchema 覆盖 hardbreak 的
//   toMarkdown runner，利用序列化栈（state.elements）判断是否位于单元格内：
//   在格内输出 `<br>` html 节点（带标记，见 dropBrPlaceholderHandler 的放行），
//   格外维持原逻辑（宽松 `\n` / 严格 `\\\n`）。

const CELL_BR_PATTERN = /^<br\s*\/?>$/i;

function isCellBrHtml(node: MdastNode): boolean {
  return (
    node.type === 'html' &&
    typeof node.value === 'string' &&
    CELL_BR_PATTERN.test(node.value.trim())
  );
}

/// 把表格单元格子树内的 `<br>` html 节点就地替换为带标记的硬换行节点。
export function transformCellBrInTree(tree: MdastNode): void {
  function visitCell(node: MdastNode): void {
    if (!node.children || !Array.isArray(node.children)) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (isCellBrHtml(child)) {
        node.children.splice(i, 1, {
          type: 'break',
          data: { isInline: false, [CELL_BREAK_FLAG]: true },
        });
        continue;
      }
      visitCell(child);
    }
  }

  function walk(node: MdastNode): void {
    if (!node.children || !Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (child.type === 'tableCell') visitCell(child);
      else walk(child);
    }
  }

  walk(tree);
}

export const cellBrRemark = [...$remark('inkmark-cell-br', () => () => transformCellBrInTree)];

/// Milkdown 序列化状态的最小结构投影： SerializerState 继承的 Stack 暴露
/// elements 数组，元素带 type。真实状态在结构上兼容此接口。
interface SerializerStateLike {
  readonly elements?: ReadonlyArray<{ type?: string }>;
}

function isInTableCell(state: unknown): boolean {
  const elements = (state as SerializerStateLike | undefined)?.elements;
  if (!Array.isArray(elements)) return false;
  // 栈上元素用的是 mdast 类型名：gfm 的 table_cell 与 table_header 序列化时都
  // openNode("tableCell")，表头格与数据格同名。
  return elements.some((el) => el?.type === 'tableCell');
}

export const cellAwareHardbreak = hardbreakSchema.extendSchema((originalFactory) => (ctx) => {
  const spec = originalFactory(ctx);
  return {
    ...spec,
    toMarkdown: {
      match: spec.toMarkdown.match,
      runner: (state, node) => {
        if (isInTableCell(state)) {
          state.addNode('html', undefined, '<br>', { data: { [CELL_BREAK_FLAG]: true } });
          return;
        }
        spec.toMarkdown.runner(state, node);
      },
    },
  };
});
