// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { Editor } from '@milkdown/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { editorViewCtx, parserCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { joinBackward } from '@milkdown/kit/prose/commands';
import { history, undo, closeHistory } from '@milkdown/kit/prose/history';
import { $prose } from '@milkdown/kit/utils';
import { listKeymap, shouldLiftListItemOnBackspace } from './list-keymap';
import { listMarker } from './list-marker';

/// `shouldLiftListItemOnBackspace` 决定「列表项行首 Backspace」是否改为提升出列表，
/// 而非走默认的合并到前一项。这里覆盖它的全部分支：任务项/普通无序/有序项、项内
/// 首块/后续块、行首/非行首、修饰键、选区、按键名。
describe('shouldLiftListItemOnBackspace', () => {
  const base = {
    key: 'Backspace',
    hasModifier: false,
    selectionEmpty: true,
    parentOffset: 0,
    inListItem: true,
    atFirstBlockInItem: true,
  };

  it('列表项（无序/有序/任务，判定同构）行首 + 纯 Backspace 拦截（本次修复的核心场景）', () => {
    expect(shouldLiftListItemOnBackspace({ ...base })).toBe(true);
  });

  it('不在列表项内（普通段落行首）不拦截，走默认行为', () => {
    expect(shouldLiftListItemOnBackspace({ ...base, inListItem: false })).toBe(false);
  });

  it('松散列表项的后续块行首不拦截（默认合并到项内上一块，不整体提升）', () => {
    expect(shouldLiftListItemOnBackspace({ ...base, atFirstBlockInItem: false })).toBe(false);
  });

  it('光标不在行首时不拦截（让默认 Backspace 删字符）', () => {
    expect(shouldLiftListItemOnBackspace({ ...base, parentOffset: 3 })).toBe(false);
  });

  it('带 Ctrl/Meta/Alt 修饰键时不拦截（组合键语义不同）', () => {
    expect(shouldLiftListItemOnBackspace({ ...base, hasModifier: true })).toBe(false);
  });

  it('非空选区时不拦截（让默认删除处理选区内容）', () => {
    expect(shouldLiftListItemOnBackspace({ ...base, selectionEmpty: false })).toBe(false);
  });

  it('非 Backspace 键不拦截（Delete 走自己的分支）', () => {
    expect(shouldLiftListItemOnBackspace({ ...base, key: 'Delete' })).toBe(false);
  });
});

async function makeEditor(markdown: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
    })
    .use(commonmark)
    .use(gfm)
    .use(listKeymap);
  const instance = await editor.create();
  const view = instance.ctx.get(editorViewCtx);
  const parser = instance.ctx.get(parserCtx);
  const doc = parser(markdown);
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
  return {
    instance,
    view,
    serialize: instance.ctx.get(serializerCtx) as (doc: any) => string,
  };
}

function textPosition(view: any, text: string): number {
  let position = -1;
  view.state.doc.descendants((node: any, pos: number) => {
    if (position < 0 && node.isText && node.text === text) position = pos;
  });
  if (position < 0) throw new Error(`text not found: ${text}`);
  return position;
}

function placeCursor(view: any, text: string, offset = 0): void {
  const position = textPosition(view, text) + offset;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
}

function firstParagraphContentPosition(view: any): number {
  let position = -1;
  view.state.doc.descendants((node: any, pos: number) => {
    if (position < 0 && node.type.name === 'paragraph') position = pos + 1;
  });
  if (position < 0) throw new Error('paragraph not found');
  return position;
}

function fireKey(view: any, init: KeyboardEventInit): boolean {
  let handled = false;
  view.someProp('handleKeyDown', (handler: any) => {
    handled = handler(view, new KeyboardEvent('keydown', { bubbles: true, ...init }));
    return handled;
  });
  return handled;
}

