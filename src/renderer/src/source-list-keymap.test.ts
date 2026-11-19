// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { sourceListBackspace, sourceListEnter, sourceListKeymap } from './source-list-keymap';

function applyCommand(
  doc: string,
  position: number,
  command: typeof sourceListBackspace | typeof sourceListEnter,
): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown(), sourceListKeymap],
  });
  const root = document.createElement('div');
  const view = new EditorView({ state, parent: root });
  view.dispatch({ selection: EditorSelection.cursor(position) });
  command(view);
  const nextState = view.state;
  view.destroy();
  return nextState;
}

describe('源码模式列表按键', () => {
  it('顶层列表项行首退格转成独立正文，并避免并入上一项', () => {
    const state = applyCommand('- 甲\n- 乙', 6, sourceListBackspace);
    expect(state.doc.toString()).toBe('- 甲\n\n乙');
    expect(state.selection.main.from).toBe(5);
  });

  it('嵌套列表项行首退格提升一级并保留列表标记', () => {
    const state = applyCommand('- 父项\n  - 子项', 9, sourceListBackspace);
    expect(state.doc.toString()).toBe('- 父项\n- 子项');
    expect(state.selection.main.from).toBe(7);
  });

  it('按语法父项缩进提升，不固定假设两格空格', () => {
    const state = applyCommand('1. 父项\n    - 子项', 12, sourceListBackspace);
    expect(state.doc.toString()).toBe('1. 父项\n- 子项');
  });

  it('提升带子项的列表项时同步移动其后代缩进', () => {
    const state = applyCommand('- 父项\n    - 子项\n        - 孙项', 11, sourceListBackspace);
    expect(state.doc.toString()).toBe('- 父项\n- 子项\n    - 孙项');
  });

  it('空列表项回车立即结束列表', () => {
    const state = applyCommand('- 甲\n- ', 6, sourceListEnter);
    expect(state.doc.toString()).toBe('- 甲\n\n');
    expect(state.selection.main.from).toBe(5);
  });

  it('在任务文字前退格同时移除复选框，空任务回车后直接写正文', () => {
    const text = '- [x] 已完成\n- [ ] 待处理';
    const state = applyCommand(text, text.indexOf('待处理'), sourceListBackspace);
    expect(state.doc.toString()).toBe('- [x] 已完成\n\n待处理');
    const empty = '- 已完成\n- [ ] ';
    const typing = applyCommand(empty, empty.length, sourceListEnter);
    const next = typing.update(typing.replaceSelection('正文')).state;
    expect(next.doc.toString()).toBe('- 已完成\n\n正文');
  });

  it('顶层退格时让下一条非一开头的编号继续构成列表', () => {
    const state = applyCommand('1. 甲\n2. 乙', 3, sourceListBackspace);
    expect(state.doc.toString()).toBe('甲\n\n2. 乙');
  });

  it('代码围栏中的伪列表不触发列表退格', () => {
    const state = applyCommand('```\n- 命令\n```', 7, sourceListBackspace);
    expect(state.doc.toString()).toBe('```\n- 命令\n```');
  });
});
