// 快捷键的 DOM 录制与匹配。依赖 window/navigator，只在渲染进程使用。
// 纯逻辑（类型、默认、格式化、冲突）在 shared/shortcuts.ts，本文件只补充 DOM 接缝。

import { ALLOWED_COMBO_KEYS, type ShortcutCombo } from '../../shared/shortcuts';

const MODIFIER_KEYS = new Set(['control', 'alt', 'shift', 'meta']);

export function isPlatformMac(platform?: string): boolean {
  const p = platform ?? (typeof navigator !== 'undefined' ? navigator.platform : '');
  return /mac/i.test(p);
}

/**
 * 录制：从键盘事件生成候选组合键。
 * 纯修饰键或不支持的键返回 null，调用方应继续等待下一次按键。
 * 返回的 combo 反映实际按下的修饰键状态，是否合法（必须有 mod）由调用方判断。
 */
export function comboFromKeyboardEvent(
  event: KeyboardEvent,
  platform?: string,
): ShortcutCombo | null {
  const key = event.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return null;
  if (!ALLOWED_COMBO_KEYS.has(key)) return null;
  const mac = isPlatformMac(platform);
  const mod = mac ? event.metaKey : event.ctrlKey;
  return { mod, alt: event.altKey, shift: event.shiftKey, key };
}

/** 匹配：事件是否命中某组合键（修饰键状态必须完全一致）。 */
export function comboMatchesEvent(
  event: KeyboardEvent,
  combo: ShortcutCombo,
  platform?: string,
): boolean {
  if (event.key.toLowerCase() !== combo.key) return false;
  const mac = isPlatformMac(platform);
  const mod = mac ? event.metaKey : event.ctrlKey;
  return mod === combo.mod && event.altKey === combo.alt && event.shiftKey === combo.shift;
}
