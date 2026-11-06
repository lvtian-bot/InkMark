// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorState, Prec, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { I18nProvider } from './i18n';
import { Outline } from './components/Outline';
import { SourceEditor } from './components/SourceEditor';
import { prepareOutlineActions } from './outline-actions';
import { extractSourceHeadings, serializeDoc } from './source-document';
import { sourceEditorHandle } from './source-editor-ref';
import { useStore } from './stores/useStore';

const initialStore = useStore.getState();
const mountedRoots = new Set<Root>();

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    };
  }
  const bridge = {
    platform: 'win32' as const,
    execClipboardCommand: async () => undefined,
    clipboardHasText: async () => false,
  };
  (window as unknown as { inkmark: typeof bridge }).inkmark = bridge;
});

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => root.unmount());
  }
  mountedRoots.clear();
  sourceEditorHandle.current = null;
  useStore.setState(initialStore);
});

async function mountDocument(doc: string) {
  useStore.setState({ language: 'zh-CN', viewMode: 'source' });
  const tabId = useStore.getState().addTab({
    filePath: 'D:/outline-actions.md',
    content: doc,
    startPage: false,
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.add(root);
  const onChange = (state: EditorState) => {
    const next = serializeDoc(state);
    useStore.getState().updateTab(tabId, {
      sourceContent: next,
      outline: extractSourceHeadings(state),
      isDirty: true,
    });
  };
  await act(async () => {
    root.render(
      <I18nProvider>
        <SourceEditor
          onChange={onChange}
          onReviewCountChange={() => undefined}
          onSingleReviewComplete={() => undefined}
          onFollowLink={() => undefined}
        />
        <Outline />
      </I18nProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const handle = sourceEditorHandle.current;
  if (!handle) throw new Error('源码编辑器句柄未挂载');
  await act(async () =>
    useStore.getState().updateTab(tabId, {
      outline: extractSourceHeadings(handle.getEditorState()),
    }),
  );
  return { host, root, tabId, handle };
}

function outlineButtons(host: HTMLElement): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('.outline-item'));
}

async function openMenu(host: HTMLElement, index: number): Promise<HTMLButtonElement[]> {
  const item = outlineButtons(host)[index];
  if (!item) throw new Error(`找不到大纲项 ${index}`);
  await act(async () => {
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }));
  });
  return Array.from(host.querySelectorAll<HTMLButtonElement>('.context-menu button'));
}

function menuButton(buttons: HTMLButtonElement[], label: string): HTMLButtonElement {
  const button = buttons.find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`找不到菜单项 ${label}`);
  return button;
}

