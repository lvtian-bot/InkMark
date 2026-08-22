import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { liftListItem } from '@milkdown/kit/prose/schema-list';
import { listItemSchema } from '@milkdown/kit/preset/commonmark';

const listKeymapKey = new PluginKey('inkmark-list-keymap');

/// 判定「列表项行首 Backspace」是否改为提升出列表，而非走默认的合并到前一项。
///
/// Milkdown commonmark 的 `listItemKeymap` 把 Backspace/Delete 绑到
/// `liftFirstListItem → joinBackward`：在非第一项位置，joinBackward 会把当前项
/// 合并进前一项末尾。这与主流所见即所得编辑器（Word、Google Docs、Typora、Notion）
/// 的两步退格惯例不符——惯例是第一次退格先去掉列表标记（该项变普通段落、光标留在
/// 当前行），第二次退格才删除该行。直接合并还让「想退出列表继续写正文」的高频操作
/// 变成光标飞进上一项。任务项此前已因合并继承前一项 `checked` 的串台 bug 率先改为
/// lift（见 git 历史），本插件把同样的行为推广到普通无序/有序列表项，同时统一两类
/// 列表的编辑体验。
///
/// 抽成不依赖 ProseMirror view/DOM 的纯函数，便于单测。
export interface ListItemBackspaceInput {
  readonly key: string;
  readonly hasModifier: boolean;
  readonly selectionEmpty: boolean;
  readonly parentOffset: number;
  /// 最近祖先是否为 list_item；false 表示光标不在列表项（普通段落等）。
  readonly inListItem: boolean;
  /// 光标所在块是否为该 list_item 的第一个子块。松散列表项可含多个块，在后续块
  /// 行首退格应走默认的合并到项内上一块，不能把整个列表项提升出去。
  readonly atFirstBlockInItem: boolean;
}

export function shouldLiftListItemOnBackspace(input: ListItemBackspaceInput): boolean {
  return (
    input.key === 'Backspace' &&
    !input.hasModifier &&
    input.selectionEmpty &&
    input.parentOffset === 0 &&
    input.inListItem &&
    input.atFirstBlockInItem
  );
}

/// ProseMirror ResolvedPos / Node 的最小结构投影，避免直接导入这两个类型
/// （Milkdown 的 kit 入口未稳定导出 `ResolvedPos`）。真实 ResolvedPos / Node 在
/// 结构上兼容这两个接口，可作为 `$from` / 列表项节点的最小契约。
interface ResolvedPosLike {
  readonly depth: number;
  readonly pos: number;
  readonly parentOffset: number;
  node(depth: number): ListItemNodeLike;
  start(depth: number): number;
}

interface ListItemNodeLike {
  readonly type: unknown;
  readonly attrs: Record<string, unknown>;
  readonly textContent: string;
}

interface ListItemAtCursor {
  depth: number;
  node: ListItemNodeLike;
}

/// Plugin: rewrite Backspace/Delete at the start of a list item.
///
/// Milkdown's commonmark `listItemKeymap` binds Backspace and Delete to
/// `LiftFirstListItem` (→ `joinBackward`), which merges the current item into
/// the previous one.  Two interception rules restore the mainstream
/// backspace-out-of-list behaviour:
///
/// - **Backspace at the start of a list item's first block** → lift the item
///   out of the list (`liftListItem`).  In a nested list this promotes the item
///   one level up; at the top level it becomes a regular paragraph (the marker
///   disappears, the cursor stays on the line).  This matches the
///   "remove the marker first, delete the line on the next press" convention
///   of Word/Google Docs/Typora/Notion, and keeps task lists and plain lists
///   consistent.  If `liftListItem` cannot apply (rare), fall through to the
///   default keymap.
/// - **Delete at the start of a non-empty *task* item** → delete the first
///   character instead of lifting/joining, so Delete does what the user
///   expects: erase the character to the right (joining would inherit the
///   previous item's `checked` and silently flip this task's state).  Empty
///   task items and plain list items keep the built-in behaviour.
export const listKeymapPlugin = $prose((ctx) => {
  const listItemType = listItemSchema.type(ctx);

  // Walk up to the nearest list_item ancestor of `$from`; return its depth and
  // node, or null when the cursor is not inside a list item.
  const findListItem = ($from: ResolvedPosLike): ListItemAtCursor | null => {
    for (let depth = $from.depth; depth > 0; depth--) {
      const n = $from.node(depth);
      if (n.type === listItemType) return { depth, node: n };
    }
    return null;
  };

  return new Plugin({
    key: listKeymapKey,
    props: {
      handleKeyDown(view, event) {
        const hasModifier = event.ctrlKey || event.metaKey || event.altKey;

        if (event.key === 'Backspace') {
          if (!(view.state.selection instanceof TextSelection)) return false;
          const { selection } = view.state;
          const { $from } = selection;
          const item = findListItem($from);
          if (
            shouldLiftListItemOnBackspace({
              key: event.key,
              hasModifier,
              selectionEmpty: selection.empty,
              parentOffset: $from.parentOffset,
              inListItem: item != null,
              atFirstBlockInItem:
                item != null && $from.pos - $from.parentOffset === $from.start(item.depth),
            })
          ) {
            // Lift the item out of the list. On success a top-level item
            // becomes a regular paragraph and the marker disappears. If lift
            // cannot apply, return false and let the default keymap handle it.
            const dispatched = liftListItem(listItemType)(view.state, (tr) => {
              view.dispatch(tr.scrollIntoView());
            });
            return dispatched;
          }
          return false;
        }

        if (event.key === 'Delete') {
          // Only plain presses (no modifier that changes meaning) are ours.
          if (hasModifier) return false;

          const { selection } = view.state;
          if (!selection.empty) return false;

          const { $from } = selection;
          // At the very start of the list item's paragraph.
          if ($from.parentOffset !== 0) return false;

          const item = findListItem($from);
          // Only override *task* items (checked != null). Leave plain lists alone.
          if (!item || (item.node.attrs.checked as boolean | null) == null) return false;
          // Empty task item: let the built-in keymap handle the lift.
          if (item.node.textContent.length === 0) return false;

          // Cursor is at the paragraph's first position and the item has text:
          // delete the first character to the right instead of lifting the whole
          // list item (which would otherwise inherit the preceding item's
          // `checked` attr and silently flip this task to done/undone).
          const tr = view.state.tr.delete($from.pos, $from.pos + 1).scrollIntoView();
          view.dispatch(tr);
          return true;
        }

        return false;
      },
    },
  });
});

export const listKeymap = [listKeymapPlugin];
