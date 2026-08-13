import { $command, $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { wrapIn } from '@milkdown/kit/prose/commands';
import { liftListItem } from '@milkdown/kit/prose/schema-list';
import { listItemSchema, bulletListSchema } from '@milkdown/kit/preset/commonmark';
import type { Transaction } from '@milkdown/kit/prose/state';
import { taskListCheckboxPlugin } from './task-list-view';

const taskListKeymapKey = new PluginKey('inkmark-task-list-keymap');

/// 判定「任务项行首 Backspace」是否应改为提升出列表，而非走默认的合并到前一项。
///
/// 默认 keymap 把 Backspace/Delete 都绑到 `liftFirstListItem → joinBackward`：
/// 在非第一项位置，joinBackward 会把当前项合并到前一项，并由 `deleteBarrier` 继承
/// 前一项的 `checked`，于是「删一个未完成项时冒出已完成框」。改为对任务项走真正的
/// `liftListItem`（退出列表变普通段落），与空任务项 Enter 的行为一致，从源头绕过合并。
///
/// 抽成不依赖 ProseMirror view/DOM 的纯函数，便于单测。
export interface TaskItemBackspaceInput {
  readonly key: string;
  readonly hasModifier: boolean;
  readonly selectionEmpty: boolean;
  readonly parentOffset: number;
  /// 最近 list_item 祖先的 checked 属性；null 表示光标不在任务项（普通列表项或非列表）。
  readonly taskItemChecked: boolean | null;
}

export function shouldLiftTaskItemOnBackspace(input: TaskItemBackspaceInput): boolean {
  return (
    input.key === 'Backspace' &&
    !input.hasModifier &&
    input.selectionEmpty &&
    input.parentOffset === 0 &&
    input.taskItemChecked !== null
  );
}

/// ProseMirror ResolvedPos / Node 的最小结构投影，避免直接导入这两个类型
/// （Milkdown 的 kit 入口未稳定导出 `ResolvedPos`）。真实 ResolvedPos / Node 在
/// 结构上兼容这两个接口，可作为 `$from` / 列表项节点的最小契约。
interface ResolvedPosLike {
  readonly depth: number;
  node(depth: number): ListItemNodeLike;
}

interface ListItemNodeLike {
  readonly type: unknown;
  readonly attrs: Record<string, unknown>;
  readonly textContent: string;
}

/// Command: toggle the current block between task list and regular list.
///
/// - If cursor is in a regular list item, convert it to a task (checked: false).
/// - If cursor is in a task list item, convert it back to regular (checked: null).
/// - If cursor is not in a list, wrap in a bullet list and set checked: false.
export const wrapInTaskListCommand = $command(
  'WrapInTaskList',
  (ctx) => () => (state, dispatch) => {
    const listItemType = listItemSchema.type(ctx);
    const { $from } = state.selection;

    // Find list_item ancestor
    let listItemDepth = -1;
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type === listItemType) {
        listItemDepth = depth;
        break;
      }
    }

    if (listItemDepth > 0) {
      // Already in a list item – toggle task status
      const node = $from.node(listItemDepth);
      const pos = $from.before(listItemDepth);
      const newChecked = node.attrs.checked == null ? false : null;

      const tr = state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        checked: newChecked,
      });
      dispatch?.(tr);
      return true;
    }

    // Not in a list – wrap in bullet list, then set checked on the new item
    const bulletType = bulletListSchema.type(ctx);
    let success = false;

    wrapIn(bulletType)(state, (tr: Transaction) => {
      const newState = state.apply(tr);
      const $newFrom = newState.doc.resolve(newState.selection.from);

      for (let depth = $newFrom.depth; depth > 0; depth--) {
        const n = $newFrom.node(depth);
        if (n.type === listItemType) {
          const liPos = $newFrom.before(depth);
          tr.setNodeMarkup(liPos, undefined, {
            ...n.attrs,
            checked: false as boolean | null,
          });
          break;
        }
      }

      dispatch?.(tr);
      success = true;
    });

    return success;
  },
);

/// Plugin: rewrite Backspace/Delete at the start of a *task* list item.
///
/// Milkdown's commonmark `listItemKeymap` binds Backspace and Delete to
/// `LiftFirstListItem` (→ `joinBackward`).  In a GFM task list, when the cursor
/// is not in the first item, `joinBackward` merges the current item into the
/// previous one and `deleteBarrier` (`prosemirror-commands`) clones the
/// *previous* item's attrs — including `checked`.  The user pressing Backspace
/// to delete an empty task then watches an unrelated "done" checkbox appear.
///
/// Two interception rules, both scoped to task items only (`checked != null`),
/// leave plain (non-task) lists on the standard behaviour:
///
/// - **Backspace at the start of a task item** → lift the item out of the list
///   (`liftListItem`), turning it into a regular paragraph.  This matches the
///   "remove the checkbox" intent (same as pressing Enter in an empty task
///   item) and bypasses the merge that caused the attr inheritance.  If
///   `liftListItem` cannot apply (rare), fall through to the default keymap.
/// - **Delete at the start of a non-empty task item** → delete the first
///   character instead of lifting/joining, so Delete does what the user
///   expects: erase the character to the right.  Empty task items fall through
///   to the built-in lift.
export const taskListKeymapPlugin = $prose((ctx) => {
  const listItemType = listItemSchema.type(ctx);

  // Walk up to the nearest list_item ancestor of `$from`; return null when the
  // cursor is not inside a list item.
  const findListItemAncestor = ($from: ResolvedPosLike): ListItemNodeLike | null => {
    for (let depth = $from.depth; depth > 0; depth--) {
      const n = $from.node(depth);
      if (n.type === listItemType) return n;
    }
    return null;
  };

  return new Plugin({
    key: taskListKeymapKey,
    props: {
      handleKeyDown(view, event) {
        const hasModifier = event.ctrlKey || event.metaKey || event.altKey;

        if (event.key === 'Backspace') {
          const { selection } = view.state;
          const { $from } = selection;
          const item = findListItemAncestor($from);
          if (
            shouldLiftTaskItemOnBackspace({
              key: event.key,
              hasModifier,
              selectionEmpty: selection.empty,
              parentOffset: $from.parentOffset,
              taskItemChecked: item ? (item.attrs.checked as boolean | null) : null,
            })
          ) {
            // Lift the task item out of the list. On success the item becomes a
            // regular paragraph and the checkbox disappears. If lift cannot
            // apply, return false and let the default keymap handle it.
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

          const item = findListItemAncestor($from);
          // Only override *task* items (checked != null). Leave plain lists alone.
          if (!item || (item.attrs.checked as boolean | null) == null) return false;
          // Empty task item: let the built-in keymap handle the lift.
          if (item.textContent.length === 0) return false;

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

export const taskList = [wrapInTaskListCommand, taskListCheckboxPlugin, taskListKeymapPlugin];
