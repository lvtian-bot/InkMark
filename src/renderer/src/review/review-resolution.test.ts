import { describe, expect, it, vi } from 'vitest';
import type { SourceEditorHandle } from '../source-editor-ref';
import { resolveAllReviewChunks } from './review-resolution';

function makeHandle(chunkCount: number, resolvedContent: string): SourceEditorHandle {
  let count = chunkCount;
  return {
    getReviewChunks: () => Array.from({ length: count }, (_, id) => ({ id })) as never,
    acceptAllReviewChunks: vi.fn(() => {
      count = 0;
    }),
    rejectAllReviewChunks: vi.fn(() => {
      count = 0;
    }),
    getValue: () => resolvedContent,
  } as unknown as SourceEditorHandle;
}

describe('resolveAllReviewChunks', () => {
  it('全部接受成功后返回编辑器中已经物化的新正文', () => {
    const handle = makeHandle(2, 'AI 修改后的正文');

    expect(resolveAllReviewChunks(handle, 2, 'accept')).toBe('AI 修改后的正文');
    expect(handle.acceptAllReviewChunks).toHaveBeenCalledOnce();
  });

  it('编辑器块数与界面记录不一致时禁止结束审阅和保存', () => {
    const handle = makeHandle(0, '内存旧正文');

    expect(resolveAllReviewChunks(handle, 2, 'accept')).toBeNull();
    expect(handle.acceptAllReviewChunks).not.toHaveBeenCalled();
  });
});
