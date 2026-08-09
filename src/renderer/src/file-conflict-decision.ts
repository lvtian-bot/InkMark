// 外部文件变化检测与保存/关闭冲突的纯决策函数。
// 这些判断从 useFile hook 中抽出，便于单元测试且不依赖 IPC、弹窗或 React。
// 文件丢失（missing）的判定由 useFile 的事件层和 mtime 查询层负责，不在这里处理。

export type ExternalChangeDecision = 'noop' | 'silent-reload' | 'conflict';

export interface ExternalChangeInput {
  fileMtime: number | null;
  diskMtime: number;
  isDirty: boolean;
}

// 判定某个已打开标签在面对外部文件变化时应走哪条分支。
// 调用前应已确认文件存在（missing 由事件/查询层先行过滤）。
// 返回值与 useFile 的 checkExternalChanges 中 mtime 比较后的分支一一对应。
export function decideExternalChange(input: ExternalChangeInput): ExternalChangeDecision {
  const { fileMtime, diskMtime, isDirty } = input;
  if (fileMtime == null || diskMtime === fileMtime) return 'noop';
  return isDirty ? 'conflict' : 'silent-reload';
}

export type ConflictChoiceAction = 'reload' | 'keep-and-override' | 'cancel';

// 解析「文件已被外部修改」三选一弹窗的选择。0=使用磁盘版本，1=保留并覆盖，2/其他=取消。
export function resolveConflictChoice(choice: number): ConflictChoiceAction {
  if (choice === 0) return 'reload';
  if (choice === 1) return 'keep-and-override';
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
