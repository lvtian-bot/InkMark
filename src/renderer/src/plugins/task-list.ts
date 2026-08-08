import { $command, $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { wrapIn } from '@milkdown/kit/prose/commands';
import { listItemSchema, bulletListSchema } from '@milkdown/kit/preset/commonmark';
import type { Transaction } from '@milkdown/kit/prose/state';

const taskListKey = new PluginKey('inkmark-task-list');

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

/// Plugin: click on the checkbox area to toggle task list item checked state.
///
/// Milkdown's GFM task list renders `<li data-item-type="task" data-checked="...">`
/// without an actual checkbox element.  This plugin intercepts clicks that land
/// in the list-marker padding area (where the CSS `::before` draws the checkbox)
/// and toggles the `checked` attribute.
export const taskListClickPlugin = $prose(() => {
  return new Plugin({
    key: taskListKey,
    props: {
      handleDOMEvents: {
        click(view, event) {
          const target = event.target as HTMLElement | null;
          if (!target) return false;

          const taskLi = target.closest('li[data-item-type="task"]');
          if (!taskLi) return false;

          // Only treat clicks in the list-marker padding area (left of the
          // li's content box) as checkbox clicks.
          const rect = taskLi.getBoundingClientRect();
          if (event.clientX > rect.left) return false;

          try {
            // posAtDOM(li, 0) returns the position *inside* the li (before its
            // first child); subtracting 1 gives the position of the li node
            // itself.
            const childPos = view.posAtDOM(taskLi, 0);
            const liPos = childPos - 1;
            const $liPos = view.state.doc.resolve(liPos);
            const liNode = $liPos.nodeAfter;

            if (
              !liNode ||
              liNode.type.name !== 'list_item' ||
              liNode.attrs.checked == null
            ) {
              return false;
            }

            const newChecked = !liNode.attrs.checked;
            const tr = view.state.tr.setNodeMarkup(liPos, undefined, {
              ...liNode.attrs,
              checked: newChecked,
            });
            view.dispatch(tr);
            return true;
          } catch {
            return false;
          }
        },
      },
    },
  });
});

export const taskList = [wrapInTaskListCommand, taskListClickPlugin];