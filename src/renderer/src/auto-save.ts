export const AUTO_SAVE_DELAY_MS = 3_000;

export interface AutoSaveEligibility {
  enabled: boolean;
  filePath: string | null;
  isDirty: boolean;
  externalUpdatePending?: boolean;
}

/**
 * 自动保存只针对已落盘且没有待处理外部更新的文件：
 * 无路径的新文档仍走手动保存，存在外部更新或冲突时暂停自动保存。
 */
export function isAutoSaveEligible(input: AutoSaveEligibility): boolean {
  return input.enabled && input.filePath !== null && input.isDirty && !input.externalUpdatePending;
}
