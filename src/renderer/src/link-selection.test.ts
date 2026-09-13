// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Editor, editorViewCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { replaceAll } from '@milkdown/kit/utils';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { expandToLinkBounds } from './link-selection';

async function boot(markdown: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const editor = await Editor.make()
    .config((ctx) => ctx.set(rootCtx, root))
    .use(commonmark)
    .create();
  await editor.action(replaceAll(markdown));
  const view = editor.ctx.get(editorViewCtx);
  return { editor, view };
}

/** 在 doc 全文中定位目标文本的位置范围（假定目标文本唯一）。 */
function findTextRange(doc: ProseNode, text: string): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (result || !node.isText || !node.text?.includes(text)) return true;
    const start = node.text.indexOf(text);
    result = { from: pos + start, to: pos + start + text.length };
    return false;
  });
  return result;
}

describe('expandToLinkBounds', () => {
  it('点击链接中部时扩展出完整链接范围', async () => {
    const { view, editor } = await boot('before [mylink](u) after');
    const doc = view.state.doc;
    const linkType = view.state.schema.marks.link;
    const range = findTextRange(doc, 'mylink');
    expect(range).not.toBeNull();
    expect(expandToLinkBounds(doc, range!.from + 3, linkType)).toEqual(range);
    editor.destroy();
  });

  it('点击链接首字符与末字符之后仍能找回完整范围', async () => {
    const { view, editor } = await boot('before [mylink](u) after');
    const doc = view.state.doc;
    const linkType = view.state.schema.marks.link;
    const range = findTextRange(doc, 'mylink')!;
    expect(expandToLinkBounds(doc, range.from, linkType)).toEqual(range);
    expect(expandToLinkBounds(doc, range.to, linkType)).toEqual(range);
    editor.destroy();
  });

  it('点击无链接文本时返回 null', async () => {
    const { view, editor } = await boot('plain text here');
    const doc = view.state.doc;
    const linkType = view.state.schema.marks.link;
    const range = findTextRange(doc, 'plain')!;
    expect(expandToLinkBounds(doc, range.from + 1, linkType)).toBeNull();
    editor.destroy();
  });

  it('相邻链接不会互相跨越扩展', async () => {
    const { view, editor } = await boot('[aa](u)[bb](v)');
    const doc = view.state.doc;
    const linkType = view.state.schema.marks.link;
    const rangeA = findTextRange(doc, 'aa')!;
    const rangeB = findTextRange(doc, 'bb')!;
    expect(expandToLinkBounds(doc, rangeA.from, linkType)).toEqual(rangeA);
    expect(expandToLinkBounds(doc, rangeA.to - 1, linkType)).toEqual(rangeA);
    expect(expandToLinkBounds(doc, rangeB.from, linkType)).toEqual(rangeB);
    expect(expandToLinkBounds(doc, rangeB.to - 1, linkType)).toEqual(rangeB);
    editor.destroy();
  });
});
