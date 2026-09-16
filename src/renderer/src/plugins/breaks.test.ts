// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { Editor } from '@milkdown/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { rootCtx, parserCtx, serializerCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { breaks, transformBreaksInTree, type MdastNode } from './breaks';
import { breakHandler, dropBrPlaceholderHandler } from '../markdown-stringify-options';

async function makeEditor() {
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
    })
    .use(commonmark)
    .use(gfm)
    .use(breaks);
  await editor.create();
  return ctx as any;
}

describe('transformBreaksInTree（纯函数）', () => {
  it('将 break 的 isInline 标记置为 false（渲染为换行）', () => {
    const tree: MdastNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'line 1' },
            { type: 'break', data: { isInline: true } },
            { type: 'text', value: 'line 2' },
          ],
        },
      ],
    };

    transformBreaksInTree(tree);

    const para = tree.children![0];
    expect((para.children![1] as any).data.isInline).toBe(false);
  });

  it('未切分的换行文本切分为 break 节点（isInline: false）', () => {
    const tree: MdastNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'a\nb' }],
        },
      ],
    };

    transformBreaksInTree(tree);

    const para = tree.children![0];
    expect(para.children).toHaveLength(3);
    expect(para.children![1]).toEqual({ type: 'break', data: { isInline: false } });
  });

  it('带单元格换行标记的 break 是显式硬换行：跳过不改写', () => {
    const tree: MdastNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a' },
            { type: 'break', data: { inkmarkCellBreak: true } },
            { type: 'text', value: 'b' },
          ],
        },
      ],
    };

    transformBreaksInTree(tree);

    const data = (tree.children![0].children![1] as any).data;
    expect(data.inkmarkCellBreak).toBe(true);
    expect(data.isInline).toBeUndefined();
  });
});

describe('breakHandler 序列化（纯函数）', () => {
  it('硬换行输出单个 \\n，无反斜杠或行尾空格', () => {
    expect(breakHandler(undefined, undefined, undefined, undefined)).toBe('\n');
  });
});

describe('breaks 插件集成（Milkdown 内核）', () => {
  it('单次回车解析为 isInline: false 的 hardbreak 节点（DOM 渲染为 <br>）', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const doc = parser('Do not answer my question yet.\nBefore answering:');
    const json = doc.toJSON();

    const paragraphNodes = json.content[0].content;
    const breakNode = paragraphNodes.find((n: any) => n.type === 'hardbreak');
    expect(breakNode).toBeDefined();
    expect(breakNode.attrs.isInline).toBe(false);
  });

  it('序列化往返保持原样单次回车，无多余反斜杠', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const serializer = ctx.get(serializerCtx);

    const input = 'Do not answer my question yet.\nBefore answering:';
    const out = serializer(parser(input));
    expect(out).toContain('Do not answer my question yet.\nBefore answering:');
    expect(out).not.toContain('\\');
  });
});
