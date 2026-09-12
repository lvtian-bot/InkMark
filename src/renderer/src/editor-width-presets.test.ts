import { describe, expect, it } from 'vitest';
import {
  EDITOR_WIDTH_PRESETS,
  computeEditorMaxWidth,
  resolveEditorWidthPreset,
} from './editor-width-presets';

const STANDARD = resolveEditorWidthPreset('standard');
const WIDE = resolveEditorWidthPreset('wide');
const FULL = resolveEditorWidthPreset('full');

describe('editor width presets', () => {
  it('三档由基准宽与放大比例定义，非法档位回落到默认', () => {
    expect(EDITOR_WIDTH_PRESETS).toHaveLength(3);
    expect(STANDARD.baseWidth).toBe(850);
    expect(STANDARD.ratio).toBe(0.6);
    expect(WIDE.baseWidth).toBe(1100);
    expect(WIDE.ratio).toBe(0.7);
    expect(FULL.baseWidth).toBe(Number.POSITIVE_INFINITY);
    expect(resolveEditorWidthPreset('invalid').id).toBe('standard');
  });

  it('编辑区不宽时按基准上限，与旧版固定上限观感一致', () => {
    // 文件树 + 大纲全开（编辑区约 948）：适中档 850，与旧版一致
    expect(computeEditorMaxWidth(STANDARD, 948)).toBe(850);
    // 编辑区比基准还窄时占满且不溢出
    expect(computeEditorMaxWidth(STANDARD, 600)).toBe(588);
    expect(computeEditorMaxWidth(STANDARD, 0)).toBe(0);
  });

  it('编辑区更宽时按比例放大，大屏不再封在基准值', () => {
    // 全屏无面板（编辑区 1440）：适中约 857，贴近旧版 850 观感
    expect(computeEditorMaxWidth(STANDARD, 1440)).toBe(857);
    // 更大的编辑区按档位比例线性放大（函数内先扣除 12px 滚动条）
    expect(computeEditorMaxWidth(STANDARD, 2012)).toBe(1200);
    expect(computeEditorMaxWidth(WIDE, 2012)).toBe(1400);
  });

  it('占满档等于编辑区扣除滚动条后的可用宽度', () => {
    expect(computeEditorMaxWidth(FULL, 948)).toBe(936);
    expect(computeEditorMaxWidth(FULL, 1440)).toBe(1428);
  });
});
