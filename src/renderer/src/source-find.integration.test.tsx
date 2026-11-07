// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { I18nProvider } from './i18n';
import { SourceEditor } from './components/SourceEditor';
import { sourceEditorHandle } from './source-editor-ref';
import { useStore } from './stores/useStore';

const initialStore = useStore.getState();
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { inkmark: { platform: string } }).inkmark = { platform: 'win32' };
});
afterEach(() => useStore.setState(initialStore));

describe('源码查找实际编辑器接口', () => {
  it('显示零宽命中，插入替换可独立撤销', async () => {
    useStore.setState({ language: 'zh-CN', viewMode: 'source' });
    useStore.getState().addTab({ filePath: 'D:/find.md', content: 'abc', startPage: false });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <I18nProvider>
          <SourceEditor onChange={() => undefined} onFollowLink={() => undefined} />
        </I18nProvider>,
      ),
    );
    const handle = sourceEditorHandle.current;
    if (!handle) throw new Error('源码编辑器未挂载');
    await act(async () => handle.showFindMatches([{ from: 0, to: 0 }], 0));
    expect(host.querySelectorAll('.inkmark-find-zero.is-active')).toHaveLength(1);
    await act(async () => {
      expect(handle.replaceTextMatches([{ from: 0, to: 0, text: 'X' }])).toBe(1);
    });
    expect(handle.getDocText()).toBe('Xabc');
    await act(async () => handle.undo());
    expect(handle.getDocText()).toBe('abc');
    await act(async () => root.unmount());
    host.remove();
  });
});
