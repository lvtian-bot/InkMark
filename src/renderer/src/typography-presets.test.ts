// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { LETTER_SPACING_PRESETS, resolveLetterSpacing } from './font-presets';
import {
  LINE_HEIGHT_RANGE,
  LIST_SPACING_RANGE,
  PARAGRAPH_SPACING_RANGE,
  clampTypographyValue,
  migrateLegacyLineHeight,
} from './typography';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

describe('typography presets', () => {
  it('提供三档字间距并把非法值回落到默认', () => {
    expect(LETTER_SPACING_PRESETS).toHaveLength(3);
    expect(resolveLetterSpacing('tight')).toBe('-0.02em');
    expect(resolveLetterSpacing('medium')).toBe('0em');
    expect(resolveLetterSpacing('wide')).toBe('0.04em');
    expect(resolveLetterSpacing('invalid')).toBe('0em');
  });
});

describe('排版数值参数', () => {
  it('clamp：非数值回落默认，越界夹回范围', () => {
    expect(clampTypographyValue(LINE_HEIGHT_RANGE, undefined)).toBe(LINE_HEIGHT_RANGE.default);
    expect(clampTypographyValue(LINE_HEIGHT_RANGE, 'x')).toBe(LINE_HEIGHT_RANGE.default);
    expect(clampTypographyValue(LINE_HEIGHT_RANGE, 0.5)).toBe(LINE_HEIGHT_RANGE.min);
    expect(clampTypographyValue(LINE_HEIGHT_RANGE, 9)).toBe(LINE_HEIGHT_RANGE.max);
    expect(clampTypographyValue(LINE_HEIGHT_RANGE, 1.8)).toBe(1.8);
    expect(clampTypographyValue(PARAGRAPH_SPACING_RANGE, 5)).toBe(PARAGRAPH_SPACING_RANGE.max);
    expect(clampTypographyValue(LIST_SPACING_RANGE, -1)).toBe(LIST_SPACING_RANGE.min);
  });

  it('旧版行距档位迁移为数值，非法值返回 null', () => {
    expect(migrateLegacyLineHeight('compact')).toBe(1.6);
    expect(migrateLegacyLineHeight('medium')).toBe(1.75);
    expect(migrateLegacyLineHeight('relaxed')).toBe(2);
    expect(migrateLegacyLineHeight('unknown')).toBeNull();
    expect(migrateLegacyLineHeight(1.75)).toBeNull();
  });
});

describe('排版设置的持久化迁移', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('旧设置只有行距档位（lineHeightPreset）时迁移为对应数值，新字段取默认', () => {
    localStorage.setItem('inkmark-settings', JSON.stringify({ lineHeightPreset: 'relaxed' }));
    const settings = loadSettings();
    expect(settings.lineHeight).toBe(2);
    expect(settings.paragraphSpacing).toBe(PARAGRAPH_SPACING_RANGE.default);
    expect(settings.listSpacing).toBe(LIST_SPACING_RANGE.default);
  });

  it('保存时越界的排版数值被夹回范围', () => {
    const settings = saveSettings({
      ...DEFAULT_SETTINGS,
      lineHeight: 9,
      paragraphSpacing: 5,
      listSpacing: -1,
    });
    expect(settings.lineHeight).toBe(LINE_HEIGHT_RANGE.max);
    expect(settings.paragraphSpacing).toBe(PARAGRAPH_SPACING_RANGE.max);
    expect(settings.listSpacing).toBe(LIST_SPACING_RANGE.min);
  });
});
