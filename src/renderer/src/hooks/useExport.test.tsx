// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../stores/useStore';
import type { InkMarkAPI } from '../types';
import { useExport } from './useExport';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const initial = useStore.getState();

afterEach(() => useStore.setState(initial));

describe('恢复草稿导出', () => {
  it.each(['html', 'pdf'] as const)('导出 %s 时使用来源路径解析图片', async (kind) => {
    const exportDocument = vi.fn<InkMarkAPI['exportDocument']>(async () => ({
      status: 'canceled',
    }));
    Object.defineProperty(window, 'inkmark', { configurable: true, value: { exportDocument } });
    const tabId = useStore.getState().addTab({
      startPage: false,
      recoveryOriginPath: 'D:/notes/original.md',
      content: '![图](images/a.png)',
    });
    useStore.getState().updateTab(tabId, { isDirty: true });
    let run: ReturnType<typeof useExport>['exportDocument'] | undefined;
    function Harness() {
      run = useExport().exportDocument;
      return null;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => {
      await run?.(kind);
    });
    expect(exportDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        kind,
        markdown: '![图](images/a.png)',
        sourcePath: 'D:/notes/original.md',
      }),
    );
    await act(async () => root.unmount());
    host.remove();
  });
});