describe('列表键位真实编辑器接缝', () => {
  it('单项顶层列表的首字退格会直接转成顶格正文', async () => {
    const { instance, view } = await makeEditor('- 事项');
    placeCursor(view, '事项');

    expect(fireKey(view, { key: 'Backspace' })).toBe(true);
    const root = view.state.doc.toJSON();
    expect(root.content).toHaveLength(1);
    expect(root.content[0].type).toBe('paragraph');
    expect(root.content[0].content[0].text).toBe('事项');
    await instance.destroy();
  });

  it('多项顶层列表的首字退格会把当前项提升为独立正文', async () => {
    const { instance, view, serialize } = await makeEditor('- A\n- B\n- C');
    placeCursor(view, 'B');

    expect(fireKey(view, { key: 'Backspace' })).toBe(true);
    expect(view.state.doc.toJSON().content.map((node: any) => node.type)).toEqual([
      'bullet_list',
      'paragraph',
      'bullet_list',
    ]);
    const reopened = instance.ctx.get(parserCtx)(serialize(view.state.doc));
    expect(reopened.child(1).type.name).toBe('paragraph');
    expect(reopened.child(1).textContent).toBe('B');
    expect(reopened.child(0).textContent).toBe('A');
    expect(reopened.child(2).textContent).toBe('C');
    await instance.destroy();
  });

  it('嵌套列表首字退格会提升到父列表，保留为独立列表项', async () => {
    const { instance, view } = await makeEditor('- A\n  - B');
    placeCursor(view, 'B');

    expect(fireKey(view, { key: 'Backspace' })).toBe(true);
    const root = view.state.doc.toJSON();
    expect(root.content[0].content).toHaveLength(2);
    expect(root.content[0].content[1].content[0].content[0].text).toBe('B');
    await instance.destroy();
  });

  it('任务项退格不会吞掉前一项的勾选状态', async () => {
    const { instance, view } = await makeEditor('- [x] 已完成\n- [ ] 待处理');
    placeCursor(view, '待处理');

    expect(fireKey(view, { key: 'Backspace' })).toBe(true);
    const root = view.state.doc.toJSON();
    expect(root.content[0].content[0].attrs.checked).toBe(true);
    expect(root.content[1].content[0].text).toBe('待处理');
    await instance.destroy();
  });

  it('普通列表和任务列表在首字 Delete 时删除一个完整可见字符', async () => {
    const { instance, view } = await makeEditor('- A\n- [ ] 👩‍💻开会');
    placeCursor(view, '👩‍💻开会');

    expect(fireKey(view, { key: 'Delete' })).toBe(true);
    const root = view.state.doc.toJSON();
    expect(root.content[0].content).toHaveLength(2);
    expect(root.content[0].content[1].content[0].content[0].text).toBe('开会');
    expect(root.content[0].content[1].attrs.checked).toBe(false);
    await instance.destroy();
  });

  it('首项是图片时 Delete 删除图片节点，不合并后续文字', async () => {
    const { instance, view } = await makeEditor('- ![图](x.png)后');
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, firstParagraphContentPosition(view)),
      ),
    );

    expect(fireKey(view, { key: 'Delete' })).toBe(true);
    const paragraph = view.state.doc.toJSON().content[0].content[0].content[0];
    expect(paragraph.content[0].text).toBe('后');
    await instance.destroy();
  });

  it('首项是硬换行时 Delete 删除硬换行节点，不合并后续文字', async () => {
    const { instance, view } = await makeEditor('- 后');
    const hardbreak = view.state.schema.nodes.hardbreak.create();
    const position = firstParagraphContentPosition(view);
    view.dispatch(view.state.tr.insert(position, hardbreak));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));

    expect(fireKey(view, { key: 'Delete' })).toBe(true);
    const paragraph = view.state.doc.toJSON().content[0].content[0].content[0];
    expect(paragraph.content[0].text).toBe('后');
    await instance.destroy();
  });

  it('父项末尾回车会在已有子列表的首位创建空子项', async () => {
    const { instance, view } = await makeEditor('- 父项\n  - 明细甲\n  - 明细乙');
    placeCursor(view, '父项', '父项'.length);

    expect(fireKey(view, { key: 'Enter' })).toBe(true);
    const root = view.state.doc.toJSON();
    const nestedList = root.content[0].content[0].content[1];
    expect(nestedList.type).toBe('bullet_list');
    expect(nestedList.content).toHaveLength(3);
    expect(nestedList.content[0].content[0].type).toBe('paragraph');
    expect(nestedList.content[0].content[0].content).toBeUndefined();
    expect(nestedList.content[1].content[0].content[0].text).toBe('明细甲');
    await instance.destroy();
  });

  it('父项末尾回车创建的任务子项默认未勾选', async () => {
    const { instance, view } = await makeEditor('- 父项\n  - [x] 已完成');
    placeCursor(view, '父项', '父项'.length);

    expect(fireKey(view, { key: 'Enter' })).toBe(true);
    const nestedList = view.state.doc.toJSON().content[0].content[0].content[1];
    expect(nestedList.content[0].attrs.checked).toBe(false);
    expect(nestedList.content[1].attrs.checked).toBe(true);
    await instance.destroy();
  });

  it('无序列表两步退格删掉中间空行后，上下列表自动重新连接', async () => {
    const { instance, view } = await makeEditor('- A\n- B\n- C');
    placeCursor(view, 'B');

    // 第一步退格：中间项先变成普通段落，列表暂时断开
    expect(fireKey(view, { key: 'Backspace' })).toBe(true);
    expect(view.state.doc.toJSON().content.map((node: any) => node.type)).toEqual([
      'bullet_list',
      'paragraph',
      'bullet_list',
    ]);

    // 清空中间段落并执行第二步退格（Backspace 删掉空段落）
    const pPos = textPosition(view, 'B');
    view.dispatch(view.state.tr.delete(pPos, pPos + 1));
    expect(fireKey(view, { key: 'Backspace' })).toBe(true);

    const root = view.state.doc.toJSON();
    expect(root.content.map((node: any) => node.type)).toEqual(['bullet_list']);
    expect(root.content[0].content).toHaveLength(2);
    expect(root.content[0].content[0].content[0].content[0].text).toBe('A');
    expect(root.content[0].content[1].content[0].content[0].text).toBe('C');
    await instance.destroy();
  });

  it('有序列表两步退格删掉中间空行后，上下列表自动连接且序号连续', async () => {
    const { instance, view, serialize } = await makeEditor('1. A\n2. B\n3. C');
    placeCursor(view, 'B');

    expect(fireKey(view, { key: 'Backspace' })).toBe(true);
    expect(view.state.doc.toJSON().content.map((node: any) => node.type)).toEqual([
      'ordered_list',
      'paragraph',
      'ordered_list',
    ]);

    const pPos = textPosition(view, 'B');
    view.dispatch(view.state.tr.delete(pPos, pPos + 1));
    expect(fireKey(view, { key: 'Backspace' })).toBe(true);

    const root = view.state.doc.toJSON();
    expect(root.content.map((node: any) => node.type)).toEqual(['ordered_list']);
    expect(root.content[0].content).toHaveLength(2);
    expect(serialize(view.state.doc)).toContain('2. C');
    await instance.destroy();
  });

  it('不同类型的列表相邻时不会强行合并', async () => {
    const { instance, view } = await makeEditor('- A\n\n1. C');
    // 在无序和有序之间插入空段落再删掉，确认不会合并
    const secondListPos = view.state.doc.child(0).nodeSize;
    const emptyP = view.state.schema.nodes.paragraph.create();
    view.dispatch(view.state.tr.insert(secondListPos, emptyP));
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, secondListPos + 1)),
    );
    expect(joinBackward(view.state, (tr) => view.dispatch(tr))).toBe(true);

    expect(view.state.doc.toJSON().content.map((node: any) => node.type)).toEqual([
      'bullet_list',
      'ordered_list',
    ]);
    await instance.destroy();
  });

  it('不同标记符号的无序列表相邻时不合并（例如 - 与 *）', async () => {
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, rootEl);
      })
      .use(commonmark)
      .use(gfm)
      .use(listMarker)
      .use(listKeymap);
    const instance = await editor.create();
    const view = instance.ctx.get(editorViewCtx);
    const doc = instance.ctx.get(parserCtx)('- A\n\n* C');
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));

    expect(view.state.doc.toJSON().content.map((node: any) => node.type)).toEqual([
      'bullet_list',
      'bullet_list',
    ]);
    await instance.destroy();
  });

  it('自动合并后支持撤回恢复到断开前的中间段落状态', async () => {
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, rootEl);
      })
      .use(commonmark)
      .use(gfm)
      .use($prose(() => history()))
      .use(listKeymap);
    const instance = await editor.create();
    const view = instance.ctx.get(editorViewCtx);
    const doc = instance.ctx.get(parserCtx)('- A\n- \n- C');
    view.dispatch(
      view.state.tr
        .replaceWith(0, view.state.doc.content.size, doc.content)
        .setMeta('addToHistory', false),
    );

    // 光标放到第 2 个空列表项的段落内
    const secondItemParagraphPos = view.state.doc.child(0).child(0).nodeSize + 3;
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, secondItemParagraphPos))
        .setMeta('addToHistory', false),
    );

    // 第一步退格：变空段落
    expect(fireKey(view, { key: 'Backspace' })).toBe(true);
    expect(view.state.doc.toJSON().content.map((node: any) => node.type)).toEqual([
      'bullet_list',
      'paragraph',
      'bullet_list',
    ]);

    // 模拟用户停顿后再按第二次退格，使两次退格成为独立的可撤回步骤
    view.dispatch(closeHistory(view.state.tr));

    // 第二步退格：删掉空段落并自动重连
    expect(fireKey(view, { key: 'Backspace' })).toBe(true);
    const joinedRoot = view.state.doc.toJSON();
    expect(joinedRoot.content.map((node: any) => node.type)).toEqual(['bullet_list']);
    expect(joinedRoot.content[0].content).toHaveLength(2);

    // 撤回：恢复到带有中间空段落的断开状态
    expect(undo(view.state, (tr) => view.dispatch(tr))).toBe(true);
    expect(view.state.doc.toJSON().content.map((node: any) => node.type)).toEqual([
      'bullet_list',
      'paragraph',
      'bullet_list',
    ]);
    await instance.destroy();
  });
});
