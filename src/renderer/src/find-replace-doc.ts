import type { EditorState as ProseMirrorEditorState } from '@milkdown/kit/prose/state';
import { findLiteralMatches, type TextMatch } from './find-replace';

/**
 * 在 ProseMirror 文档中查找所有命中 `query` 的位置，返回绝对文档位置区间。
 *
 * 设计要点：
 * - 只遍历 textblock（段落/标题/单元格/代码块等），块与块之间不跨越匹配。
 * - textblock 内部把**位置连续相邻**的文本节点拼成一段再匹配（ProseMirror 位置无法直接
 *   在字符串上 indexOf）。位置不连续（中间夹了 hard_break / image / 行内原子节点等）
 *   时断开成新段，避免跨节点边界产生虚假匹配。
 * - 仅按 mark（加粗/斜体/行内代码/链接等）区分的相邻文本节点位置是连续的，会被拼进同一段——
 *   这与大多数所见即所得编辑器一致：按正文文本内容匹配，不受行内格式切分影响。
 *
 * 返回的 from/to 是 UTF-16 偏移（与 CodeMirror 一致），可直接用于 ProseMirror 选区与装饰。
 */
export function findTextMatchesInDocument(
  doc: ProseMirrorEditorState['doc'],
  query: string,
): TextMatch[] {
  if (!query) return [];

  const matches: TextMatch[] = [];

  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true;

    let segmentText = '';
    let positions: number[] = [];
    let expectedNextPos: number | null = null;

    const flushSegment = (): void => {
      for (const match of findLiteralMatches(segmentText, query)) {
        const from = positions[match.from];
        const lastPosition = positions[match.to - 1];
        if (from !== undefined && lastPosition !== undefined) {
          matches.push({ from, to: lastPosition + 1 });
        }
      }
      segmentText = '';
      positions = [];
      expectedNextPos = null;
    };

    block.descendants((child, relativePos) => {
      if (!child.isText || !child.text) return true;

      const absolutePos = blockPos + 1 + relativePos;
      if (expectedNextPos !== null && absolutePos !== expectedNextPos) flushSegment();

      segmentText += child.text;
      for (let index = 0; index < child.text.length; index += 1) {
        positions.push(absolutePos + index);
      }
      expectedNextPos = absolutePos + child.nodeSize;
      return false;
    });

    flushSegment();
    return false;
  });

  return matches;
}
