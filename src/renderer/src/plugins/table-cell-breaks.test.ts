// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest';
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
import { cellBrRemark, cellAwareHardbreak, transformCellBrInTree } from './table-cell-breaks';
import { tableEnterKeymap } from './table-enter-keymap';
import { useStore } from '../stores/useStore';
import type { MdastNode } from '../../../shared/markdown-breaks';

describe('transformCellBrInTree（纯函数）', () => {
  it('单元格内的 <br> html 节点替换为带标记的 break 节点', () => {
    const tree: MdastNode = {
      type: 'root',
      children: [
        {
          type: 'table',
          children: [
            {
              type: 'tableRow',
              children: [
                {
                  type: 'tableCell',
                  children: [
                    { type: 'text', value: 'a' },
                    { type: 'html', value: '<br>' },
                    { type: 'text', value: 'b' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    transformCellBrInTree(tree);

    const cell = tree.children![0].children![0].children![0];
    expect(cell.children![1].type).toBe('break');
    const data = cell.children![1].data as Record<string, unknown>;
    expect(data.isInline).toBe(false);
    expect(data.inkmarkCellBreak).toBe(true);
  });

  it('识别各种 <br> 写法（含空格、斜杠、大小写）', () => {
    for (const value of ['<br>', '<br />', '<br/>', '<br >', '<BR>']) {
      const tree: MdastNode = {
        type: 'root',
        children: [
          {
            type: 'table',
            children: [
              {
                type: 'tableRow',
                children: [{ type: 'tableCell', children: [{ type: 'html', value }] }],
              },
            ],
          },
        ],
      };
      transformCellBrInTree(tree);
      expect(tree.children![0].children![0].children![0].children![0].type).toBe('break');
    }
  });

  it('表格外的 <br> 与非 br 的 html 不受影响', () => {
    const tree: MdastNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'html', value: '<br>' }],
        },
        {
          type: 'table',
          children: [
            {
              type: 'tableRow',
              children: [
                { type: 'tableCell', children: [{ type: 'html', value: '<kbd>Tab</kbd>' }] },
              ],
            },
          ],
        },
      ],
    };

    transformCellBrInTree(tree);

    expect(tree.children![0].children![0].type).toBe('html');
    // table > tableRow > tableCell > html
    expect(tree.children![1].children![0].children![0].children![0].type).toBe('html');
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
    parser: instance.ctx.get(parserCtx) as (md: string) => any,
    serializer: instance.ctx.get(serializerCtx) as (doc: any) => string,
  };
}

const CELL_BR_TABLE = '| a<br>b | c |\n| --- | --- |\n| d | e |';

describe('单元格内换行（集成：生产编排）', () => {
  beforeEach(() => {
    useStore.setState({ strictLineBreaks: false });
  });

  it('解析：外部文档单元格内的 <br> 变成硬换行节点（宽松模式）', async () => {
    const { parser } = await makeEditor('');
    const headerCell = parser(CELL_BR_TABLE).toJSON().content[0].content[0].content[0];
    const br = headerCell.content[0].content.find((n: any) => n.type === 'hardbreak');
    expect(br).toBeDefined();
    expect(br.attrs.isInline).toBe(false);
  });

  it('解析：严格模式下格内 <br> 仍是硬换行（显式换行不随软换行设置降级）', async () => {
    useStore.setState({ strictLineBreaks: true });
    const { parser } = await makeEditor('');
    const headerCell = parser(CELL_BR_TABLE).toJSON().content[0].content[0].content[0];
    const br = headerCell.content[0].content.find((n: any) => n.type === 'hardbreak');
    expect(br).toBeDefined();
    expect(br.attrs.isInline).toBe(false);
  });

  it('序列化往返：保存仍是 <br>，连续往返稳定', async () => {
    const { parser, serializer } = await makeEditor('');
    const once = serializer(parser(CELL_BR_TABLE));
    expect(once).toContain('a<br>b');
    expect(serializer(parser(once))).toBe(once);
  });

  it('序列化：严格模式下往返同样稳定', async () => {
    useStore.setState({ strictLineBreaks: true });
    const { parser, serializer } = await makeEditor('');
    const once = serializer(parser(CELL_BR_TABLE));
    expect(once).toContain('a<br>b');
    expect(serializer(parser(once))).toBe(once);
  });

  it('序列化：格内 Shift+Enter 产生的硬换行保存为 <br>，表格行数不变', async () => {
    const { view, serializer } = await makeEditor('| a | b |\n| --- | --- |\n| c | d |');
    let pos = -1;
    view.state.doc.descendants((node: any, p: number) => {
      if (pos < 0 && node.isText && node.text === 'c') pos = p;
      return pos < 0;
    });
    view.dispatch(view.state.tr.insert(pos + 1, view.state.schema.nodes.hardbreak.create()));
    view.dispatch(view.state.tr.insertText('x', pos + 2));

    const out = serializer(view.state.doc);
    expect(out).toContain('c<br>x');
    // 表头、分隔、1 行数据、结尾换行：表格行未被换行撕裂
    expect(out.trim().split('\n')).toHaveLength(3);
  });

  it('段内 <br> 维持既有行为（被吞并），不随本次改动变化', async () => {
    const { parser, serializer } = await makeEditor('');
    expect(serializer(parser('段落a<br>段落b'))).not.toContain('<br');
  });

  it('光标在格内时 Shift+Enter 直接插入硬换行（禁插名单已放开表格）', async () => {
    const { view } = await makeEditor('| a | b |\n| --- | --- |\n| c | d |');
    let pos = -1;
    view.state.doc.descendants((node: any, p: number) => {
      if (pos < 0 && node.isText && node.text === 'a') pos = p;
      return pos < 0;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true });
    view.someProp('handleKeyDown', (f: any) => f(view, event));

    const cellPara = view.state.selection.$from.parent;
    const types: string[] = [];
    cellPara.forEach((child: any) => types.push(child.type.name));
    expect(types).toContain('hardbreak');
  });
});
