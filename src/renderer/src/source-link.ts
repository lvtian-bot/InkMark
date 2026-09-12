import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { EditorState } from '@codemirror/state';

/**
 * 找出源码模式下点击位置所指链接的原始地址。
 * 覆盖两类节点：内联链接 `[文字](地址)` 的 Link 节点（取其中的 URL 子节点，
 * 引用式链接没有内联地址则不处理），以及裸地址与 `<地址>` 自动链接的 URL 节点。
 * 先按光标左侧、再按右侧解析，让点击落在链接边界上时也能命中。
 */
export function findLinkHrefAtPos(state: EditorState, pos: number): string | null {
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(pos, side);
    while (node) {
      if (node.name === 'URL') return state.sliceDoc(node.from, node.to);
      if (node.name === 'Link') {
        const url = node.getChild('URL');
        return url ? state.sliceDoc(url.from, url.to) : null;
      }
      node = node.parent;
    }
  }
  return null;
}
