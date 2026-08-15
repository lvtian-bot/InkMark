import { ALLOWED_COMBO_KEYS, type ShortcutCombo } from '../../shared/shortcuts';

const MODIFIER_KEYS = new Set(['control', 'alt', 'shift', 'meta']);

const CODE_TO_KEY: Record<string, string> = {
  Slash: '/',
  Comma: ',',
  Period: '.',
  Minus: '-',
  Equal: '=',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
};

const CHINESE_PUNCTUATION_TO_KEY: Record<string, string> = {
  '、': '/',
  '。': '.',
  '，': ',',
  '；': ';',
  '：': ';',
  '‘': "'",
  '’': "'",
  '“': "'",
  '”': "'",
  '【': '[',
  '】': ']',
  '·': '`',
  '～': '`',
  '—': '-',
  '－': '-',
  '＝': '=',
  '＼': '\\',
};

const KEYCODE_TO_KEY: Record<number, string> = {
  191: '/',
  188: ',',
  190: '.',
  189: '-',
  187: '=',
  186: ';',
  222: "'",
  192: '`',
  219: '[',
  221: ']',
  220: '\\',
};

export function isPlatformMac(platform?: string): boolean {
  const p = platform ?? (typeof navigator !== 'undefined' ? navigator.platform : '');
  return /mac|darwin/i.test(p);
}

/**
 * 从键盘事件中提取规范的小写字符键名。
 * 优先使用标准 event.key，在中文输入法/非英标点/Process 状态下通过中文标点表、event.code 与 event.keyCode 物理键位回捞。
 */
export function normalizeKeyFromEvent(event: KeyboardEvent): string {
  const rawKey = event.key ? event.key.toLowerCase() : '';
  if (ALLOWED_COMBO_KEYS.has(rawKey)) {
    return rawKey;
  }
  const punctMapped = CHINESE_PUNCTUATION_TO_KEY[rawKey];
  if (punctMapped && ALLOWED_COMBO_KEYS.has(punctMapped)) {
    return punctMapped;
  }
  if (event.code) {
    if (event.code.startsWith('Key') && event.code.length === 4) {
      const char = event.code.slice(3).toLowerCase();
      if (ALLOWED_COMBO_KEYS.has(char)) return char;
    }
    if (event.code.startsWith('Digit') && event.code.length === 6) {
      const digit = event.code.slice(5);
      if (ALLOWED_COMBO_KEYS.has(digit)) return digit;
    }
    const mapped = CODE_TO_KEY[event.code];
    if (mapped && ALLOWED_COMBO_KEYS.has(mapped)) {
      return mapped;
    }
  }
  if (typeof event.keyCode === 'number' && event.keyCode > 0) {
    if (event.keyCode >= 65 && event.keyCode <= 90) {
      const char = String.fromCharCode(event.keyCode).toLowerCase();
      if (ALLOWED_COMBO_KEYS.has(char)) return char;
    }
    if (event.keyCode >= 48 && event.keyCode <= 57) {
      const digit = String.fromCharCode(event.keyCode);
      if (ALLOWED_COMBO_KEYS.has(digit)) return digit;
    }
    const mapped = KEYCODE_TO_KEY[event.keyCode];
    if (mapped && ALLOWED_COMBO_KEYS.has(mapped)) {
      return mapped;
    }
  }
  return rawKey;
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
  const rawKey = event.key ? event.key.toLowerCase() : '';
  if (MODIFIER_KEYS.has(rawKey)) return null;
  const key = normalizeKeyFromEvent(event);
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
  const key = normalizeKeyFromEvent(event);
  if (key !== combo.key) return false;
  const mac = isPlatformMac(platform);
  const mod = mac ? event.metaKey : event.ctrlKey;
  return mod === combo.mod && event.altKey === combo.alt && event.shiftKey === combo.shift;
}
