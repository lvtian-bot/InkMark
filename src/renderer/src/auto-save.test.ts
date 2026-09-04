import { describe, expect, it } from 'vitest';
import { AUTO_SAVE_DELAY_MS, isAutoSaveEligible } from './auto-save';

describe('isAutoSaveEligible', () => {
  it('开启且有路径且有修改时满足自动保存', () => {
    expect(
      isAutoSaveEligible({
        enabled: true,
        filePath: 'D:/a.md',
        isDirty: true,
        hasPendingReview: false,
      }),
    ).toBe(true);
  });

  it('关闭自动保存时不触发', () => {
    expect(
      isAutoSaveEligible({
        enabled: false,
        filePath: 'D:/a.md',
        isDirty: true,
        hasPendingReview: false,
      }),
    ).toBe(false);
  });

  it('无路径的新文档不触发', () => {
    expect(
      isAutoSaveEligible({ enabled: true, filePath: null, isDirty: true, hasPendingReview: false }),
    ).toBe(false);
  });

  it('无修改时不触发', () => {
    expect(
      isAutoSaveEligible({
        enabled: true,
        filePath: 'D:/a.md',
        isDirty: false,
        hasPendingReview: false,
      }),
    ).toBe(false);
  });

  it('审阅期间（有未决外部改动）不触发', () => {
    expect(
      isAutoSaveEligible({
        enabled: true,
        filePath: 'D:/a.md',
        isDirty: true,
        hasPendingReview: true,
      }),
    ).toBe(false);
  });

  it('防抖间隔为 3 秒', () => {
    expect(AUTO_SAVE_DELAY_MS).toBe(3_000);
  });
});
