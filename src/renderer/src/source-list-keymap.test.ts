// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { defaultKeymap } from '@codemirror/commands';
import { EditorView, keymap, runScopeHandlers } from '@codemirror/view';
import { sourceBackspaceKeymap, sourceListKeymap } from './source-list-keymap';

let editor: EditorView | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function openSource(doc: string, from: number, to = from, plainText = false) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: [
      sourceBackspaceKeymap,
      keymap.of(defaultKeymap),
      ...(plainText ? [] : [markdown({ base: markdownLanguage }), sourceListKeymap]),
    ],
  });
  const view = new EditorView({ state });
  editor = view;
  return view;
}

function press(view: EditorView, key: string) {
  expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key }), 'editor')).toBe(true);
  return view.state.doc.toString();
}

describe('源码模式列表按键', () => {
  it.each([
    ['- 事项', '事项', '-事项', '事项'],
    ['- 甲\n- 乙\n- 丙', '乙', '- 甲\n-乙\n- 丙', '- 甲\n乙\n- 丙'],
    ['- 父\n    - 子', '子', '- 父\n    -子', '- 父\n    子'],
    ['12. 事项', '事项', '12.事项', '12事项'],
    ['- [x] 待办', '待办', '- [x]待办', '- [x待办'],
    ['> 引文', '引文', '>引文', '引文'],
  ])('退格只删除光标前的一个字符：%s', (doc, cursor, first, second) => {
    const start = doc.indexOf(cursor);
    const view = openSource(doc, start);
    expect(press(view, 'Backspace')).toBe(first);
    expect(press(view, 'Backspace')).toBe(second);
    expect(view.state.selection.main.head).toBe(start - 2);
  });

  it.each([true, false])('缩进区一次只删除一个空格，纯文本模式 %s', (plainText) => {
    const view = openSource('    正文', 4, 4, plainText);
    expect(press(view, 'Backspace')).toBe('   正文');
  });

  it('已有选区时删除所选内容', () => {
    const view = openSource('- [x] 事项', 2, 6);
    expect(press(view, 'Backspace')).toBe('- 事项');
  });

  it.each(['- ', '- [ ] '])('空列表项按回车后直接写正文：%s', (prefix) => {
    const doc = '- 甲\n' + prefix;
    const view = openSource(doc, doc.length);
    expect(press(view, 'Enter')).toBe('- 甲\n\n');
    view.dispatch(view.state.replaceSelection('正文'));
    expect(view.state.doc.toString()).toBe('- 甲\n\n正文');
  });
});
