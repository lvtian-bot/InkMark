// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@milkdown/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { commandsCtx, editorViewCtx, parserCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { taskList } from './task-list';
import {
  toggleBulletListCommand,
  toggleHeadingCommand,
  toggleOrderedListCommand,
  toggleTaskListCommand,
} from './list-format';

let activeEditor: Awaited<ReturnType<typeof createEditor>> | null = null;

async function createEditor(markdown = '') {
  const root = document.createElement('div');
  document.body.append(root);
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
    })
    .use(commonmark)
    .use(gfm)
    .use(taskList)
    .use(toggleBulletListCommand)
    .use(toggleOrderedListCommand)
    .use(toggleHeadingCommand);
  const instance = await editor.create();
  const view = instance.ctx.get(editorViewCtx);
  const doc = instance.ctx.get(parserCtx)(markdown);
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
  return {
    instance,
    view,
    serialize: instance.ctx.get(serializerCtx),
    commands: instance.ctx.get(commandsCtx),
  };
}

function placeSelection(view: EditorView, startText: string, endText = startText): void {
  let from = -1;
  let to = -1;
  view.state.doc.descendants((node: ProseNode, pos: number) => {
    if (!node.isText) return;
    const text = node.text ?? '';
    if (from < 0 && text.includes(startText)) from = pos + text.indexOf(startText);
    if (to < 0 && text.includes(endText)) to = pos + text.indexOf(endText) + endText.length;
  });
  if (from < 0 || to < 0) throw new Error(`Text not found: ${startText}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}

function placeSelectionBefore(view: EditorView, startText: string, endText: string): void {
  let from = -1;
  let to = -1;
  view.state.doc.descendants((node: ProseNode, pos: number) => {
    if (!node.isText) return;
    const text = node.text ?? '';
    if (from < 0 && text.includes(startText)) from = pos + text.indexOf(startText);
    if (to < 0 && text.includes(endText)) to = pos + text.indexOf(endText);
  });
  if (from < 0 || to < 0) throw new Error(`Text not found: ${startText}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}

afterEach(async () => {
  await activeEditor?.instance.destroy();
  activeEditor = null;
  document.body.replaceChildren();
});

describe('所见即所得格式切换', () => {
  it('选中的多个段落可以批量切换无序列表，并再次还原', async () => {
    activeEditor = await createEditor('甲\n\n乙\n\n丙');
    placeSelection(activeEditor.view, '甲', '乙');
    activeEditor.commands.call(toggleBulletListCommand.key);
    expect(activeEditor.serialize(activeEditor.view.state.doc)).toBe('* 甲\n* 乙\n\n丙\n');

    placeSelection(activeEditor.view, '甲', '乙');
    activeEditor.commands.call(toggleBulletListCommand.key);
    expect(activeEditor.serialize(activeEditor.view.state.doc)).toBe('甲\n\n乙\n\n丙\n');
  });

  it('再次点击已有有序列表可以还原为正文', async () => {
    activeEditor = await createEditor('1. 甲\n2. 乙\n3. 丙');
    placeSelection(activeEditor.view, '甲', '乙');
    activeEditor.commands.call(toggleOrderedListCommand.key);
    expect(activeEditor.serialize(activeEditor.view.state.doc)).toBe('甲\n\n乙\n\n1. 丙\n');
  });

  it.each([
    ['无序', '- ', toggleBulletListCommand, 'bullet_list'],
    ['有序', '1. ', toggleOrderedListCommand, 'ordered_list'],
  ] as const)(
    '跨分隔线取消%s列表只影响选中项，并保留反向选区',
    async (_, prefix, command, type) => {
      activeEditor = await createEditor(
        `${prefix}上文\n${prefix}甲乙\n\n---\n\n${prefix}丙丁\n${prefix}下文`,
      );
      const { view, commands } = activeEditor;
      placeSelection(view, '乙', '丙');
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, to, from)));
      commands.call(command.key);
      const { doc, selection } = view.state;
      expect(Array.from({ length: doc.childCount }, (_, i) => doc.child(i).type.name)).toEqual([
        type,
        'paragraph',
        'hr',
        'paragraph',
        type,
      ]);
      expect(doc.textContent).toBe('上文甲乙丙丁下文');
      expect(doc.textBetween(selection.from, selection.to)).toBe('乙丙');
      expect(selection.anchor).toBeGreaterThan(selection.head);
    },
  );

  it('选区结束在下一段开头时不把下一段一起转换', async () => {
    activeEditor = await createEditor('甲\n\n乙\n\n丙');
    placeSelectionBefore(activeEditor.view, '甲', '乙');
    activeEditor.commands.call(toggleBulletListCommand.key);
    expect(activeEditor.serialize(activeEditor.view.state.doc)).toBe('* 甲\n\n乙\n\n丙\n');
  });

  it('跨列表取消父项时，嵌套明细只随父项退出一级', async () => {
    activeEditor = await createEditor('- 父项\n  - [x] 明细\n\n---\n\n- 末项');
    const { view, commands } = activeEditor;
    placeSelection(view, '父项', '末项');
    commands.call(toggleBulletListCommand.key);
    const { doc } = view.state;
    expect(doc.childCount).toBe(4);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.child(1).type.name).toBe('bullet_list');
    expect(doc.child(1).child(0).attrs.checked).toBe(true);
    expect(doc.child(1).textContent).toBe('明细');
    expect(doc.child(2).type.name).toBe('hr');
    expect(doc.child(3).type.name).toBe('paragraph');
  });

  it('任务列表混选时只给普通项补未勾选状态，已完成项保持完成', async () => {
    activeEditor = await createEditor('- [x] 完成\n- 普通');
    placeSelection(activeEditor.view, '完成', '普通');
    activeEditor.commands.call(toggleTaskListCommand.key);
    expect(activeEditor.serialize(activeEditor.view.state.doc)).toContain('* [x] 完成');
    expect(activeEditor.serialize(activeEditor.view.state.doc)).toContain('* [ ] 普通');
  });

  it('任务列表混选普通段落时也会把普通段落转为待办', async () => {
    activeEditor = await createEditor('- [x] 完成\n\n普通');
    placeSelection(activeEditor.view, '完成', '普通');
    activeEditor.commands.call(toggleTaskListCommand.key);
    const markdown = activeEditor.serialize(activeEditor.view.state.doc);
    expect(markdown).toContain('[x] 完成');
    expect(markdown).toContain('[ ] 普通');
  });

  it('局部选区转换列表后仍只选中原文字', async () => {
    activeEditor = await createEditor('甲乙');
    placeSelection(activeEditor.view, '甲');
    activeEditor.commands.call(toggleBulletListCommand.key);
    expect(
      activeEditor.view.state.doc.textBetween(
        activeEditor.view.state.selection.from,
        activeEditor.view.state.selection.to,
      ),
    ).toBe('甲');
  });

  it('同级标题再次点击会切回正文', async () => {
    activeEditor = await createEditor('## 甲\n乙');
    placeSelection(activeEditor.view, '甲', '乙');
    activeEditor.commands.call(toggleHeadingCommand.key, 2);
    placeSelection(activeEditor.view, '甲', '乙');
    activeEditor.commands.call(toggleHeadingCommand.key, 2);
    expect(activeEditor.serialize(activeEditor.view.state.doc)).toContain('甲\n\n乙');
  });

  it('不允许的块级标题转换不会破坏容器结构', async () => {
    activeEditor = await createEditor('| a | b |\n| --- | --- |\n| c | d |');
    placeSelection(activeEditor.view, 'a');
    expect(() => activeEditor?.commands.call(toggleHeadingCommand.key, 2)).not.toThrow();
    expect(activeEditor.serialize(activeEditor.view.state.doc)).toContain('| a | b |');
  });
});
