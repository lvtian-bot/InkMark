export const AUTO_SAVE_DELAY_MS = 3_000;

export interface AutoSaveEligibility {
  enabled: boolean;
  filePath: string | null;
  isDirty: boolean;
}

/**
 * 自动保存只针对已落盘文件：无路径的新文档仍走手动保存，
 * 避免输入过程中弹出另存为对话框打断编辑。
 */
export function isAutoSaveEligible(input: AutoSaveEligibility): boolean {
  return input.enabled && input.filePath !== null && input.isDirty;
}
