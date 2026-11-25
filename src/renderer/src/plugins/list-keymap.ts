import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { liftListItem } from '@milkdown/kit/prose/schema-list';
import { listItemSchema } from '@milkdown/kit/preset/commonmark';
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model';

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

interface ListItemAtCursor {
  depth: number;
  node: ProseNode;
}

// 列表项退格退出一级，Delete 删除光标右侧内容；有子项的父项末尾回车进入子列表。
export const listKeymapPlugin = $prose((ctx) => {
  const listItemType = listItemSchema.type(ctx);

  // Walk up to the nearest list_item ancestor of `$from`; return its depth and
  // node, or null when the cursor is not inside a list item.
  const findListItem = ($from: ResolvedPos): ListItemAtCursor | null => {
    for (let depth = $from.depth; depth > 0; depth--) {
      const n = $from.node(depth);
      if (n.type === listItemType) return { depth, node: n };
    }
    return null;
  };

  const findNestedList = (item: ProseNode): { node: ProseNode; offset: number } | null => {
    let offset = 0;
    for (let index = 0; index < item.childCount; index += 1) {
      const child = item.child(index);
      if (child.type.name === 'bullet_list' || child.type.name === 'ordered_list') {
        return { node: child, offset };
      }
      offset += child.nodeSize;
    }
    return null;
  };

  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

  return new Plugin({
    key: listKeymapKey,
    props: {
      handleKeyDown(view, event) {
        if (!view.editable) return false;
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
              atFirstBlockInItem: item != null && $from.index(item.depth) === 0,
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

        if (event.key === 'Enter') {
          if (hasModifier || event.shiftKey) return false;
          if (!(view.state.selection instanceof TextSelection)) return false;

          const { selection } = view.state;
          if (!selection.empty) return false;

          const { $from } = selection;
          if ($from.parentOffset !== $from.parent.content.size) return false;

          const item = findListItem($from);
          if (!item || $from.index(item.depth) !== 0) return false;

          const nestedList = findNestedList(item.node);
          if (!nestedList) return false;

          const firstItemAttrs =
            nestedList.node.childCount > 0 ? nestedList.node.child(0).attrs : undefined;
          const attrs = firstItemAttrs
            ? {
                ...firstItemAttrs,
                // A newly created task is always open. Never copy a checked
                // state from the first existing child into a new item.
                checked: firstItemAttrs.checked == null ? null : false,
              }
            : undefined;
          const newItem = listItemType.createAndFill(attrs);
          if (!newItem) return false;

          // `$from.start(item.depth)` points just inside the list item. Add the
          // nested item's opening position and the offset of its list node.
          // Inserting at the list content start keeps existing children under
          // the same parent and puts the caret in the new first child.
          const nestedListPos = $from.start(item.depth) + nestedList.offset;
          const insertPos = nestedListPos + 1;
          const tr = view.state.tr.insert(insertPos, newItem);
          tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 2)));
          view.dispatch(tr.scrollIntoView());
          return true;
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
          // Keep Delete's ordinary character semantics for every list type.
          // The built-in list keymap treats Delete at item start like
          // Backspace, which can merge the item into the previous one.
          if (!item || $from.index(item.depth) !== 0) return false;

          const firstChild = $from.parent.firstChild;
          if (!firstChild) return false;
          const deleteLength = firstChild.isText
            ? (graphemes
                .segment($from.parent.textBetween(0, $from.parent.content.size, '', '\uFFFC'))
                .containing(0)?.segment.length ?? 0)
            : firstChild.nodeSize;
          if (deleteLength === 0) return false;

          // Delete one complete grapheme to the right. This preserves the
          // current item and task state for emoji, combining marks, and CJK
          // characters represented by more than one UTF-16 code unit.
          const tr = view.state.tr.delete($from.pos, $from.pos + deleteLength).scrollIntoView();
          view.dispatch(tr);
          return true;
        }

        return false;
      },
    },
  });
});

export const listKeymap = [listKeymapPlugin];
