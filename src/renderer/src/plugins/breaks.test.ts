// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest';
import { Editor } from '@milkdown/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { rootCtx, parserCtx, serializerCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { breaks, transformBreaksInTree, type MdastNode } from './breaks';
import { breakHandler, dropBrPlaceholderHandler } from '../markdown-stringify-options';
import { useStore } from '../stores/useStore';

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
  it('宽松模式（strictLineBreaks: false）：将 break 的 isInline 标记置为 false', () => {
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

    transformBreaksInTree(tree, false);

    const para = tree.children![0];
    expect((para.children![1] as any).data.isInline).toBe(false);
  });

  it('严格模式（strictLineBreaks: true）：将 break 的 isInline 标记置为 true', () => {
    const tree: MdastNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'line 1' },
            { type: 'break', data: { isInline: false } },
            { type: 'text', value: 'line 2' },
          ],
        },
      ],
    };

    transformBreaksInTree(tree, true);

    const para = tree.children![0];
    expect((para.children![1] as any).data.isInline).toBe(true);
  });

  it('未切分的换行文本切分并赋予正确的 isInline 属性', () => {
    const tree: MdastNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'a\nb' }],
        },
      ],
    };

    transformBreaksInTree(tree, false);

    const para = tree.children![0];
    expect(para.children).toHaveLength(3);
    expect(para.children![1]).toEqual({ type: 'break', data: { isInline: false } });
  });
});

describe('breakHandler 序列化（纯函数）', () => {
  beforeEach(() => {
    useStore.setState({ strictLineBreaks: false });
  });

  it('宽松模式下输出单个 \\n', () => {
    useStore.setState({ strictLineBreaks: false });
    expect(breakHandler(undefined, undefined, undefined, undefined)).toBe('\n');
  });

  it('严格模式下输出 \\\\\\n', () => {
    useStore.setState({ strictLineBreaks: true });
    expect(breakHandler(undefined, undefined, undefined, undefined)).toBe('\\\n');
  });
});

describe('breaks 插件集成（Milkdown 内核）', () => {
  beforeEach(() => {
    useStore.setState({ strictLineBreaks: false });
  });

  it('默认宽松模式：单次回车解析为 isInline: false 的 hardbreak 节点（DOM 渲染为 <br>）', async () => {
    useStore.setState({ strictLineBreaks: false });
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const doc = parser('Do not answer my question yet.\nBefore answering:');
    const json = doc.toJSON();

    const paragraphNodes = json.content[0].content;
    const breakNode = paragraphNodes.find((n: any) => n.type === 'hardbreak');
    expect(breakNode).toBeDefined();
    expect(breakNode.attrs.isInline).toBe(false);
  });

  it('默认宽松模式：序列化往返保持原样单次回车，无多余反斜杠', async () => {
    useStore.setState({ strictLineBreaks: false });
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const serializer = ctx.get(serializerCtx);

    const input = 'Do not answer my question yet.\nBefore answering:';
    const out = serializer(parser(input));
    expect(out).toContain('Do not answer my question yet.\nBefore answering:');
    expect(out).not.toContain('\\');
  });

  it('严格换行模式：单次回车解析为 isInline: true 的 hardbreak 节点（DOM 渲染为空格）', async () => {
    useStore.setState({ strictLineBreaks: true });
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const doc = parser('Do not answer my question yet.\nBefore answering:');
    const json = doc.toJSON();

    const paragraphNodes = json.content[0].content;
    const breakNode = paragraphNodes.find((n: any) => n.type === 'hardbreak');
    expect(breakNode).toBeDefined();
    expect(breakNode.attrs.isInline).toBe(true);
  });
});
