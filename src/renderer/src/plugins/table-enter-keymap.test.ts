// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { Editor } from '@milkdown/core';
import { commonmark, hardbreakFilterNodes } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import {
  rootCtx,
  parserCtx,
  serializerCtx,
  remarkStringifyOptionsCtx,
  editorViewCtx,
} from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { breakHandler, dropBrPlaceholderHandler } from '../markdown-stringify-options';
import { breaks } from './breaks';
import { cellBrRemark, cellAwareHardbreak } from './table-cell-breaks';
import { tableEnterKeymap, tableKeyAction } from './table-enter-keymap';

describe('tableKeyAction（纯函数）', () => {
  const base = { key: 'Enter', shiftKey: false, modKey: false, inTable: true };

  it('表格内普通 Enter：跳格/加行', () => {
    expect(tableKeyAction(base)).toBe('next-cell-or-add-row');
  });

  it('表格内 Shift+Enter：格内硬换行', () => {
    expect(tableKeyAction({ ...base, shiftKey: true })).toBe('insert-hardbreak');
  });

  it('表格内普通 Tab：跳格/加行；Shift+Tab 不拦截', () => {
    expect(tableKeyAction({ ...base, key: 'Tab' })).toBe('next-cell-or-add-row');
    expect(tableKeyAction({ ...base, key: 'Tab', shiftKey: true })).toBeNull();
  });

  it('带 Ctrl/Meta/Alt 修饰时不拦截（Ctrl+Enter 跳出表格走预设键位）', () => {
    expect(tableKeyAction({ ...base, modKey: true })).toBeNull();
    expect(tableKeyAction({ ...base, key: 'Tab', modKey: true })).toBeNull();
  });

  it('表格外与其他按键不拦截', () => {
    expect(tableKeyAction({ ...base, inTable: false })).toBeNull();
    expect(tableKeyAction({ ...base, key: 'a' })).toBeNull();
  });
});

// 复刻 Editor.tsx 的插件编排与序列化注入（生产同构配置）。
async function makeEditor(markdown: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  let ctx: any;
  const editor = Editor.make()
    .config((c) => {
      c.set(rootCtx, root);
      ctx = c;
      c.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        handlers: {
          ...options.handlers,
          html: dropBrPlaceholderHandler,
          break: breakHandler,
        },
      }));
      c.update(hardbreakFilterNodes.key, (nodes: string[]) => nodes.filter((n) => n !== 'table'));
    })
    .use(cellBrRemark)
    .use(commonmark)
    .use(gfm)
    .use(breaks)
    .use(cellAwareHardbreak)
    .use(tableEnterKeymap);
  const instance = await editor.create();
  const view = instance.ctx.get(editorViewCtx);
  const doc = (instance.ctx.get(parserCtx) as (md: string) => any)(markdown);
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
  return {
    ctx,
    view,
    serializer: instance.ctx.get(serializerCtx) as (doc: any) => string,
  };
}

const TABLE = '| a | b |\n| --- | --- |\n| c | d |';

function cursorAtText(view: any, text: string): void {
  let pos = -1;
  view.state.doc.descendants((node: any, p: number) => {
    if (pos < 0 && node.isText && node.text === text) pos = p;
    return pos < 0;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
}

function fireKey(view: any, init: KeyboardEventInit): void {
  view.someProp('handleKeyDown', (f: any) =>
    f(view, new KeyboardEvent('keydown', { bubbles: true, ...init })),
  );
}

describe('表格内 Enter/Tab 键位（集成：生产编排）', () => {
  it('Enter：跳到下一格', async () => {
    const { view } = await makeEditor(TABLE);
    cursorAtText(view, 'a');
    fireKey(view, { key: 'Enter' });
    expect(view.state.selection.$from.parent.textContent).toBe('b');
  });

  it('Enter：最后一格在表尾新增一行，光标落入新行首格', async () => {
    const { view, serializer } = await makeEditor(TABLE);
    cursorAtText(view, 'd');
    fireKey(view, { key: 'Enter' });

    const rows = view.state.doc.toJSON().content[0].content;
    expect(rows[0].type).toBe('table_header_row');
    expect(rows.filter((r: any) => r.type === 'table_row')).toHaveLength(2);
    // 光标在空的新行首格
    expect(view.state.selection.$from.parent.textContent).toBe('');
    // 结果仍是合法 GFM 表格
    const out = serializer(view.state.doc);
    expect(out.split('\n').filter((l) => l.trim()).length).toBe(4);
  });

  it('Tab：跳到下一格；最后一格同样加行', async () => {
    const { view } = await makeEditor(TABLE);
    cursorAtText(view, 'a');
    fireKey(view, { key: 'Tab' });
    expect(view.state.selection.$from.parent.textContent).toBe('b');

    cursorAtText(view, 'd');
    fireKey(view, { key: 'Tab' });
    const rows = view.state.doc.toJSON().content[0].content;
    expect(rows.filter((r: any) => r.type === 'table_row')).toHaveLength(2);
  });

  it('Shift+Enter：格内插入硬换行', async () => {
    const { view } = await makeEditor(TABLE);
    cursorAtText(view, 'a');
    fireKey(view, { key: 'Enter', shiftKey: true });
    const types: string[] = [];
    view.state.selection.$from.parent.forEach((child: any) => types.push(child.type.name));
    expect(types).toContain('hardbreak');
  });

  it('Ctrl+Enter：维持跳出表格', async () => {
    const { view } = await makeEditor(TABLE);
    cursorAtText(view, 'a');
    fireKey(view, { key: 'Enter', ctrlKey: true });
    expect(view.state.selection.$from.node(1)?.type.name).not.toBe('table');
  });

  it('表格外 Enter：不拦截，走默认段落行为', async () => {
    const { view } = await makeEditor('段落文字');
    cursorAtText(view, '段落文字');
    fireKey(view, { key: 'Enter' });
    expect(view.state.doc.childCount).toBe(2);
  });
});

describe('Shift+Tab 维持上一格（预设键位不被误伤）', () => {
  it('Shift+Tab：从第二格回到第一格', async () => {
    const { view } = await makeEditor(TABLE);
    cursorAtText(view, 'b');
    fireKey(view, { key: 'Tab', shiftKey: true });
    expect(view.state.selection.$from.parent.textContent).toBe('a');
  });
});
