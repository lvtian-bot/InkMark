// Markdown mdast 树的换行语义变换：把文本值里的裸换行拆分为 break 节点，
// 并按换行设置统一标注 isInline（渲染层据此决定 <br> 还是空格）。
//
// 背景：mdast 规范里 break 节点只表示「硬换行」（行尾两空格或反斜杠），
// 段内单回车（软换行）保留为文本值中的 \n。编辑器与导出都按本设置把
// 软换行提升为 break 节点，才能让两种场景的换行表现一致。
// 本模块是纯逻辑（主进程 / 渲染进程共用），无 DOM 与 store 依赖。

export interface MdastNode {
  type: string;
  value?: string;
  data?: unknown;
  children?: MdastNode[];
}

// 单元格内显式换行的 data 标记。GFM 管道表格一格只有一行，格内换行唯一的
// 标准写法就是 <br>（GitHub/Obsidian/Typora 通用），它是用户主动要求的换行，
// 语义上等价于硬换行：宽松/严格换行设置都不应把它降级为空格。
export const CELL_BREAK_FLAG = 'inkmarkCellBreak';

/// 节点是否带单元格换行标记。
export function isCellBreakNode(node: { data?: unknown } | undefined | null): boolean {
  if (!node || typeof node.data !== 'object' || node.data === null) return false;
  return (node.data as Record<string, unknown>)[CELL_BREAK_FLAG] === true;
}

/**
 * 根据 strictLineBreaks 设置调整 mdast 树中 break 节点的 isInline 属性，
 * 并处理任何未切分的文本换行。带单元格换行标记的 break 是显式硬换行，跳过不改写。
 */
export function transformBreaksInTree(tree: MdastNode, strictLineBreaks: boolean): void {
  function walk(parent: MdastNode): void {
    if (!parent.children || !Array.isArray(parent.children)) return;

    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];

      if (child.type === 'break') {
        if (isCellBreakNode(child)) continue;
        const dataObj =
          child.data && typeof child.data === 'object'
            ? (child.data as Record<string, unknown>)
            : {};
        dataObj.isInline = strictLineBreaks;
        child.data = dataObj;
      } else if (
        child.type === 'text' &&
        typeof child.value === 'string' &&
        child.value.includes('\n')
      ) {
        const lines = child.value.split(/\r?\n/);
        const replacements: MdastNode[] = [];
        for (let j = 0; j < lines.length; j++) {
          if (j > 0) {
            replacements.push({ type: 'break', data: { isInline: strictLineBreaks } });
          }
          if (lines[j].length > 0) {
            replacements.push({ type: 'text', value: lines[j] });
          }
        }
        if (replacements.length > 0) {
          parent.children.splice(i, 1, ...replacements);
          i += replacements.length - 1;
        }
      } else if (child.children) {
        walk(child);
      }
    }
  }

  walk(tree);
}