describe('大纲右键操作（源码模式）', () => {
  it('删除章节会连同子章节删除，并可作为一步撤销', async () => {
    const { host, handle } = await mountDocument('# A\n\na\n\n## A1\n\na1\n\n# B\n\nb');
    const buttons = await openMenu(host, 0);
    await act(async () => menuButton(buttons, '删除章节').click());
    expect(handle.getDocText()).toBe('# B\n\nb');
    await act(async () => handle.undo());
    expect(handle.getDocText()).toBe('# A\n\na\n\n## A1\n\na1\n\n# B\n\nb');
    await act(async () => handle.redo());
    expect(handle.getDocText()).toBe('# B\n\nb');
  });

  it('升级和降级会整体作用于章节子树', async () => {
    const { host, handle } = await mountDocument('# A\n\n## A1\n\n### A1a\n\n# B');
    let buttons = await openMenu(host, 0);
    await act(async () => menuButton(buttons, '降级').click());
    expect(handle.getDocText()).toBe('## A\n\n### A1\n\n#### A1a\n\n# B');
    buttons = await openMenu(host, 0);
    await act(async () => menuButton(buttons, '升级').click());
    expect(handle.getDocText()).toBe('# A\n\n## A1\n\n### A1a\n\n# B');
  });

  it('CRLF 文档操作后仍保留换行并更新大纲', async () => {
    const { host, tabId, handle } = await mountDocument('# A\n\n## A1\n\n# B');
    const crlf = '# A\r\n\r\n## A1\r\n\r\n# B';
    await act(async () => {
      handle.setValue(crlf, { preserveLineSeparator: true });
      const state = handle.getEditorState();
      useStore.getState().updateTab(tabId, {
        sourceContent: serializeDoc(state),
        outline: extractSourceHeadings(state),
      });
    });
    expect(handle.getValue()).toBe(crlf);
    const buttons = await openMenu(host, 0);
    await act(async () => menuButton(buttons, '降级').click());
    expect(handle.getValue()).toBe('## A\r\n\r\n### A1\r\n\r\n# B');
    expect(
      useStore
        .getState()
        .tabs.find((tab) => tab.id === tabId)
        ?.outline.map((item) => item.level),
    ).toEqual([2, 3, 1]);
    const deleteButtons = await openMenu(host, 0);
    await act(async () => menuButton(deleteButtons, '删除章节').click());
    expect(handle.getValue()).toBe('# B');
  });

  it('一级不能升级，六级不能降级', async () => {
    const { host } = await mountDocument('# A\n\n###### B');
    let buttons = await openMenu(host, 0);
    expect(menuButton(buttons, '升级').disabled).toBe(true);
    buttons = await openMenu(host, 1);
    expect(menuButton(buttons, '降级').disabled).toBe(true);
  });

  it('输入与大纲操作分别占用撤销步骤', async () => {
    const { host, handle } = await mountDocument('# A\n\n# B');
    const editorDOM = host.querySelector<HTMLElement>('.cm-editor');
    const view = editorDOM && EditorView.findFromDOM(editorDOM);
    if (!view) throw new Error('源码编辑视图未就绪');
    await act(async () =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert: '\n\n前' },
        userEvent: 'input.type',
      }),
    );
    const withInput = handle.getDocText();
    const buttons = await openMenu(host, 1);
    await act(async () => menuButton(buttons, '删除章节').click());
    expect(handle.getDocText()).toBe('# A\n\n');
    await act(async () =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert: '后' },
        userEvent: 'input.type',
      }),
    );
    await act(async () => handle.undo());
    expect(handle.getDocText()).toBe('# A\n\n');
    await act(async () => handle.undo());
    expect(handle.getDocText()).toBe(withInput);
    await act(async () => handle.undo());
    expect(handle.getDocText()).toBe('# A\n\n# B');
  });

  it('打开菜单后正文发生变化，旧操作不会写回', async () => {
    const { host, handle } = await mountDocument('# A\n\n# B');
    await openMenu(host, 1);
    const staleActions = prepareOutlineActions(1);
    await act(async () =>
      handle.replaceRange(handle.getDocText().length, handle.getDocText().length, '\n\n尾部'),
    );
    const changed = handle.getDocText();
    expect(staleActions.run('delete')).toBe(false);
    expect(handle.getDocText()).toBe(changed);
  });

  it('切换标签或进入审阅后菜单关闭且操作不可用', async () => {
    const { host, tabId } = await mountDocument('# A\n\n# B');
    await openMenu(host, 0);
    const staleActions = prepareOutlineActions(0);
    await act(async () =>
      useStore.getState().addTab({
        filePath: 'D:/other.md',
        content: '# Other',
        startPage: false,
      }),
    );
    expect(host.querySelector('.context-menu')).toBeNull();
    expect(staleActions.run('delete')).toBe(false);
    await act(async () => useStore.getState().setActiveTab(tabId));
    await act(async () =>
      useStore.getState().updateTab(tabId, {
        reviewSession: true,
        pendingReviewCount: 1,
      }),
    );
    const buttons = await openMenu(host, 0);
    expect(menuButton(buttons, '删除章节').disabled).toBe(true);
    expect(menuButton(buttons, '升级').disabled).toBe(true);
    expect(menuButton(buttons, '降级').disabled).toBe(true);
  });

  it('未决审阅块清空后允许调整结果，实际只读时仍禁止操作', async () => {
    const { tabId, handle } = await mountDocument('## A\n\nbody');
    await act(async () => useStore.getState().updateTab(tabId, { reviewSession: true }));
    expect(prepareOutlineActions(0).can('promote')).toBe(true);
    handle.setEditorState(
      handle.getEditorState().update({
        effects: StateEffect.appendConfig.of(Prec.highest(EditorState.readOnly.of(true))),
      }).state,
    );
    expect(prepareOutlineActions(0).can('promote')).toBe(false);
    expect(prepareOutlineActions(0).run('delete')).toBe(false);
  });
});
