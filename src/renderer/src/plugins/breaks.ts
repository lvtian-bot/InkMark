import { $remark } from '@milkdown/kit/utils';
import { useStore } from '../stores/useStore';

/// 宽松换行与严格换行支持。
///
/// 背景：在标准 CommonMark 规范中，段落内的单次回车属于「软换行」，在 HTML 中渲染为空格；
/// 只有段落间空行或行末加两个空格/反斜杠才换行。
/// 但在日常使用（如查看 AI 生成的文档、从聊天软件复制、或对齐 Obsidian 默认行为）中，
/// 用户习惯单次回车即换行（宽松换行）。
///
/// Milkdown 内置的 remarkLineBreak 插件会将 '\n' 解析为带 `data: { isInline: true }` 的 break 节点，
/// 并通过 hardbreakSchema 的 toDOM 渲染为 `<span data-type="hardbreak"> </span>`（即空格）。
/// 本插件在解析阶段根据 strictLineBreaks 设置调整 break 节点的 isInline 属性：
/// - strictLineBreaks: false（默认，宽松换行）：将 isInline 设为 false，使 hardbreak 渲染为 `<br>` 换行。
/// - strictLineBreaks: true（严格换行）：保持 isInline 为 true，遵循标准 CommonMark 渲染为空格。

export interface MdastNode {
  type: string;
  value?: string;
  data?: unknown;
  children?: MdastNode[];
}

/**
 * 根据 strictLineBreaks 设置调整 mdast 树中 break 节点的 isInline 属性，
 * 并处理任何未切分的文本换行。
 */
export function transformBreaksInTree(tree: MdastNode, strictLineBreaks: boolean): void {
  function walk(parent: MdastNode): void {
    if (!parent.children || !Array.isArray(parent.children)) return;

    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];

      if (child.type === 'break') {
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

export const breaksTransformer = (tree: MdastNode): void => {
  const strict = useStore.getState().strictLineBreaks;
  transformBreaksInTree(tree, strict);
};

export const breaksAttacher = () => breaksTransformer;

const remarkBreaksPlugin = $remark('remark-breaks', () => breaksAttacher);

export const breaks = [...remarkBreaksPlugin];
