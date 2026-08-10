// 编辑区字体预设。字体族用 CSS font-family 栈，选未安装的字体时浏览器自动回落，
// 不会出错。字号用绝对像素，标题等 em 单位会跟随根字号缩放。

export type FontPresetId =
  'system' | 'yahei' | 'source-han' | 'dengxian' | 'simsun' | 'misans' | 'harmony';

export interface FontPreset {
  id: FontPresetId;
  label: string;
  stack: string;
}

export const FONT_PRESETS: readonly FontPreset[] = [
  {
    id: 'system',
    label: '系统默认',
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  },
  {
    id: 'yahei',
    label: '微软雅黑',
    stack: "'Microsoft YaHei', sans-serif",
  },
  {
    id: 'source-han',
    label: '思源黑体',
    stack: "'Source Han Sans CN', 'Noto Sans CJK SC', sans-serif",
  },
  {
    id: 'dengxian',
    label: '等线',
    stack: "'DengXian', sans-serif",
  },
  {
    id: 'simsun',
    label: '宋体',
    stack: "'SimSun', 'NSimSun', sans-serif",
  },
  {
    id: 'misans',
    label: '小米 MiSans',
    stack: "'MiSans', sans-serif",
  },
  {
    id: 'harmony',
    label: '鸿蒙 HarmonyOS Sans',
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
  label: string;
  px: number;
}

export const FONT_SIZE_PRESETS: readonly FontSizePreset[] = [
  { id: 'small', label: '小', px: 14 },
  { id: 'medium', label: '默认', px: 16 },
  { id: 'large', label: '大', px: 18 },
  { id: 'xlarge', label: '更大', px: 20 },
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
