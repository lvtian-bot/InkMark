// 右键菜单「移除链接」的范围计算：从点击位置向两侧扩展出完整链接范围。
// 依赖 ProseMirror 的 model 类型，但只做纯计算，便于脱离编辑器实例测试。

import type { Mark, Node as ProseNode } from '@milkdown/kit/prose/model';

/**
 * 取 pos 右侧字符所属文本节点上指定类型的 mark。
 * 不用 ResolvedPos.marks()：link mark 是 inclusive 的，边界位置上它会
 * 向前包含前一个字符的 mark，导致相邻链接扩展时互相跨越。
 */
function linkMarkRightOf(doc: ProseNode, pos: number, markType: Mark['type']): Mark | null {
  try {
    const $pos = doc.resolve(pos);
    const node =
      $pos.textOffset > 0 ? $pos.parent.child($pos.index()) : $pos.parent.maybeChild($pos.index());
    if (!node || !node.isText) return null;
    return node.marks.find((mark) => mark.type === markType) ?? null;
  } catch {
    return null;
  }
}

/**
 * 求点击位置所在链接的完整范围 [from, to)。
 * 相邻链接按 mark 实例（href 不同即不同链接）区分，不会跨链接扩展；
 * 点击落在链接边缘（末字符之后）时也能找回整个链接；点击处无链接返回 null。
 */
export function expandToLinkBounds(
  doc: ProseNode,
  pos: number,
  markType: Mark['type'],
): { from: number; to: number } | null {
  const clamped = Math.min(Math.max(0, pos), doc.content.size);
  let target = linkMarkRightOf(doc, clamped, markType);
  let clickedRightEdge = false;
  if (!target) {
    target = linkMarkRightOf(doc, clamped - 1, markType);
    if (!target) return null;
    clickedRightEdge = true;
  }

  // 左边界：第一个带目标链接的字符位置；再向左扫到链接起点。
  let from = clickedRightEdge ? clamped - 1 : clamped;
  for (;;) {
    const mark = linkMarkRightOf(doc, from - 1, markType);
    if (!mark || !mark.eq(target)) break;
    from -= 1;
  }
  // 右边界：从起点向右扫过所有同链接字符，落到链接后第一个字符位置。
  let to = from;
  while (to < doc.content.size) {
    const mark = linkMarkRightOf(doc, to, markType);
    if (!mark || !mark.eq(target)) break;
    to += 1;
  }
  return { from, to };
}
