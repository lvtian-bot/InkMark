// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Editor, parserCtx, rootCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { breaks } from './plugins/breaks';
import { deleteEditorLines } from './delete-editor-lines';

describe('所见即所得删除整行', () => {
  const editor = Editor.make()
    .config((ctx) => ctx.set(rootCtx, document.body))
    .use(commonmark)
    .use(gfm)
    .use(breaks);
  beforeAll(async () => {
    await editor.create();
  });
  afterAll(async () => {
    await editor.destroy();
  });

  function remove(markdown: string, start: string, end?: string, includeEnd = false) {
    const doc = editor.ctx.get(parserCtx)(markdown);
    function offset(text: string) {
      let found = -1;
      doc.descendants((node, pos) => {
        if (found < 0 && node.text?.includes(text)) found = pos + node.text.indexOf(text);
      });
      if (found < 0) throw new Error(text);
      return found;
    }
    const from = offset(start);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(
        doc,
        from,
        end ? offset(end) + (includeEnd ? end.length : 0) : from,
      ),
    });
    const result = deleteEditorLines(state)?.doc ?? doc;
    result.check();
    return result;
  }

  it('删除父项时子项保留并提升一级', () => {
    const doc = remove('- 父项\n  - [x] 明细甲\n  - 明细乙\n- 下一项', '父项');
    expect(doc.firstChild?.childCount).toBe(3);
    expect(doc.textContent).toBe('明细甲明细乙下一项');
    expect(doc.firstChild?.firstChild?.attrs.checked).toBe(true);
  });

  it('选区结束于下一行行首时保留该行', () => {
    const doc = remove('甲\n乙\n丙\n\n末段', '甲', '丙');
    expect(doc.textContent).toBe('丙末段');
  });

  it('段内硬换行和代码换行只删除当前行', () => {
    expect(remove('甲\n乙\n\n丙', '乙').firstChild?.textContent).toBe('甲');
    expect(remove('```\n甲\n乙\n丙\n```', '乙').firstChild?.textContent).toBe('甲\n丙');
  });

  it('删除普通列表的唯一一项不留下空列表', () => {
    expect(remove('前段\n\n- 删除\n\n后段', '删除').childCount).toBe(2);
  });

  it('删除无序父项时保留中间的有序子列表及前后兄弟项', () => {
    const doc = remove('- 开头\n- 父项\n\n  3. 明细\n- 结尾', '父项');
    expect(doc.textContent).toBe('开头明细结尾');
    expect(doc.childCount).toBe(3);
    expect(doc.child(1).type.name).toBe('ordered_list');
    expect(doc.child(1).attrs.order).toBe(3);
  });

  it('跨段落删除时一并删除选区内的分隔线', () => {
    const doc = remove('左段\n\n前段\n\n---\n\n后段\n\n右段', '前段', '后段', true);
    expect(doc.textContent).toBe('左段右段');
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.child(1).type.name).toBe('paragraph');
  });

  it('选区外的分隔线保持不变', () => {
    const doc = remove('左段\n\n---\n\n右段', '左段');
    expect(doc.textContent).toBe('右段');
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe('hr');
    expect(doc.child(1).type.name).toBe('paragraph');
  });

  it('选区经过表格时不执行删除', () => {
    const doc = remove('前段\n\n| 列 |\n| --- |\n| 内容 |\n\n后段', '前段', '后段', true);
    expect(doc.textContent).toBe('前段列内容后段');
    expect(doc.childCount).toBe(3);
    expect(doc.child(1).type.spec.tableRole).toBe('table');
  });
});
