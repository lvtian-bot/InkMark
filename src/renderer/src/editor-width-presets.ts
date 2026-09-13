// 编辑区正文宽度预设。宽度模型：内容块上限 = min(编辑区宽, max(基准宽, 比例 × 编辑区宽))。
// 基准宽保证日常窗口尺寸下与旧版固定上限的观感一致；编辑区更宽（全屏、收起侧栏、
// 宽屏）后比例项接管，正文与两侧留白随窗口同比例放大，跨显示器观感一致。
// 所见即所得与源码模式共用 --editor-max-width，工具栏、查找条、外部更新横幅
// 都跟随该变量对齐。下拉选项文案走 labelKey（界面语言键），与 font-presets 同模式。

import type { MessageKey } from '../../shared/i18n';

export type EditorWidthPresetId = 'standard' | 'wide' | 'full';

export interface EditorWidthPreset {
  id: EditorWidthPresetId;
  labelKey: MessageKey;
  /** 基准上限（px）：编辑区不宽于此值时直接采用，与旧版固定上限行为一致。 */
  baseWidth: number;
  /** 编辑区超过基准后，内容块按编辑区宽度的该比例继续放大；1 表示占满。 */
  ratio: number;
}

export const EDITOR_WIDTH_PRESETS: readonly EditorWidthPreset[] = [
  {
    id: 'standard',
    labelKey: 'settings.appearance.editorWidthStandard',
    baseWidth: 850,
    ratio: 0.6,
  },
  { id: 'wide', labelKey: 'settings.appearance.editorWidthWide', baseWidth: 1000, ratio: 0.7 },
  {
    id: 'full',
    labelKey: 'settings.appearance.editorWidthFull',
    baseWidth: Number.POSITIVE_INFINITY,
    ratio: 1,
  },
];

const DEFAULT_EDITOR_WIDTH_PRESET = EDITOR_WIDTH_PRESETS[0];
const EDITOR_WIDTH_PRESET_BY_ID = new Map(
  EDITOR_WIDTH_PRESETS.map((preset) => [preset.id, preset]),
);

export function isEditorWidthPresetId(value: unknown): value is EditorWidthPresetId {
  return EDITOR_WIDTH_PRESETS.some((preset) => preset.id === value);
}

export function resolveEditorWidthPreset(id: unknown): EditorWidthPreset {
  if (!isEditorWidthPresetId(id)) return DEFAULT_EDITOR_WIDTH_PRESET;
  return EDITOR_WIDTH_PRESET_BY_ID.get(id) ?? DEFAULT_EDITOR_WIDTH_PRESET;
}

// 与 global.css 的 --scrollbar-w 保持一致：编辑区宽度需扣除正文滚动条。
const SCROLLBAR_WIDTH = 12;

/**
 * 由档位与编辑区宽度计算正文内容块（border-box）最大宽度。
 * editorMainWidth 是 .editor-main 的可用宽度；下限为档位基准宽（空间不足时
 * 优先保住基准观感），上限不超过编辑区本身。
 */
export function computeEditorMaxWidth(preset: EditorWidthPreset, editorMainWidth: number): number {
  const available = Math.max(editorMainWidth - SCROLLBAR_WIDTH, 0);
  const scaled = preset.ratio * available;
  return Math.round(Math.min(available, Math.max(preset.baseWidth, scaled)));
}
