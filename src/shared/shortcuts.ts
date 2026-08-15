// 应用功能类快捷键的统一表示与纯函数。
// 主进程用它生成 Electron 菜单 accelerator，渲染进程用它匹配 DOM 键盘事件与显示。
// 本文件不得依赖 DOM 或 Node 环境（保持 shared 无副作用的约束）。

import type { MessageKey } from './i18n';

/** 可配置的应用功能快捷键动作。格式类（加粗/斜体/列表等）不在此列，沿用编辑器库默认。 */
export type ShortcutAction =
  | 'newFile'
  | 'newBlankDoc'
  | 'openFile'
  | 'openFolder'
  | 'closeTab'
  | 'save'
  | 'saveAs'
  | 'find'
  | 'replace'
  | 'toggleSource'
  | 'settings';

/**
 * 一个组合键。mod = Ctrl(Win/Linux) / Cmd(Mac)。
 * 合法快捷键必须 mod === true（裸字母会吃掉正文输入，不允许）。
 */
export interface ShortcutCombo {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string; // 小写：字母 / 数字 / ALLOWED_COMBO_KEYS 中的标点
}

export type ShortcutMap = Record<ShortcutAction, ShortcutCombo>;

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  'newFile',
  'newBlankDoc',
  'openFile',
  'openFolder',
  'closeTab',
  'save',
  'saveAs',
  'find',
  'replace',
  'toggleSource',
  'settings',
];

export interface ShortcutActionMeta {
  action: ShortcutAction;
  labelKey: MessageKey;
  hintKey?: MessageKey;
}

export const SHORTCUT_ACTION_META: Record<ShortcutAction, ShortcutActionMeta> = {
  newFile: { action: 'newFile', labelKey: 'shortcut.newFile' },
  newBlankDoc: { action: 'newBlankDoc', labelKey: 'shortcut.newBlankDoc' },
  openFile: { action: 'openFile', labelKey: 'shortcut.openFile' },
  openFolder: { action: 'openFolder', labelKey: 'shortcut.openFolder' },
  closeTab: { action: 'closeTab', labelKey: 'shortcut.closeTab' },
  save: { action: 'save', labelKey: 'shortcut.save' },
  saveAs: { action: 'saveAs', labelKey: 'shortcut.saveAs' },
  find: { action: 'find', labelKey: 'shortcut.find' },
  replace: { action: 'replace', labelKey: 'shortcut.replace' },
  toggleSource: {
    action: 'toggleSource',
    labelKey: 'shortcut.toggleSource',
  },
  settings: { action: 'settings', labelKey: 'shortcut.settings' },
};

/** 允许作为快捷键主键的字符（小写）。纯修饰键与不可打印键不在内。 */
export const ALLOWED_COMBO_KEYS: ReadonlySet<string> = new Set([
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'0123456789',
  '/',
  ',',
  '.',
  '-',
  '=',
  ';',
  "'",
  '`',
  '[',
  ']',
  '\\',
]);

// Electron accelerator 键名映射：我们的 combo.key → accelerator 片段。
// 字母/数字直接大写；标点必须用 Electron 的 Key 名，否则 accelerator 不生效。
const KEY_TO_ACCELERATOR: Record<string, string> = {
  '/': 'Slash',
  ',': 'Comma',
  '.': 'Period',
  '-': 'Minus',
  '=': 'Equal',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
};

function acceleratorKey(key: string): string | null {
  if (/^[a-z0-9]$/.test(key)) return key.toUpperCase();
  return KEY_TO_ACCELERATOR[key] ?? null;
}

