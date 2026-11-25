import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { goToNextCell, isInTable } from '@milkdown/kit/prose/tables';
import { hardbreakSchema } from '@milkdown/kit/preset/commonmark';
import { navigateTable } from './table-edit';

// Enter 沿列向下，Tab 沿行向右，Shift+Enter 在格内换行。
const tableEnterKeymapKey = new PluginKey('inkmark-table-enter-keymap');

/// 表格内按键的动作判定。抽成纯函数便于单测。
export type TableKeyAction = 'below' | 'next-cell-or-add-row' | 'insert-hardbreak' | null;

export function tableKeyAction(input: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly modKey: boolean;
  readonly inTable: boolean;
}): TableKeyAction {
  if (!input.inTable || input.modKey) return null;
  if (input.key === 'Enter') {
    return input.shiftKey ? 'insert-hardbreak' : 'below';
  }
  if (input.key === 'Tab' && !input.shiftKey) return 'next-cell-or-add-row';
  return null;
}

export const tableEnterKeymapPlugin = $prose((ctx) => {
  const hardbreakType = hardbreakSchema.type(ctx);

  return new Plugin({
    key: tableEnterKeymapKey,
    props: {
      handleKeyDown(view, event) {
        if (!view.editable) return false;
        const action = tableKeyAction({
          key: event.key,
          shiftKey: event.shiftKey,
          modKey: event.ctrlKey || event.metaKey || event.altKey,
          inTable: isInTable(view.state),
        });
        if (!action) return false;

        if (action === 'insert-hardbreak') {
          if (!(view.state.selection instanceof TextSelection)) return false;
          view.dispatch(
            view.state.tr.replaceSelectionWith(hardbreakType.create()).scrollIntoView(),
          );
          return true;
        }
        if (action === 'next-cell-or-add-row' && goToNextCell(1)(view.state, view.dispatch))
          return true;
        const tr = navigateTable(view.state, ctx, action === 'below');
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
    },
  });
});

export const tableEnterKeymap = [tableEnterKeymapPlugin];
