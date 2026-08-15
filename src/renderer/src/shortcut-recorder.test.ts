import { describe, expect, it } from 'vitest';
import {
  comboFromKeyboardEvent,
  comboMatchesEvent,
  normalizeKeyFromEvent,
} from './shortcut-recorder';
import type { ShortcutCombo } from '../../shared/shortcuts';

function makeKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    key: '',
    code: '',
    ...overrides,
  } as KeyboardEvent;
}

describe('normalizeKeyFromEvent', () => {
  it('标准英文字符优先返回小写 event.key', () => {
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: '/', code: 'Slash' }))).toBe('/');
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: ',', code: 'Comma' }))).toBe(',');
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: 'F', code: 'KeyF' }))).toBe('f');
  });

  it('中文输入法/标点模式下通过 event.code 回捞英文字符', () => {
    // 中文顿号 -> Slash (/)
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: '、', code: 'Slash' }))).toBe('/');
    // 中文句号 -> Period (.)
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: '。', code: 'Period' }))).toBe('.');
    // 中文全角逗号 -> Comma (,)
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: '，', code: 'Comma' }))).toBe(',');
    // 微软拼音 Process 状态
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: 'Process', code: 'Slash' }))).toBe('/');
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: 'Process', code: 'Comma' }))).toBe(',');
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: 'Process', code: 'KeyE' }))).toBe('e');

    // 缺少 code 时通过中文标点表直接映射
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: '。' }))).toBe('.');
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: '、' }))).toBe('/');
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: '，' }))).toBe(',');

    // 缺少 code 时通过 keyCode 回捞
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: 'Unidentified', keyCode: 191 }))).toBe('/');
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: 'Unidentified', keyCode: 188 }))).toBe(',');
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: 'Unidentified', keyCode: 190 }))).toBe('.');
    expect(normalizeKeyFromEvent(makeKeyEvent({ key: 'Unidentified', keyCode: 69 }))).toBe('e');
  });
});

describe('comboMatchesEvent', () => {
  const slashCombo: ShortcutCombo = { mod: true, alt: false, shift: false, key: '/' };
  const eCombo: ShortcutCombo = { mod: true, alt: false, shift: false, key: 'e' };
  const settingsCombo: ShortcutCombo = { mod: true, alt: false, shift: false, key: ',' };

  it('匹配 Windows 下的标准 Ctrl+E、Ctrl+/ 与 Ctrl+,', () => {
    const eEvent = makeKeyEvent({ ctrlKey: true, key: 'e', code: 'KeyE' });
    expect(comboMatchesEvent(eEvent, eCombo, 'win32')).toBe(true);

    const slashEvent = makeKeyEvent({ ctrlKey: true, key: '/', code: 'Slash' });
    expect(comboMatchesEvent(slashEvent, slashCombo, 'win32')).toBe(true);

    const commaEvent = makeKeyEvent({ ctrlKey: true, key: ',', code: 'Comma' });
    expect(comboMatchesEvent(commaEvent, settingsCombo, 'win32')).toBe(true);
  });

  it('在中文输入法下仍能准确命中 Ctrl+/ 与 Ctrl+,', () => {
    const slashImeEvent = makeKeyEvent({ ctrlKey: true, key: '、', code: 'Slash' });
    expect(comboMatchesEvent(slashImeEvent, slashCombo, 'win32')).toBe(true);

    const commaImeEvent = makeKeyEvent({ ctrlKey: true, key: '，', code: 'Comma' });
    expect(comboMatchesEvent(commaImeEvent, settingsCombo, 'win32')).toBe(true);
  });

  it('修饰键不一致时不匹配', () => {
    const altSlashEvent = makeKeyEvent({ ctrlKey: false, altKey: true, key: '/', code: 'Slash' });
    expect(comboMatchesEvent(altSlashEvent, slashCombo, 'win32')).toBe(false);

    const shiftCommaEvent = makeKeyEvent({
      ctrlKey: true,
      shiftKey: true,
      key: ',',
      code: 'Comma',
    });
    expect(comboMatchesEvent(shiftCommaEvent, settingsCombo, 'win32')).toBe(false);
  });

  it('Mac 平台适配 Cmd 键', () => {
    const cmdSlashEvent = makeKeyEvent({ metaKey: true, key: '/', code: 'Slash' });
    expect(comboMatchesEvent(cmdSlashEvent, slashCombo, 'darwin')).toBe(true);
    expect(comboMatchesEvent(cmdSlashEvent, slashCombo, 'win32')).toBe(false);

    const cmdEEvent = makeKeyEvent({ metaKey: true, key: 'e', code: 'KeyE' });
    expect(comboMatchesEvent(cmdEEvent, eCombo, 'darwin')).toBe(true);
    expect(comboMatchesEvent(cmdEEvent, eCombo, 'win32')).toBe(false);
  });
});

describe('comboFromKeyboardEvent', () => {
  it('从中文标点按键中正确录入快捷键', () => {
    const imeEvent = makeKeyEvent({ ctrlKey: true, key: '、', code: 'Slash' });
    const combo = comboFromKeyboardEvent(imeEvent, 'win32');
    expect(combo).toEqual({ mod: true, alt: false, shift: false, key: '/' });
  });

  it('正确录入纯 Alt 组合键（如 Alt+E）', () => {
    const altEEvent = makeKeyEvent({ altKey: true, key: 'e', code: 'KeyE' });
    const combo = comboFromKeyboardEvent(altEEvent, 'win32');
    expect(combo).toEqual({ mod: false, alt: true, shift: false, key: 'e' });
  });

  it('纯修饰键返回 null', () => {
    const ctrlEvent = makeKeyEvent({ ctrlKey: true, key: 'Control', code: 'ControlLeft' });
    expect(comboFromKeyboardEvent(ctrlEvent, 'win32')).toBeNull();

    const altEvent = makeKeyEvent({ altKey: true, key: 'Alt', code: 'AltLeft' });
    expect(comboFromKeyboardEvent(altEvent, 'win32')).toBeNull();
  });
});
