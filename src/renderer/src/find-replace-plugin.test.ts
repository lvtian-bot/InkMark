// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Editor, rootCtx, editorViewCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { replaceAll } from '@milkdown/kit/utils';
import { frontmatter } from './plugins/frontmatter';
import { findReplacePlugin, setFindDecorations } from './find-replace-plugin';
import { findTextMatchesInDocument } from './find-replace-doc';

async function bootWithFind(markdown: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const editor = await Editor.make()
    .config((ctx) => ctx.set(rootCtx, root))
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(frontmatter)
    .use(findReplacePlugin)
    .create();
  await editor.action(replaceAll(markdown));
  const view = editor.ctx.get(editorViewCtx);
  return { editor, view };
}

describe('findTextMatchesInDocument (real Milkdown schema)', () => {
  it('matches plain text across paragraphs', async () => {
    const { view, editor } = await bootWithFind('foo bar\n\nfoo baz');
    const matches = findTextMatchesInDocument(view.state.doc, 'foo');
    expect(matches).toHaveLength(2);
    for (const match of matches) {
      expect(view.state.doc.textBetween(match.from, match.to, '')).toBe('foo');
    }
    editor.destroy();
  });

  it('matches text inside inline code, code blocks, links and across a strong boundary', async () => {
    const cases: Array<[string, string, number]> = [
      ['pre `code` post', 'code', 1],
      ['```\nbar\n```', 'bar', 1],
      ['[mylink](u)', 'mylink', 1],
      ['**bold**plain', 'boldplain', 1],
      ['| a | b |\n|---|---|\n| c | d |', 'c', 1],
    ];
    for (const [md, query, expected] of cases) {
      const { view, editor } = await bootWithFind(md);
      const matches = findTextMatchesInDocument(view.state.doc, query);
      expect(matches).toHaveLength(expected);
      for (const match of matches) {
        expect(view.state.doc.textBetween(match.from, match.to, '')).toBe(query);
      }
      editor.destroy();
    }
  });

  it('does not match text inside atom nodes (frontmatter value, image alt)', async () => {
    const { view, editor } = await bootWithFind('---\nt: special\n---\nbody text');
    expect(findTextMatchesInDocument(view.state.doc, 'special')).toHaveLength(0);
    editor.destroy();

    const { view: view2, editor: editor2 } = await bootWithFind('![altword](s.png)');
    expect(findTextMatchesInDocument(view2.state.doc, 'altword')).toHaveLength(0);
    editor2.destroy();
  });
});

describe('find-replace decorations', () => {
  it('renders one decoration per match and marks the active one', async () => {
    const { view, editor } = await bootWithFind('foo bar\n\nfoo baz');
    const matches = findTextMatchesInDocument(view.state.doc, 'foo');
    setFindDecorations(view, matches, 1);
    expect(view.dom.querySelectorAll('.inkmark-find-match')).toHaveLength(2);
    expect(view.dom.querySelectorAll('.inkmark-find-match.is-active')).toHaveLength(1);
    editor.destroy();
  });

  it('keeps highlights across a document edit (docChanged must not wipe decorations)', async () => {
    // Regression: find-replace-plugin previously returned DecorationSet.empty on every
    // docChanged transaction, so any edit made all highlights vanish while the counter
    // (recomputed only on the next refresh) still showed matches.
    const { view, editor } = await bootWithFind('foo bar\n\nfoo baz');
    const matches = findTextMatchesInDocument(view.state.doc, 'foo');
    setFindDecorations(view, matches, 0);
    expect(view.dom.querySelectorAll('.inkmark-find-match')).toHaveLength(2);

    // Append text at the very end — the two matches at the start are unaffected.
    view.dispatch(view.state.tr.insertText('x', view.state.doc.content.size));
    expect(view.dom.querySelectorAll('.inkmark-find-match')).toHaveLength(2);
    editor.destroy();
  });

  it('clears decorations when given no matches', async () => {
    const { view, editor } = await bootWithFind('foo bar');
    setFindDecorations(view, findTextMatchesInDocument(view.state.doc, 'foo'), 0);
    expect(view.dom.querySelectorAll('.inkmark-find-match')).toHaveLength(1);
    setFindDecorations(view, [], -1);
    expect(view.dom.querySelectorAll('.inkmark-find-match')).toHaveLength(0);
    editor.destroy();
  });
});
