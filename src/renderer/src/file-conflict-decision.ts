// 外部文件变化检测与保存/关闭冲突的纯决策函数。
// 这些判断从 useFile hook 中抽出，便于单元测试且不依赖 IPC、弹窗或 React。
// 文件丢失（missing）的判定由 useFile 的事件层和 mtime 查询层负责，不在这里处理。

export type ExternalChangeDecision = 'noop' | 'prompt' | 'conflict' | 'review';

export interface ExternalChangeInput {
  fileMtime: number | null;
  diskMtime: number;
  isDirty: boolean;
  /** 该标签处于审阅会话中：外部改动继续静默入库进入审阅。 */
  inReview: boolean;
}

// 判定某个已打开标签在面对外部文件变化时应走哪条分支。
// 调用前应已确认文件存在（missing 由事件/查询层先行过滤）。
// 返回值与 useFile 的 checkExternalChanges 中 mtime 比较后的分支一一对应：
// 无待决块时干净标签走提示条（prompt，用户选直接替换或逐项审阅）、
// 脏标签走冲突弹窗（conflict，弹窗内含逐项审阅选项）；
// 审阅会话进行中（inReview）则外部增量直接进入审阅（review）。
export function decideExternalChange(input: ExternalChangeInput): ExternalChangeDecision {
  const { fileMtime, diskMtime, isDirty, inReview } = input;
  if (fileMtime == null || diskMtime === fileMtime) return 'noop';
  if (inReview) return 'review';
  return isDirty ? 'conflict' : 'prompt';
}

export type ConflictChoiceAction = 'reload' | 'review' | 'keep-and-override' | 'cancel';

// 解析「文件已被外部修改」弹窗的选择。
// 0=使用磁盘版，1=逐项审阅，2=保留并覆盖，3/其他=取消。
export function resolveConflictChoice(choice: number): ConflictChoiceAction {
  if (choice === 0) return 'reload';
  if (choice === 1) return 'review';
  if (choice === 2) return 'keep-and-override';
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
