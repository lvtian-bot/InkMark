import { taskListCheckboxPlugin } from './task-list-view';
import { toggleTaskListCommand } from './list-format';

export const wrapInTaskListCommand = toggleTaskListCommand;

/// 任务项的行首 Backspace/Delete 改写已移至 `list-keymap.ts`，随普通列表项一并处理。

export const taskList = [wrapInTaskListCommand, taskListCheckboxPlugin];
