import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { goToNextCell, isInTable } from '@milkdown/kit/prose/tables';
import { hardbreakSchema } from '@milkdown/kit/preset/commonmark';
import { addTableLine } from './table-edit';

// 表格内的 Enter/Tab/Shift+Enter 键位。
//
// Milkdown gfm 预设的默认键位有两处不符合表格编辑惯例：
// - Enter/Ctrl+Enter 都绑到 exitTable（光标落到表格下方），格内导航只能靠 Tab；
// - Shift+Enter 的硬换行插入会被 commonmark 的 hardbreakFilterPlugin 否决
//   （table 在 hardbreakFilterNodes 禁插名单里，Editor.tsx 已放开）。
//
// 本插件（$prose + handleKeyDown，与 list-keymap 同模式；后加载的 prose 插件
// 键位处理先于预设的 keymap manager）在表格内重排为：
// - 普通 Enter / Tab：跳到下一格；已是最后一格则在表尾新增一行并落入其首格，
//   让「敲完最后一格回车/Tab 继续写下一行」成为连贯动线（对齐 Obsidian）。
// - Shift+Enter：格内插入硬换行。直接插节点而不走 insertHardbreakCommand——
//   后者会打上 'hardbreak' 事务标记，被 hardbreakFilterPlugin 按名单整笔否决。
//   也不复刻原命令「行尾连续换行转新段落」的行为，单元格内一律插入换行，
//   序列化为 <br>（见 plugins/table-cell-breaks）。
// - Ctrl/Cmd+Enter：维持默认的跳出表格；Shift+Tab 维持上一格。

const tableEnterKeymapKey = new PluginKey('inkmark-table-enter-keymap');

/// 表格内按键的动作判定。抽成纯函数便于单测。
export type TableKeyAction = 'next-cell-or-add-row' | 'insert-hardbreak' | null;

export function tableKeyAction(input: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly modKey: boolean;
  readonly inTable: boolean;
}): TableKeyAction {
  if (!input.inTable || input.modKey) return null;
  if (input.key === 'Enter') {
    return input.shiftKey ? 'insert-hardbreak' : 'next-cell-or-add-row';
  }
  if (input.key === 'Tab' && !input.shiftKey) return 'next-cell-or-add-row';
  return null;
}

export const tableEnterKeymapPlugin = $prose((ctx) => {
  const hardbreakType = hardbreakSchema.type(ctx);

  const navigateOrAddRow = (state: EditorState, dispatch: (tr: Transaction) => void): boolean => {
    // 下一格；prosemirror-tables 在最后一格返回 false（不循环）。
    if (goToNextCell(1)(state, dispatch)) return true;
    // 最后一格：在当前行（即最后一行）之后新增一行，addTableLine 会把光标
    // 放进新行首列。
    const tr = addTableLine(state, ctx, 'row', 'after');
    if (!tr) return false;
    dispatch(tr);
    return true;
  };

  return new Plugin({
    key: tableEnterKeymapKey,
    props: {
      handleKeyDown(view, event) {
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
        return navigateOrAddRow(view.state, (tr) => view.dispatch(tr));
      },
    },
  });
});

export const tableEnterKeymap = [tableEnterKeymapPlugin];
