// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { Editor } from '@milkdown/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { rootCtx, parserCtx, serializerCtx, editorViewCtx } from '@milkdown/kit/core';
import { listMarker } from './list-marker';

// 跑真实的 Milkdown parse→serialize 往返（经过 ProseMirror 文档模型）。
// 单元测试只覆盖 mdast 层；这里验证 extendSchema 的属性透传与 inputRule 覆盖在内核里确实生效，
// 是「文件加载保留」和「打字新建保留」两条路径的回归保护。
async function makeEditor() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  let ctx: any;
  const editor = Editor.make()
    .config((c) => {
      c.set(rootCtx, root);
      ctx = c;
    })
    .use(commonmark)
    .use(gfm)
    .use(listMarker);
  await editor.create();
  return ctx as any;
}

function findBulletList(doc: any): { attrs: { bullet?: string } } | null {
  let found: any = null;
  doc.descendants((node: any) => {
    if (node.type.name === 'bullet_list') found = node;
  });
  return found;
}

describe('list marker ProseMirror 集成', () => {
  it('从文件加载的 * 列表往返保留', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const doc = parser('* a\n* b');
    expect(findBulletList(doc)?.attrs.bullet).toBe('*');

    const serializer = ctx.get(serializerCtx);
    const out = serializer(doc);
    expect(out).toContain('* a');
    expect(out).not.toMatch(/^- /m);
  });

  it('打 * 新建列表记录 bullet（inputRule 覆盖）', async () => {
    const ctx = await makeEditor();
    const view = ctx.get(editorViewCtx);
    const handleTextInput = view.someProp('handleTextInput');
    expect(handleTextInput).toBeTruthy();
    // 在空段落开头模拟输入「* 」，应触发无序列表 inputRule
    const handled = handleTextInput?.(view, 1, 1, '* ');
    expect(handled).toBe(true);
    expect(findBulletList(view.state.doc)?.attrs.bullet).toBe('*');
  });
});
