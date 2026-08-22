import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDITOR_SHORTCUT_MAP,
  DEFAULT_SHORTCUT_MAP,
  EDITOR_BUILTIN_COMBOS,
  EDITOR_SHORTCUT_ACTIONS,
  SHORTCUT_ACTIONS,
  cloneEditorShortcutMap,
  comboEquals,
  comboToAccelerator,
  findAppShortcutConflictsWithEditor,
  findEditorShortcutConflicts,
  findShortcutConflicts,
  formatComboForDisplay,
  hasShortcutConflicts,
  isEditorShortcutMap,
  isShortcutCombo,
  isShortcutMap,
  normalizeEditorShortcutMap,
  normalizeShortcutMap,
  type EditorShortcutMap,
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

describe('editor shortcut map', () => {
  it('默认值对齐 Milkdown 内置键位，无内置键或被占用的动作默认不设', () => {
    expect(DEFAULT_EDITOR_SHORTCUT_MAP.bold).toEqual({
      mod: true,
      alt: false,
      shift: false,
      key: 'b',
    });
    expect(DEFAULT_EDITOR_SHORTCUT_MAP.italic).toEqual({
      mod: true,
      alt: false,
      shift: false,
      key: 'i',
    });
    expect(DEFAULT_EDITOR_SHORTCUT_MAP.strike).toEqual({
      mod: true,
      alt: true,
      shift: false,
      key: 'x',
    });
    expect(DEFAULT_EDITOR_SHORTCUT_MAP.heading2).toEqual({
      mod: true,
      alt: true,
      shift: false,
      key: '2',
    });
    expect(DEFAULT_EDITOR_SHORTCUT_MAP.bulletList).toEqual({
      mod: true,
      alt: true,
      shift: false,
      key: '8',
    });
    expect(DEFAULT_EDITOR_SHORTCUT_MAP.codeBlock).toEqual({
      mod: true,
      alt: true,
      shift: false,
      key: 'c',
    });
    expect(DEFAULT_EDITOR_SHORTCUT_MAP.inlineCode).toBeUndefined();
    expect(DEFAULT_EDITOR_SHORTCUT_MAP.taskList).toBeUndefined();
    expect(DEFAULT_EDITOR_SHORTCUT_MAP.link).toBeUndefined();
    expect(DEFAULT_EDITOR_SHORTCUT_MAP.table).toBeUndefined();
    expect(DEFAULT_EDITOR_SHORTCUT_MAP.deleteLine).toEqual({
      mod: true,
      alt: false,
      shift: true,
      key: 'k',
    });
  });

  it('默认编辑映射与应用映射互不冲突', () => {
    const editorConflicts = findEditorShortcutConflicts(
      DEFAULT_EDITOR_SHORTCUT_MAP,
      DEFAULT_SHORTCUT_MAP,
    );
    for (const action of EDITOR_SHORTCUT_ACTIONS) {
      expect(editorConflicts.get(action)).toEqual([]);
    }
    const appConflicts = findAppShortcutConflictsWithEditor(
      DEFAULT_SHORTCUT_MAP,
      DEFAULT_EDITOR_SHORTCUT_MAP,
    );
    for (const action of SHORTCUT_ACTIONS) {
      expect(appConflicts.get(action)).toEqual([]);
    }
  });

  it('normalizeEditorShortcutMap 合法值保留、非法与缺失回落默认、未设置保持未设置', () => {
    const result = normalizeEditorShortcutMap({
      bold: { mod: true, alt: false, shift: true, key: 'b' },
      strike: { mod: false, alt: false, shift: false, key: 'x' },
      taskList: { mod: true, alt: false, shift: false, key: '9' },
    });
    expect(result.bold).toEqual({ mod: true, alt: false, shift: true, key: 'b' });
    // 非法组合（无 mod/alt）回落默认值（strike 有默认 Mod+Alt+X）
    expect(result.strike).toEqual(DEFAULT_EDITOR_SHORTCUT_MAP.strike);
    // 合法值保留
    expect(result.taskList).toEqual({ mod: true, alt: false, shift: false, key: '9' });
    // 缺失回落默认：有默认的取默认，默认未设的保持 undefined
    expect(result.italic).toEqual(DEFAULT_EDITOR_SHORTCUT_MAP.italic);
    expect(result.link).toBeUndefined();
    expect(isEditorShortcutMap(result)).toBe(true);
  });

  it('isEditorShortcutMap 拒绝非对象与非法动作值', () => {
    expect(isEditorShortcutMap(undefined)).toBe(false);
    expect(isEditorShortcutMap({})).toBe(true);
    expect(isEditorShortcutMap({ bold: 'Ctrl+B' })).toBe(false);
    expect(isEditorShortcutMap({ bold: { mod: true, alt: false, shift: false, key: 'b' } })).toBe(
      true,
    );
  });

  it('cloneEditorShortcutMap 拷贝值且未设置保持未设置、与源不共享引用', () => {
    const source: EditorShortcutMap = {
      bold: { mod: true, alt: false, shift: false, key: 'b' },
    };
    const copy = cloneEditorShortcutMap(source);
    expect(copy.bold).not.toBe(source.bold);
    expect(copy.bold).toEqual(source.bold);
    expect(copy.link).toBeUndefined();
  });

  it('findEditorShortcutConflicts 检出格式内部冲突与跨集合冲突，未设置动作不参与', () => {
    const editorMap: EditorShortcutMap = {
      bold: { mod: true, alt: false, shift: false, key: 'b' },
      italic: { mod: true, alt: false, shift: false, key: 'b' },
      taskList: { mod: true, alt: false, shift: false, key: 's' },
      link: undefined,
    };
    const appMap: ShortcutMap = normalizeShortcutMap(DEFAULT_SHORTCUT_MAP); // save = Ctrl+S
    const conflicts = findEditorShortcutConflicts(editorMap, appMap);
    expect(conflicts.get('bold')).toContain('italic');
    expect(conflicts.get('italic')).toContain('bold');
    expect(conflicts.get('taskList')).toContain('save');
    expect(conflicts.get('link')).toEqual([]);
  });

  it('findAppShortcutConflictsWithEditor 反向检出应用动作撞格式键', () => {
    const editorMap: EditorShortcutMap = {
      bold: { mod: true, alt: false, shift: false, key: 'f' },
    };
    const appMap: ShortcutMap = normalizeShortcutMap(DEFAULT_SHORTCUT_MAP); // find = Ctrl+F
    const conflicts = findAppShortcutConflictsWithEditor(appMap, editorMap);
    expect(conflicts.get('find')).toContain('bold');
  });

  it('EDITOR_BUILTIN_COMBOS 覆盖全部有默认值的格式动作', () => {
    // deleteLine 是应用自身命令（无编辑器内置键位），不进吞键清单
    const withDefault = EDITOR_SHORTCUT_ACTIONS.filter(
      (a) => DEFAULT_EDITOR_SHORTCUT_MAP[a] && a !== 'deleteLine',
    );
    expect(EDITOR_BUILTIN_COMBOS).toHaveLength(withDefault.length);
    for (const combo of EDITOR_BUILTIN_COMBOS) {
      expect(isShortcutCombo(combo)).toBe(true);
    }
  });
});
