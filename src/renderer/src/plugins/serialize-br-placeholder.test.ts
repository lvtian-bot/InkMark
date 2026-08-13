// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { Editor } from '@milkdown/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { rootCtx, parserCtx, serializerCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { listMarker } from './list-marker';
import { dropBrPlaceholderHandler } from '../markdown-stringify-options';

// 复刻 Editor.tsx 的序列化注入：html handler 丢弃 preserveEmptyLine 注入的 <br /> 占位。
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
        handlers: { ...options.handlers, html: dropBrPlaceholderHandler },
      }));
    })
    .use(commonmark)
    .use(gfm)
    .use(listMarker);
  await editor.create();
  return ctx as any;
}

function topLevelListItemCount(doc: any): number {
  return (doc.toJSON().content[0] as any)?.content?.length ?? 0;
}

describe('dropBrPlaceholderHandler（纯函数）', () => {
  it('丢弃各种 <br> 写法的占位', () => {
    expect(dropBrPlaceholderHandler({ value: '<br />' })).toBe('');
    expect(dropBrPlaceholderHandler({ value: '<br>' })).toBe('');
    expect(dropBrPlaceholderHandler({ value: '<br/>' })).toBe('');
    expect(dropBrPlaceholderHandler({ value: '<br >' })).toBe('');
    expect(dropBrPlaceholderHandler({ value: '<BR />' })).toBe('');
  });

  it('保留非 br 的 html 原样输出', () => {
    expect(dropBrPlaceholderHandler({ value: '<kbd>Ctrl</kbd>' })).toBe('<kbd>Ctrl</kbd>');
    expect(dropBrPlaceholderHandler({ value: '<!-- note -->' })).toBe('<!-- note -->');
  });

  it('容错：缺 value 或非字符串时返回空串', () => {
    expect(dropBrPlaceholderHandler(undefined)).toBe('');
    expect(dropBrPlaceholderHandler({})).toBe('');
    expect(dropBrPlaceholderHandler({ value: 123 })).toBe('');
  });
});

describe('序列化空列表项不再产生 <br />（集成）', () => {
  it('含空项的列表输出干净，无任何 <br', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const serializer = ctx.get(serializerCtx);
    const out = serializer(parser('- one\n-\n- three'));
    expect(out).not.toContain('<br');
  });

  it('空项不塌掉：往返后顶层列表项数仍为 3', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const serializer = ctx.get(serializerCtx);
    const once = serializer(parser('- one\n-\n- three'));
    expect(topLevelListItemCount(parser(once))).toBe(3);
  });

  it('往返稳定：连续序列化不累积、不变化', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const serializer = ctx.get(serializerCtx);
    const once = serializer(parser('- one\n-\n- three'));
    const twice = serializer(parser(once));
    expect(twice).toEqual(once);
  });

  it('有序列表的空项同样不产生 <br', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const serializer = ctx.get(serializerCtx);
    const out = serializer(parser('1. one\n2.\n3. three'));
    expect(out).not.toContain('<br');
  });

  it('嵌套列表不误伤：正常嵌套项序列化正常', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const serializer = ctx.get(serializerCtx);
    const out = serializer(parser('- a\n  - b\n- c'));
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('c');
    expect(out).not.toContain('<br');
  });
});
