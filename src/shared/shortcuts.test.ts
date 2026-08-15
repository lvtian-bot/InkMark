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

  it('标点使用标准字符生成 accelerator', () => {
    expect(comboToAccelerator({ mod: true, alt: false, shift: false, key: '/' })).toBe(
      'CmdOrCtrl+/',
    );
    expect(comboToAccelerator({ mod: true, alt: false, shift: false, key: ',' })).toBe(
      'CmdOrCtrl+,',
    );
  });

  it('无 mod 且无 alt 返回 null', () => {
    expect(comboToAccelerator({ mod: false, alt: false, shift: false, key: 's' })).toBeNull();
  });

  it('支持纯 Alt 组合键', () => {
    expect(comboToAccelerator({ mod: false, alt: true, shift: false, key: 'e' })).toBe('Alt+E');
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

  it('纯 Alt 组合键格式化', () => {
    expect(formatComboForDisplay({ mod: false, alt: true, shift: false, key: 'e' }, 'other')).toBe(
      'Alt+E',
    );
  });
});

describe('isShortcutCombo', () => {
  it('合法组合返回 true', () => {
    expect(isShortcutCombo({ mod: true, alt: false, shift: false, key: 'f' })).toBe(true);
    expect(isShortcutCombo({ mod: false, alt: true, shift: false, key: 'e' })).toBe(true);
  });

  it('无 mod 且无 alt 视为非法', () => {
    expect(isShortcutCombo({ mod: false, alt: false, shift: false, key: 'f' })).toBe(false);
  });

  it('key 不在白名单视为非法', () => {
    expect(isShortcutCombo({ mod: true, alt: false, shift: false, key: '!' })).toBe(false);
  });
});

describe('DEFAULT_SHORTCUT_MAP', () => {
  it('新建标签页与新建空白文档分离：Ctrl+T 与 Ctrl+N 互不冲突', () => {
    expect(DEFAULT_SHORTCUT_MAP.newFile).toEqual({ mod: true, alt: false, shift: false, key: 't' });
    expect(DEFAULT_SHORTCUT_MAP.newBlankDoc).toEqual({
      mod: true,
      alt: false,
      shift: false,
      key: 'n',
    });
    expect(comboEquals(DEFAULT_SHORTCUT_MAP.newFile, DEFAULT_SHORTCUT_MAP.newBlankDoc)).toBe(false);
  });

  it('切换源码模式默认快捷键为 Ctrl+E', () => {
    expect(DEFAULT_SHORTCUT_MAP.toggleSource).toEqual({
      mod: true,
      alt: false,
      shift: false,
      key: 'e',
    });
  });

  it('切换大纲与切换文件树默认快捷键分别为 Ctrl+Shift+L 与 Ctrl+Shift+E', () => {
    expect(DEFAULT_SHORTCUT_MAP.toggleOutline).toEqual({
      mod: true,
      alt: false,
      shift: true,
      key: 'l',
    });
    expect(DEFAULT_SHORTCUT_MAP.toggleFileTree).toEqual({
      mod: true,
      alt: false,
      shift: true,
      key: 'e',
    });
  });

  it('打开文件位置、切换工具栏、保持窗口在最前端与退出应用默认快捷键分别为 Ctrl+Shift+R、Ctrl+Shift+T、Ctrl+Alt+T 与 Ctrl+Q', () => {
    expect(DEFAULT_SHORTCUT_MAP.revealInFolder).toEqual({
      mod: true,
      alt: false,
      shift: true,
      key: 'r',
    });
    expect(DEFAULT_SHORTCUT_MAP.toggleToolbar).toEqual({
      mod: true,
      alt: false,
      shift: true,
      key: 't',
    });
    expect(DEFAULT_SHORTCUT_MAP.toggleAlwaysOnTop).toEqual({
      mod: true,
      alt: true,
      shift: false,
      key: 't',
    });
    expect(DEFAULT_SHORTCUT_MAP.exit).toEqual({
      mod: true,
      alt: false,
      shift: false,
      key: 'q',
    });
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

  it('旧版默认快捷键（如 toggleSource: Ctrl+/）自动升级为新版默认快捷键（Ctrl+E）', () => {
    const result = normalizeShortcutMap({
      toggleSource: { mod: true, alt: false, shift: false, key: '/' },
    });
    expect(result.toggleSource).toEqual(DEFAULT_SHORTCUT_MAP.toggleSource);
    expect(result.toggleSource.key).toBe('e');
  });

  it('用户自定义快捷键（如 toggleSource: Alt+E 或 Ctrl+.）不被覆盖', () => {
    const result = normalizeShortcutMap({
      toggleSource: { mod: false, alt: true, shift: false, key: 'e' },
    });
    expect(result.toggleSource).toEqual({ mod: false, alt: true, shift: false, key: 'e' });
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