/** 把组合键转成 Electron accelerator 字符串（如 "CmdOrCtrl+Shift+O" / "Alt+E"）。无法表示时返回 null。 */
export function comboToAccelerator(combo: ShortcutCombo): string | null {
  if (!combo.mod && !combo.alt) return null;
  const ak = acceleratorKey(combo.key);
  if (!ak) return null;
  const parts: string[] = [];
  if (combo.mod) parts.push('CmdOrCtrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  parts.push(ak);
  return parts.join('+');
}

/** 平台归一化：是否 Mac 系。 */
export type DisplayPlatform = 'darwin' | 'other';

export function toDisplayPlatform(platform: string): DisplayPlatform {
  return platform === 'darwin' ? 'darwin' : 'other';
}

/** 把组合键格式化成用户可读字符串（如 "Ctrl+Shift+O" / "Cmd+," / "Alt+E"）。 */
export function formatComboForDisplay(
  combo: ShortcutCombo,
  platform: DisplayPlatform = 'other',
): string {
  const parts: string[] = [];
  if (combo.mod) parts.push(platform === 'darwin' ? 'Cmd' : 'Ctrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  parts.push(combo.key.toUpperCase());
  return parts.join('+');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isShortcutCombo(value: unknown): value is ShortcutCombo {
  if (!isRecord(value)) return false;
  return (
    typeof value.mod === 'boolean' &&
    typeof value.alt === 'boolean' &&
    typeof value.shift === 'boolean' &&
    (value.mod || value.alt) &&
    typeof value.key === 'string' &&
    ALLOWED_COMBO_KEYS.has(value.key)
  );
}

export function comboEquals(a: ShortcutCombo, b: ShortcutCombo): boolean {
  return a.mod === b.mod && a.alt === b.alt && a.shift === b.shift && a.key === b.key;
}

/** 默认快捷键映射，对齐改造前的硬编码值（菜单 accelerator 与渲染进程 keydown）。 */
export const DEFAULT_SHORTCUT_MAP: Readonly<ShortcutMap> = {
  newFile: { mod: true, alt: false, shift: false, key: 't' },
  newBlankDoc: { mod: true, alt: false, shift: false, key: 'n' },
  openFile: { mod: true, alt: false, shift: false, key: 'o' },
  openFolder: { mod: true, alt: false, shift: true, key: 'o' },
  closeTab: { mod: true, alt: false, shift: false, key: 'w' },
  save: { mod: true, alt: false, shift: false, key: 's' },
  saveAs: { mod: true, alt: false, shift: true, key: 's' },
  find: { mod: true, alt: false, shift: false, key: 'f' },
  replace: { mod: true, alt: false, shift: false, key: 'h' },
  toggleSource: { mod: true, alt: false, shift: false, key: 'e' },
  settings: { mod: true, alt: false, shift: false, key: ',' },
};

/** 返回一份与默认映射互不引用的拷贝，避免外部 mutate 污染常量。 */
export function cloneShortcutMap(map: ShortcutMap): ShortcutMap {
  const result = {} as ShortcutMap;
  for (const action of SHORTCUT_ACTIONS) {
    const c = map[action];
    result[action] = { mod: c.mod, alt: c.alt, shift: c.shift, key: c.key };
  }
  return result;
}

const LEGACY_DEFAULT_SHORTCUTS: Partial<Record<ShortcutAction, ShortcutCombo>> = {
  toggleSource: { mod: true, alt: false, shift: false, key: '/' },
};

/** 归一化整张映射：逐动作校验，非法或缺失回落默认。返回的 combo 与入参互不引用。 */
export function normalizeShortcutMap(value: unknown): ShortcutMap {
  const base = isRecord(value) ? value : {};
  const result = {} as ShortcutMap;
  for (const action of SHORTCUT_ACTIONS) {
    let c = isShortcutCombo(base[action])
      ? (base[action] as ShortcutCombo)
      : DEFAULT_SHORTCUT_MAP[action];
    const legacy = LEGACY_DEFAULT_SHORTCUTS[action];
    if (legacy && comboEquals(c, legacy)) {
      c = DEFAULT_SHORTCUT_MAP[action];
    }
    result[action] = { mod: c.mod, alt: c.alt, shift: c.shift, key: c.key };
  }
  return result;
}

export function isShortcutMap(value: unknown): value is ShortcutMap {
  if (!isRecord(value)) return false;
  for (const action of SHORTCUT_ACTIONS) {
    if (!isShortcutCombo(value[action])) return false;
  }
  return true;
}

/**
 * 找冲突：返回每个动作「与之冲突的其它动作列表」。
 * 无冲突的动作为空数组。UI 据此标红与禁用提交。
 */
export function findShortcutConflicts(map: ShortcutMap): Map<ShortcutAction, ShortcutAction[]> {
  const result = new Map<ShortcutAction, ShortcutAction[]>();
  for (const action of SHORTCUT_ACTIONS) {
    const combo = map[action];
    const others: ShortcutAction[] = [];
    for (const other of SHORTCUT_ACTIONS) {
      if (other !== action && comboEquals(map[other], combo)) others.push(other);
    }
    result.set(action, others);
  }
  return result;
}

export function hasShortcutConflicts(map: ShortcutMap): boolean {
  const seen: string[] = [];
  for (const action of SHORTCUT_ACTIONS) {
    const combo = map[action];
    const sig = `${combo.mod ? 1 : 0}${combo.alt ? 1 : 0}${combo.shift ? 1 : 0}${combo.key}`;
    if (seen.includes(sig)) return true;
    seen.push(sig);
  }
  return false;
}
