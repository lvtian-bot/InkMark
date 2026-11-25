// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@milkdown/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { editorViewCtx, editorViewOptionsCtx, parserCtx, rootCtx } from '@milkdown/kit/core';
import { selectIsReadOnly, useStore } from '../stores/useStore';
import { frontmatter } from './frontmatter';

const initialState = useStore.getState();

async function mountFrontmatterEditor(markdown: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  let ctx: any;
  const editor = Editor.make()
    .config((c) => {
      c.set(rootCtx, root);
      c.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        editable: () => !selectIsReadOnly(useStore.getState()),
      }));
      ctx = c;
    })
    .use(commonmark)
    .use(frontmatter);
  await editor.create();
  const parser = ctx.get(parserCtx);
  const view = ctx.get(editorViewCtx);
  const doc = parser(markdown);
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
  return { root, editor, view };
}

afterEach(() => {
  document.body.replaceChildren();
  useStore.setState(initialState);
});

describe('frontmatter 只读锁定', () => {
  it('externalUpdatePending 切换时同步锁住和解锁现有 frontmatter textarea，并拦截修改提交', async () => {
    const tabId = useStore.getState().addTab({
      filePath: 'D:/fm.md',
      content: '---\ntitle: old\n---\n\nbody\n',
      fileMtime: 1,
      startPage: false,
    });

    const { root, editor, view } = await mountFrontmatterEditor('---\ntitle: old\n---\n\nbody\n');
    const textarea = root.querySelector<HTMLTextAreaElement>('textarea.frontmatter-editor');
    expect(textarea).not.toBeNull();
    expect(textarea?.readOnly).toBe(false);

    useStore.getState().updateTab(tabId, { externalUpdatePending: true });
    view.setProps({ editable: () => false });
    expect(textarea?.readOnly).toBe(true);

    if (textarea) {
      textarea.value = 'title: hacked';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(textarea?.value).toBe('title: old');
    expect(view.state.doc.firstChild?.attrs.value).toBe('title: old');

    useStore.getState().updateTab(tabId, { externalUpdatePending: false });
    view.setProps({ editable: () => true });
    expect(textarea?.readOnly).toBe(false);

    if (textarea) {
      textarea.value = 'title: updated';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(view.state.doc.firstChild?.attrs.value).toBe('title: updated');

    await editor.destroy();
  });
});
