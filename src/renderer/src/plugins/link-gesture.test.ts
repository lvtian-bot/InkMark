// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@milkdown/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { rootCtx, editorViewCtx } from '@milkdown/kit/core';
import { linkGesture, linkGestureClickHandler } from './link-gesture';

function makeModifiers(partial: Partial<MouseEvent>): MouseEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  } as MouseEvent;
}

function setPlatform(platform: string): void {
  (window as unknown as { inkmark: { platform: string } }).inkmark = { platform };
}

describe('linkGestureClickHandler', () => {
  beforeEach(() => setPlatform('win32'));
  afterEach(() => {
    delete (window as unknown as { inkmark?: unknown }).inkmark;
  });

  it('Windows 上按 Ctrl 声明接管，阻止 ProseMirror 内置的块选中', () => {
    expect(linkGestureClickHandler({} as never, 0, makeModifiers({ ctrlKey: true }))).toBe(true);
  });

  it('macOS 上按 Cmd 声明接管，按 Ctrl 不接管', () => {
    setPlatform('darwin');
    expect(linkGestureClickHandler({} as never, 0, makeModifiers({ metaKey: true }))).toBe(true);
    expect(linkGestureClickHandler({} as never, 0, makeModifiers({ ctrlKey: true }))).toBe(false);
  });

  it('普通点击与带 Shift/Alt 的点击不接管，保留原生光标行为', () => {
    expect(linkGestureClickHandler({} as never, 0, makeModifiers({}))).toBe(false);
    expect(
      linkGestureClickHandler({} as never, 0, makeModifiers({ ctrlKey: true, shiftKey: true })),
    ).toBe(false);
    expect(
      linkGestureClickHandler({} as never, 0, makeModifiers({ ctrlKey: true, altKey: true })),
    ).toBe(false);
  });
});

// handleClick 需要真实布局才能由鼠标事件驱动（posAtCoords 依赖几何信息），
// happy-dom 下无法完整复现点击链路；退而在真实编辑器实例上通过 someProp
// 验证插件确实把跳转手势判定注册进了 ProseMirror 的 handleClick 属性。
describe('linkGesture 插件（集成）', () => {
  it('编辑器上注册的 handleClick 与跳转手势判定一致', async () => {
    setPlatform('win32');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const editor = Editor.make()
      .config((c) => {
        c.set(rootCtx, root);
      })
      .use(commonmark)
      .use(linkGesture);
    await editor.create();

    const registered = editor.action((ctx) =>
      ctx.get(editorViewCtx).someProp('handleClick', (fn) => fn),
    ) as ((view: never, pos: number, event: MouseEvent) => boolean) | null;

    expect(registered).toBeTypeOf('function');
    expect(registered?.({} as never, 0, makeModifiers({ ctrlKey: true }))).toBe(true);
    expect(registered?.({} as never, 0, makeModifiers({}))).toBe(false);

    await editor.destroy();
    delete (window as unknown as { inkmark?: unknown }).inkmark;
  });
});
