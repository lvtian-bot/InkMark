// @vitest-environment happy-dom
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewMode } from '../types';
import { useFindReplace, type FindReplaceController } from './useFindReplace';

const editor = vi.hoisted(() => {
  const state = { text: '', selection: { from: 0, to: 0 } };
  const replaceTextMatches = vi.fn(
    (edits: readonly { from: number; to: number; text: string }[]) => {
      for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
        state.text = state.text.slice(0, edit.from) + edit.text + state.text.slice(edit.to);
      }
      return edits.length;
    },
  );
  return {
    state,
    replaceTextMatches,
    getSelection: vi.fn(() => state.selection),
    getFindSegments: vi.fn(() => [{ from: 0, text: state.text }]),
    getDocText: vi.fn(() => state.text),
    showFindScope: vi.fn(),
    showFindMatches: vi.fn(),
    showTextMatches: vi.fn(),
    setSelection: vi.fn(),
    focus: vi.fn(),
  };
});

vi.mock('../editor-ref', () => ({ editorHandle: { current: editor } }));
vi.mock('../source-editor-ref', () => ({ sourceEditorHandle: { current: editor } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
let controller: FindReplaceController;
let frames: FrameRequestCallback[];

function Harness({ mode, tab }: { mode: ViewMode; tab: string }) {
  const value = useFindReplace({ activeTabId: tab, viewMode: mode });
  useEffect(() => {
    controller = value;
  }, [value]);
  return null;
}

async function flushFrames() {
  for (let i = 0; i < 6 && frames.length; i += 1) {
    const pending = frames;
    frames = [];
    await act(async () => pending.forEach((frame) => frame(0)));
  }
}

async function mount(mode: ViewMode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness mode={mode} tab="first" />));
}

async function setupSearch(query: string, replacement = '') {
  await act(async () => controller.open(true));
  await flushFrames();
  await act(async () => {
    controller.setQuery(query);
    controller.setReplacement(replacement);
  });
  await flushFrames();
}

beforeEach(() => {
  frames = [];
  editor.state.text = 'foo foo foo';
  editor.state.selection = { from: 4, to: 7 };
  vi.clearAllMocks();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

describe.each(['wysiwyg', 'source'] as const)('查找替换：%s 模式', (mode) => {
  it('保留打开前选区，并只替换该范围内的匹配', async () => {
    await mount(mode);
    await setupSearch('foo', 'bar');
    expect(controller.canSearchInSelection).toBe(true);
    expect(controller.matchCount).toBe(3);
    await act(async () => controller.setInSelection(true));
    await flushFrames();
    expect(controller.matchCount).toBe(1);
    expect(editor.showFindScope).toHaveBeenLastCalledWith({ from: 4, to: 7 });
    if (mode === 'source') {
      expect(editor.showFindMatches).toHaveBeenLastCalledWith([{ from: 4, to: 7 }], 0);
    } else {
      expect(editor.showTextMatches).toHaveBeenLastCalledWith([{ from: 4, to: 7 }], 0);
    }
    await act(async () => controller.replaceAll());
    await flushFrames();
    expect(editor.state.text).toBe('foo bar foo');
  });

  it('选区确定后正文意外变化，不使用过期范围替换', async () => {
    await mount(mode);
    await setupSearch('foo', 'bar');
    await act(async () => controller.setInSelection(true));
    await flushFrames();
    editor.state.text = 'xfoo foo foo';
    await act(async () => controller.replaceAll());
    expect(editor.state.text).toBe('xfoo foo foo');
    expect(editor.replaceTextMatches).not.toHaveBeenCalled();
  });

  it('切换标签后清除限定范围', async () => {
    await mount(mode);
    await setupSearch('foo');
    await act(async () => controller.setInSelection(true));
    await flushFrames();
    await act(async () => root.render(<Harness mode={mode} tab="second" />));
    await flushFrames();
    expect(controller.inSelection).toBe(false);
    expect(controller.canSearchInSelection).toBe(false);
    expect(editor.showFindScope).toHaveBeenLastCalledWith(null);
  });

  it('无效正则禁止替换', async () => {
    await mount(mode);
    await setupSearch('[', 'bar');
    await act(async () => controller.setUseRegex(true));
    await flushFrames();
    expect(controller.regexError).toBe(true);
    await act(async () => controller.replaceAll());
    expect(editor.replaceTextMatches).not.toHaveBeenCalled();
    expect(editor.state.text).toBe('foo foo foo');
  });

  it('正则替换正确展开捕获组', async () => {
    editor.state.text = 'ABC-123 DEF-456';
    editor.state.selection = { from: 0, to: 0 };
    await mount(mode);
    await setupSearch('([A-Z]+)-(\\d+)', '$2:$1');
    await act(async () => controller.setUseRegex(true));
    await flushFrames();
    expect(controller.matchCount).toBe(2);
    await act(async () => controller.replaceAll());
    expect(editor.state.text).toBe('123:ABC 456:DEF');
  });
});
