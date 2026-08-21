// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Editor, editorViewCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { TextSelection } from '@milkdown/kit/prose/state';
import { replaceAll } from '@milkdown/kit/utils';
import { addTableLine } from './table-edit';

async function bootWithTable(markdown: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const editor = await Editor.make()
    .config((ctx) => ctx.set(rootCtx, root))
    .use(commonmark)
    .use(gfm)
    .use(history)
    .create();
  await editor.action(replaceAll(markdown));
  const view = editor.ctx.get(editorViewCtx);
  let textPos = -1;
  view.state.doc.descendants((node, pos) => {
    if (textPos < 0 && node.isText) textPos = pos;
  });
  expect(textPos).toBeGreaterThan(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(textPos))));
  return { editor, view };
}

const TABLE = '| a | b |\n| --- | --- |\n| c | d |';

describe('WYSIWYG table insertion', () => {
  it('inserts a row after the current row', async () => {
    const { editor, view } = await bootWithTable(TABLE);
    const tr = addTableLine(view.state, editor.ctx, 'row', 'after');
    expect(tr).not.toBeNull();
    if (tr) view.dispatch(tr);
    expect(view.state.doc.firstChild?.childCount).toBe(3);
    editor.destroy();
  });

  it('inserts a column after the current column', async () => {
    const { editor, view } = await bootWithTable(TABLE);
    const tr = addTableLine(view.state, editor.ctx, 'col', 'after');
    expect(tr).not.toBeNull();
    if (tr) view.dispatch(tr);
    expect(view.state.doc.firstChild?.firstChild?.childCount).toBe(3);
    editor.destroy();
  });
});
