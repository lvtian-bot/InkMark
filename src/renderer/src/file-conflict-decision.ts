// 外部文件变化检测与保存/关闭冲突的纯决策函数。
// 这些判断从 useFile hook 中抽出，便于单元测试且不依赖 IPC、弹窗或 React。
// 文件丢失（missing）的判定由 useFile 的事件层和 mtime 查询层负责，不在这里处理。

export type ExternalChangeDecision = 'noop' | 'prompt' | 'conflict';

export interface ExternalChangeInput {
  fileMtime: number | null;
  diskMtime: number;
  isDirty: boolean;
  externalUpdatePending?: boolean;
}

// 判定某个已打开标签在面对外部文件变化时应走哪条分支。
// 调用前应已确认文件存在（missing 由事件/查询层先行过滤）。
// 返回值与 useFile 的 checkExternalChanges 中 mtime 比较后的分支一一对应：
// 已处于待重载或冲突提示态时不重复弹窗；干净标签显示手动重载提示，有未保存修改时弹出冲突选择。
export function decideExternalChange(input: ExternalChangeInput): ExternalChangeDecision {
  const { fileMtime, diskMtime, isDirty, externalUpdatePending } = input;
  if (fileMtime == null || diskMtime === fileMtime || externalUpdatePending) return 'noop';
  return isDirty ? 'conflict' : 'prompt';
}

export type ConflictChoiceAction = 'save-as' | 'reload' | 'overwrite' | 'cancel';

// 解析「文件已被外部修改」弹窗的选择。
// 0=另存为新文件，1=使用磁盘版本，2=覆盖磁盘版本，3/其他=取消。
export function resolveConflictChoice(choice: number): ConflictChoiceAction {
  if (choice === 0) return 'save-as';
  if (choice === 1) return 'reload';
  if (choice === 2) return 'overwrite';
  return 'cancel';
}

export type CloseDirtyDecision = 'proceed' | 'save' | 'discard' | 'cancel';

export interface CloseDirtyInput {
  isDirty: boolean;
  choice: number;
}

// 判定关闭标签（或窗口）时如何处理未保存修改。
// 0=保存，1=不保存，2=取消；标签非脏时直接 proceed。
export function decideCloseDirty(input: CloseDirtyInput): CloseDirtyDecision {
  if (!input.isDirty) return 'proceed';
  if (input.choice === 0) return 'save';
  if (input.choice === 1) return 'discard';
  return 'cancel';
}
