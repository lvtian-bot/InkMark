import type { SourceEditorHandle } from '../source-editor-ref';

type BulkReviewDecision = 'accept' | 'reject';

/**
 * 执行整批审阅决定，并且只在编辑器确实持有全部待决块、执行后块确实清零时
 * 返回最终正文。调用方只有拿到正文后才可以结束审阅和触发保存。
 */
export function resolveAllReviewChunks(
  handle: SourceEditorHandle | null,
  expectedCount: number,
  decision: BulkReviewDecision,
): string | null {
  if (!handle || expectedCount <= 0 || handle.getReviewChunks().length !== expectedCount) {
    return null;
  }

  if (decision === 'accept') handle.acceptAllReviewChunks();
  else handle.rejectAllReviewChunks();

  if (handle.getReviewChunks().length !== 0) return null;
  return handle.getValue();
}
