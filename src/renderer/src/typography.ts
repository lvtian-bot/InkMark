// 排版数值参数：行距、段落间距、列表项间距。
//
// 设计取舍（2026-09-16 定稿）：排版参数直接暴露具体数值（限定范围），
// 不做"紧凑/标准/宽松"一类的命名档位——命名档位与实际数值脱节，用户
// 无法精确表达意图。数值注入为 CSS 变量（--editor-line-height 等），
// 由 editor.css 消费；越界值在设置读写与注入两层都会被夹回范围。
// 旧版行距档位（lineHeightPreset）在设置迁移时映射为数值。

export interface TypographyRange {
  min: number;
  max: number;
  step: number;
  default: number;
}

/// 行距（倍数）。默认 1.75 与项目长期默认一致。
export const LINE_HEIGHT_RANGE: TypographyRange = {
  min: 1.2,
  max: 2.4,
  step: 0.05,
  default: 1.75,
};

/// 段落间距（em，随字号缩放）。默认 0.6em 为定稿的段落间距档。
export const PARAGRAPH_SPACING_RANGE: TypographyRange = {
  min: 0,
  max: 2,
  step: 0.05,
  default: 0.6,
};

/// 列表项间距（em）。默认 0.3em，应小于段落间距（三档行距层次）。
export const LIST_SPACING_RANGE: TypographyRange = {
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.3,
};

/// 非数值或越界时回落默认并夹回范围。
export function clampTypographyValue(range: TypographyRange, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return range.default;
  return Math.min(range.max, Math.max(range.min, value));
}

// 旧版行距档位 → 数值的迁移映射。与删除前的 LINE_HEIGHT_PRESETS 保持一致。
const LEGACY_LINE_HEIGHT_PRESET_VALUES: Record<string, number> = {
  compact: 1.6,
  medium: 1.75,
  relaxed: 2,
};

/// 旧版行距档位迁移；不是合法档位时返回 null（交由调用方回落默认）。
export function migrateLegacyLineHeight(value: unknown): number | null {
  if (typeof value === 'string' && value in LEGACY_LINE_HEIGHT_PRESET_VALUES) {
    return LEGACY_LINE_HEIGHT_PRESET_VALUES[value];
  }
  return null;
}
