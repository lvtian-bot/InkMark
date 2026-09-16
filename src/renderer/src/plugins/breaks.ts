import { $remark } from '@milkdown/kit/utils';
import { transformBreaksInTree, type MdastNode } from '../../../shared/markdown-breaks';

/// 宽松换行支持。
///
/// 背景：在标准 CommonMark 规范中，段落内的单次回车属于「软换行」，在 HTML 中渲染为空格；
/// 只有段落间空行或行末加两个空格/反斜杠才换行。
/// 但在日常使用（如查看 AI 生成的文档、从聊天软件复制、或对齐 Obsidian 默认行为）中，
/// 用户习惯单次回车即换行（宽松换行），InkMark 全局采用该语义。
///
/// Milkdown 内置的 remarkLineBreak 插件会将 '\n' 解析为带 `data: { isInline: true }` 的 break 节点，
/// 并通过 hardbreakSchema 的 toDOM 渲染为 `<span data-type="hardbreak"> </span>`（即空格）。
/// 本插件在解析阶段把 break 节点的 isInline 统一改为 false，使 hardbreak 渲染为 `<br>` 换行。

export { transformBreaksInTree } from '../../../shared/markdown-breaks';
export type { MdastNode } from '../../../shared/markdown-breaks';

export const breaksAttacher =
  () =>
  (tree: MdastNode): void => {
    transformBreaksInTree(tree);
  };

const remarkBreaksPlugin = $remark('remark-breaks', () => breaksAttacher);

export const breaks = [...remarkBreaksPlugin];
