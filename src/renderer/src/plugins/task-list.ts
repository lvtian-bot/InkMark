import { $command } from '@milkdown/kit/utils';
import { wrapIn } from '@milkdown/kit/prose/commands';
import { listItemSchema, bulletListSchema } from '@milkdown/kit/preset/commonmark';
import type { Transaction } from '@milkdown/kit/prose/state';
import { taskListCheckboxPlugin } from './task-list-view';

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

/// 任务项的行首 Backspace/Delete 改写已移至 `list-keymap.ts`，随普通列表项一并处理。

export const taskList = [wrapInTaskListCommand, taskListCheckboxPlugin];
