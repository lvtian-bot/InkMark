// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  rootCtx,
  serializerCtx,
  SerializerReady,
} from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { replaceAll } from '@milkdown/kit/utils';
import { createDocChangeListener } from './doc-change-listener';

describe('createDocChangeListener', () => {
  it('does not serialize on replaceAll(flush=true) and debounces real document edits', async () => {
    vi.useFakeTimers();
    const onUpdated = vi.fn();
    const serializerSpy = vi.fn(() => '');

    const host = document.createElement('div');
    const ed = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host);
        ctx.set(defaultValueCtx, '');
      })
      .use(commonmark)
      .use((ctx) => async () => {
        await ctx.wait(SerializerReady);
        ctx.set(serializerCtx, serializerSpy);
      })
      .use(createDocChangeListener((_ctx, doc) => onUpdated(doc.textContent), 200))
      .create();

    ed.action(replaceAll('# Title\n\nBody text', true));
    vi.advanceTimersByTime(300);
    expect(serializerSpy).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();

    // 事务带 addToHistory: false 时忽略
    const view = ed.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText('ignored ', 1).setMeta('addToHistory', false));
    vi.advanceTimersByTime(300);
    expect(onUpdated).not.toHaveBeenCalled();

    // 真实编辑在防抖窗口后触发一次上报
    view.dispatch(view.state.tr.insertText('hello ', 1));
    expect(onUpdated).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(serializerSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
    await ed.destroy();
  });
});
