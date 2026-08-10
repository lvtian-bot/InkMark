import { describe, expect, it } from 'vitest';
import {
  LETTER_SPACING_PRESETS,
  LINE_HEIGHT_PRESETS,
  resolveLetterSpacing,
  resolveLineHeight,
} from './font-presets';

describe('typography presets', () => {
  it('提供三档行距并保留当前默认行距', () => {
    expect(LINE_HEIGHT_PRESETS).toHaveLength(3);
    expect(resolveLineHeight('compact')).toBe(1.6);
    expect(resolveLineHeight('medium')).toBe(1.75);
    expect(resolveLineHeight('relaxed')).toBe(2);
  });

  it('提供三档字间距并把非法值回落到默认', () => {
    expect(LETTER_SPACING_PRESETS).toHaveLength(3);
    expect(resolveLetterSpacing('tight')).toBe('-0.02em');
    expect(resolveLetterSpacing('medium')).toBe('0em');
    expect(resolveLetterSpacing('wide')).toBe('0.04em');
    expect(resolveLetterSpacing('invalid')).toBe('0em');
  });
});
