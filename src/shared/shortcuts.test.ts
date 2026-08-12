import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHORTCUT_MAP,
  SHORTCUT_ACTIONS,
  comboEquals,
  comboToAccelerator,
  findShortcutConflicts,
  formatComboForDisplay,
  hasShortcutConflicts,
  isShortcutCombo,
  isShortcutMap,
  normalizeShortcutMap,
  type ShortcutMap,
} from './shortcuts';

describe('comboToAccelerator', () => {
  it('把字母组合转成 CmdOrCtrl accelerator', () => {
    expect(comboToAccelerator({ mod: true, alt: false, shift: false, key: 's' })).toBe(
      'CmdOrCtrl+S',
    );
  });

  it('保留 Alt 与 Shift 段', () => {
    expect(comboToAccelerator({ mod: true, alt: true, shift: true, key: 'o' })).toBe(
      'CmdOrCtrl+Alt+Shift+O',
    );
  });

  it('标点用 Electron Key 名', () => {
    expect(comboToAccelerator({ mod: true, alt: false, shift: false, key: '/' })).toBe(
      'CmdOrCtrl+Slash',
    );
    expect(comboToAccelerator({ mod: true, alt: false, shift: false, key: ',' })).toBe(
      'CmdOrCtrl+Comma',
    );
  });

  it('无 mod 返回 null', () => {
    expect(comboToAccelerator({ mod: false, alt: false, shift: false, key: 's' })).toBeNull();
  });
});

describe('formatComboForDisplay', () => {
  it('非 Mac 用 Ctrl', () => {
    expect(formatComboForDisplay({ mod: true, alt: false, shift: true, key: 's' }, 'other')).toBe(
      'Ctrl+Shift+S',
    );
  });

  it('Mac 用 Cmd', () => {
    expect(formatComboForDisplay({ mod: true, alt: false, shift: false, key: 's' }, 'darwin')).toBe(
      'Cmd+S',
    );
  });
});

describe('isShortcutCombo', () => {
  it('合法组合返回 true', () => {
    expect(isShortcutCombo({ mod: true, alt: false, shift: false, key: 'f' })).toBe(true);
  });

  it('mod 为 false 视为非法', () => {
    expect(isShortcutCombo({ mod: false, alt: false, shift: false, key: 'f' })).toBe(false);
  });

  it('key 不在白名单视为非法', () => {
    expect(isShortcutCombo({ mod: true, alt: false, shift: false, key: '!' })).toBe(false);
  });
});

describe('normalizeShortcutMap', () => {
  it('空输入返回全部默认值的拷贝', () => {
    const result = normalizeShortcutMap(undefined);
    expect(isShortcutMap(result)).toBe(true);
    for (const action of SHORTCUT_ACTIONS) {
      expect(comboEquals(result[action], DEFAULT_SHORTCUT_MAP[action])).toBe(true);
    }
  });

  it('非法动作回落默认，合法动作保留', () => {
    const result = normalizeShortcutMap({
      save: { mod: true, alt: false, shift: false, key: 'q' },
    });
    expect(result.save.key).toBe('q');
    expect(comboEquals(result.find, DEFAULT_SHORTCUT_MAP.find)).toBe(true);
  });

  it('返回的 combo 与默认常量不共享引用', () => {
    const result = normalizeShortcutMap(DEFAULT_SHORTCUT_MAP);
    expect(result.save).not.toBe(DEFAULT_SHORTCUT_MAP.save);
  });
});

describe('findShortcutConflicts', () => {
  it('默认映射无冲突', () => {
    const conflicts = findShortcutConflicts(DEFAULT_SHORTCUT_MAP);
    for (const action of SHORTCUT_ACTIONS) {
      expect(conflicts.get(action)).toEqual([]);
    }
  });

  it('相同组合的多个动作互相标记', () => {
    const map: ShortcutMap = normalizeShortcutMap(DEFAULT_SHORTCUT_MAP);
    map.find = { ...map.save };
    const conflicts = findShortcutConflicts(map);
    expect(conflicts.get('save')).toContain('find');
    expect(conflicts.get('find')).toContain('save');
  });
});

describe('hasShortcutConflicts', () => {
  it('默认无冲突', () => {
    expect(hasShortcutConflicts(DEFAULT_SHORTCUT_MAP)).toBe(false);
  });

  it('构造冲突返回 true', () => {
    const map = normalizeShortcutMap(DEFAULT_SHORTCUT_MAP);
    map.find = { ...map.save };
    expect(hasShortcutConflicts(map)).toBe(true);
  });
});
