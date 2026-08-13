// 编辑区字体与排版预设。字体族用 CSS font-family 栈，选未安装的字体时浏览器自动回落，
// 不会出错。字号用绝对像素，标题等 em 单位会跟随根字号缩放。
// 下拉选项文案走 labelKey（界面语言键），避免预设数据按语言写死。

import type { MessageKey } from '../../shared/i18n';

export type FontPresetId =
  'system' | 'yahei' | 'source-han' | 'dengxian' | 'simsun' | 'misans' | 'harmony';

export interface FontPreset {
  id: FontPresetId;
  labelKey: MessageKey;
  stack: string;
}

export const FONT_PRESETS: readonly FontPreset[] = [
  {
    id: 'system',
    labelKey: 'font.system',
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  },
  {
    id: 'yahei',
    labelKey: 'font.yahei',
    stack: "'Microsoft YaHei', sans-serif",
  },
  {
    id: 'source-han',
    labelKey: 'font.sourceHan',
    stack: "'Source Han Sans CN', 'Noto Sans CJK SC', sans-serif",
  },
  {
    id: 'dengxian',
    labelKey: 'font.dengxian',
    stack: "'DengXian', sans-serif",
  },
  {
    id: 'simsun',
    labelKey: 'font.simsun',
    stack: "'SimSun', 'NSimSun', sans-serif",
  },
  {
    id: 'misans',
    labelKey: 'font.misans',
    stack: "'MiSans', sans-serif",
  },
  {
    id: 'harmony',
    labelKey: 'font.harmony',
    stack: "'HarmonyOS Sans SC', 'HarmonyOS Sans', sans-serif",
  },
];

const DEFAULT_FONT_PRESET = FONT_PRESETS[0];
const FONT_PRESET_BY_ID = new Map(FONT_PRESETS.map((preset) => [preset.id, preset]));

export function isFontPresetId(value: unknown): value is FontPresetId {
  return FONT_PRESETS.some((preset) => preset.id === value);
}

export function resolveFontStack(id: unknown): string {
  if (!isFontPresetId(id)) return DEFAULT_FONT_PRESET.stack;
  return FONT_PRESET_BY_ID.get(id)?.stack ?? DEFAULT_FONT_PRESET.stack;
}

export type FontSizePresetId = 'small' | 'medium' | 'large' | 'xlarge';

export interface FontSizePreset {
  id: FontSizePresetId;
  labelKey: MessageKey;
  px: number;
}

export const FONT_SIZE_PRESETS: readonly FontSizePreset[] = [
  { id: 'small', labelKey: 'font.sizeSmall', px: 14 },
  { id: 'medium', labelKey: 'font.sizeMedium', px: 16 },
  { id: 'large', labelKey: 'font.sizeLarge', px: 18 },
  { id: 'xlarge', labelKey: 'font.sizeXlarge', px: 20 },
];

const DEFAULT_FONT_SIZE_PRESET = FONT_SIZE_PRESETS[1];
const FONT_SIZE_PRESET_BY_ID = new Map(FONT_SIZE_PRESETS.map((preset) => [preset.id, preset]));

export function isFontSizePresetId(value: unknown): value is FontSizePresetId {
  return FONT_SIZE_PRESETS.some((preset) => preset.id === value);
}

export function resolveFontSize(id: unknown): number {
  if (!isFontSizePresetId(id)) return DEFAULT_FONT_SIZE_PRESET.px;
  return FONT_SIZE_PRESET_BY_ID.get(id)?.px ?? DEFAULT_FONT_SIZE_PRESET.px;
}

export type LineHeightPresetId = 'compact' | 'medium' | 'relaxed';

export interface LineHeightPreset {
  id: LineHeightPresetId;
  labelKey: MessageKey;
  value: number;
}

export const LINE_HEIGHT_PRESETS: readonly LineHeightPreset[] = [
  { id: 'compact', labelKey: 'font.lineHeightCompact', value: 1.6 },
  { id: 'medium', labelKey: 'font.lineHeightMedium', value: 1.75 },
  { id: 'relaxed', labelKey: 'font.lineHeightRelaxed', value: 2 },
];

const DEFAULT_LINE_HEIGHT_PRESET = LINE_HEIGHT_PRESETS[1];
const LINE_HEIGHT_PRESET_BY_ID = new Map(LINE_HEIGHT_PRESETS.map((preset) => [preset.id, preset]));

export function isLineHeightPresetId(value: unknown): value is LineHeightPresetId {
  return LINE_HEIGHT_PRESETS.some((preset) => preset.id === value);
}

export function resolveLineHeight(id: unknown): number {
  if (!isLineHeightPresetId(id)) return DEFAULT_LINE_HEIGHT_PRESET.value;
  return LINE_HEIGHT_PRESET_BY_ID.get(id)?.value ?? DEFAULT_LINE_HEIGHT_PRESET.value;
}

export type LetterSpacingPresetId = 'tight' | 'medium' | 'wide';

export interface LetterSpacingPreset {
  id: LetterSpacingPresetId;
  labelKey: MessageKey;
  value: string;
}

export const LETTER_SPACING_PRESETS: readonly LetterSpacingPreset[] = [
  { id: 'tight', labelKey: 'font.letterSpacingTight', value: '-0.02em' },
  { id: 'medium', labelKey: 'font.letterSpacingMedium', value: '0em' },
  { id: 'wide', labelKey: 'font.letterSpacingWide', value: '0.04em' },
];

const DEFAULT_LETTER_SPACING_PRESET = LETTER_SPACING_PRESETS[1];
const LETTER_SPACING_PRESET_BY_ID = new Map(
  LETTER_SPACING_PRESETS.map((preset) => [preset.id, preset]),
);

export function isLetterSpacingPresetId(value: unknown): value is LetterSpacingPresetId {
  return LETTER_SPACING_PRESETS.some((preset) => preset.id === value);
}

export function resolveLetterSpacing(id: unknown): string {
  if (!isLetterSpacingPresetId(id)) return DEFAULT_LETTER_SPACING_PRESET.value;
  return LETTER_SPACING_PRESET_BY_ID.get(id)?.value ?? DEFAULT_LETTER_SPACING_PRESET.value;
}
