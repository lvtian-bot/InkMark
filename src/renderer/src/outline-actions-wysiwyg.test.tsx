// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MilkdownProvider } from '@milkdown/react';
import { TextSelection } from '@milkdown/kit/prose/state';
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from './components/Editor';
import { I18nProvider } from './i18n';
import { editorHandle } from './editor-ref';
import { extractHeadings } from './hooks/useOutline';
import { useStore } from './stores/useStore';
import { prepareOutlineActions } from './outline-actions';

const initialStore = useStore.getState();
let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  useStore.setState(initialStore);
  document.body.replaceChildren();
});

async function boot(doc: string) {
  useStore.setState({ tabs: [], viewMode: 'wysiwyg', language: 'zh-CN' });
  const tabId = useStore.getState().addTab({
    filePath: 'D:/outline.md',
    content: doc,
    startPage: false,
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <I18nProvider>
        <MilkdownProvider>
          <Editor
            onDocInit={(node) =>
              useStore.getState().updateTab(tabId, { outline: extractHeadings(node) })
            }
            onDocChange={(node) =>
              useStore.getState().updateTab(tabId, {
                outline: extractHeadings(node),
                sourceContent: editorHandle.current?.getMarkdown() ?? '',
                isDirty: true,
              })
            }
            onFollowLink={() => undefined}
          />
        </MilkdownProvider>
      </I18nProvider>,
    );
  });
  for (let i = 0; i < 100 && !editorHandle.current; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  const handle = editorHandle.current;
  if (!handle) throw new Error('所见即所得编辑器未就绪');
  return { handle, tabId };
}

describe('所见即所得大纲操作（真实编辑器）', () => {
  it.each(['delete', 'promote', 'demote'] as const)(
    '%s 可独立撤销和重做，保留子标题及正文',
    async (action) => {
      const doc = '# Root\n\n## A\n\n### Child\n\ntext\n\n## B\n\nlast';
      const { handle } = await boot(doc);
      const before = handle.getEditorState()?.doc.toJSON();
      const actions = prepareOutlineActions(1);
      expect(actions.can(action)).toBe(true);
      await act(async () => {
        expect(actions.run(action)).toBe(true);
      });
      const after = handle.getEditorState()?.doc.toJSON();
      expect(after).not.toEqual(before);
      expect(useStore.getState().tabs[0].isDirty).toBe(true);
      expect(useStore.getState().tabs[0].sourceContent).toContain('last');
      if (action === 'delete') {
        expect(useStore.getState().tabs[0].sourceContent).not.toContain('Child');
      } else {
        expect(extractHeadings(handle.getEditorState()?.doc).map((item) => item.level)).toEqual(
          action === 'promote' ? [1, 1, 2, 2] : [1, 3, 4, 2],
        );
      }
      await act(async () => handle.undo());
      expect(handle.getEditorState()?.doc.toJSON()).toEqual(before);
      await act(async () => handle.redo());
      expect(handle.getEditorState()?.doc.toJSON()).toEqual(after);
    },
  );

  it('采用尚未上报的正文输入，且操作前后的输入分别撤销', async () => {
    const { handle, tabId } = await boot('# A\n\n## B\n\nlast');
    const state = handle.getEditorState();
    if (!state) throw new Error('编辑状态缺失');
    handle.setEditorState(state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc))));
    await act(async () => handle.insertText('!'));
    expect(useStore.getState().tabs.find((tab) => tab.id === tabId)?.sourceContent).not.toContain(
      '!',
    );
    const before = handle.getEditorState()?.doc.toJSON();
    await act(async () => {
      expect(prepareOutlineActions(1).run('promote')).toBe(true);
    });
    expect(handle.getMarkdown()).toContain('last!');
    const after = handle.getEditorState()?.doc.toJSON();
    await act(async () => handle.insertText('?'));
    await act(async () => handle.undo());
    expect(handle.getEditorState()?.doc.toJSON()).toEqual(after);
    await act(async () => handle.undo());
    expect(handle.getEditorState()?.doc.toJSON()).toEqual(before);
    await act(async () => handle.undo());
    expect(handle.getMarkdown()).not.toContain('!');
  });

  it('原始引用式链接定义不能随删除悄悄消失', async () => {
    await boot('# A\n\n[x]: /target\n\n# B\n\n[read][x]');
    expect(prepareOutlineActions(0).can('delete')).toBe(false);
    expect(prepareOutlineActions(1).can('delete')).toBe(true);
  });

  it('标题尚未上报或已进入审阅时禁止修改', async () => {
    const { handle, tabId } = await boot('## A\n\nbody');
    await act(async () => handle.insertText('new'));
    expect(prepareOutlineActions(0).can('promote')).toBe(false);
    await act(async () =>
      useStore.getState().updateTab(tabId, {
        reviewSession: true,
        pendingReviewCount: 1,
      }),
    );
    expect(prepareOutlineActions(0).run('delete')).toBe(false);
  });

  it('未决审阅块清空后允许继续调整结果', async () => {
    const { tabId } = await boot('## A\n\nbody');
    await act(async () => useStore.getState().updateTab(tabId, { reviewSession: true }));
    expect(prepareOutlineActions(0).can('promote')).toBe(true);
  });

  it('旧菜单不能覆盖新的正文输入', async () => {
    const { handle } = await boot('## A\n\nbody');
    const actions = prepareOutlineActions(0);
    await act(async () => handle.insertText('new'));
    expect(actions.run('delete')).toBe(false);
    expect(handle.getMarkdown()).toContain('new');
  });
});
