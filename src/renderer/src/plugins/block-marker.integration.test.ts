// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { Editor } from '@milkdown/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { rootCtx, parserCtx, serializerCtx, editorViewCtx } from '@milkdown/kit/core';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { listMarker } from './list-marker';
import { taskList } from './task-list';
import { blockMarkerReveal } from './block-marker-reveal';

// 真实 Milkdown parse→serialize 往返（经 ProseMirror 文档模型 + 真实装饰渲染）。
// 覆盖块级标记浮现：选区进入块出现 .block-marker、移走消失、标题键势升降级、
// 往返序列化不被标记污染、列表标记取自 list-marker 属性、与任务列表 checkbox 共存。
async function makeEditor() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  let ctx: any;
  const editor = Editor.make()
    .config((c) => {
      c.set(rootCtx, root);
      ctx = c;
    })
    .use(commonmark)
    .use(gfm)
    .use(taskList)
    .use(listMarker)
    .use(blockMarkerReveal);
  await editor.create();
  return ctx as any;
}

// 把 Markdown 装进编辑器视图，并把光标放到 from。返回更新后的 view。
function loadIntoView(ctx: any, md: string, from: number) {
  const parser = ctx.get(parserCtx);
  const view = ctx.get(editorViewCtx);
  const doc = parser(md);
  const state = EditorState.create({
    doc,
    plugins: view.state.plugins,
    selection: TextSelection.create(doc, from),
  });
  view.updateState(state);
  return view;
}

function markerTexts(view: any): string[] {
  return [...view.dom.querySelectorAll('.block-marker')].map(
    (el) => (el as HTMLElement).textContent ?? '',
  );
}

// 找到首个指定类型节点的「正文起始」位置（节点 pos + 1，进入其内容）。
function firstTextStart(doc: any, type: string): number {
  let pos = -1;
  doc.descendants((node: any, p: number) => {
    if (pos < 0 && node.type.name === type) pos = p + 1;
    return pos < 0;
  });
  return pos;
}

describe('块级标记浮现 ProseMirror 集成', () => {
  it('光标进入标题浮现 ## ，移到段落后消失', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const doc = parser('## Title\n\nplain');
    const headingStart = firstTextStart(doc, 'heading'); // 标题正文起始
    const paraStart = firstTextStart(doc, 'paragraph'); // 普通段落正文起始

    const view = loadIntoView(ctx, '## Title\n\nplain', headingStart);
    expect(markerTexts(view)).toContain('## ');

    // 光标移到普通段落：标题不再是祖先，标记消失。
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paraStart)));
    expect(markerTexts(view)).not.toContain('## ');
  });

  it('标题正文起始按 # 升一级（真实事务）', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const doc = parser('## Title');
    const headingStart = firstTextStart(doc, 'heading');
    const view = loadIntoView(ctx, '## Title', headingStart);

    const tryTextInput = (view: any, from: number, to: number, text: string) =>
      view.someProp('handleTextInput', (fn: any) => fn(view, from, to, text));

    const handled = tryTextInput(view, headingStart, headingStart, '#');
    expect(handled).toBe(true);

    let level: number | undefined;
    view.state.doc.descendants((node: any) => {
      if (node.type.name === 'heading') level = node.attrs.level;
    });
    expect(level).toBe(3);
  });

  it('标题正文起始 Backspace 降级，level 1 再按变普通段落', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const doc = parser('## Title');
    const headingStart = firstTextStart(doc, 'heading');
    const view = loadIntoView(ctx, '## Title', headingStart);

    const backspace = {
      key: 'Backspace',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      isComposing: false,
      keyCode: 8,
    } as unknown as KeyboardEvent;

    // 模拟真实按键：someProp 带 callback 会按插件顺序链式尝试每个 handleKeyDown，
    // 返回首个 truthy 结果（task-list 的 handler 在我之前注册，非任务项返回 false 后
    // 才轮到本插件）。不带 callback 的 someProp 只取第一个 handler，测不到链式语义。
    const tryKeyDown = (view: any, event: KeyboardEvent) =>
      view.someProp('handleKeyDown', (fn: any) => fn(view, event));

    // ## -> #
    expect(tryKeyDown(view, backspace)).toBe(true);
    let level: number | undefined;
    view.state.doc.descendants((node: any) => {
      if (node.type.name === 'heading') level = node.attrs.level;
    });
    expect(level).toBe(1);

    // # -> 普通段落
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, headingStart)));
    expect(tryKeyDown(view, backspace)).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('parse→serialize 往返不被标记装饰污染', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const serializer = ctx.get(serializerCtx);

    // 光标在标题里（标记正在浮现），序列化仍应是干净的 ## Title。
    const doc = parser('## Title');
    const view = loadIntoView(ctx, '## Title', firstTextStart(doc, 'heading'));
    expect(markerTexts(view)).toContain('## '); // 确认标记确实在渲染

    const out = serializer(view.state.doc);
    expect(out).toContain('## Title');
    expect(out).not.toMatch(/##\s*##/); // 标记没有泄漏进内容
  });

  it('无序列表标记取自 bullet 属性（*）', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const doc = parser('* a\n* b');
    // 列表项正文起始 = list_item(pos+1) -> 段落内容起始。
    const view = loadIntoView(ctx, '* a\n* b', firstTextStart(doc, 'paragraph'));
    const texts = markerTexts(view);
    expect(texts.filter((t) => t.startsWith('* ')).length).toBe(2); // 两个项都显示 *
  });

  it('有序列表标记取自 bulletOrdered 属性（1)）', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const doc = parser('1) a\n2) b');
    const view = loadIntoView(ctx, '1) a\n2) b', firstTextStart(doc, 'paragraph'));
    const texts = markerTexts(view);
    expect(texts).toContain('1) ');
    expect(texts).toContain('2) ');
  });

  it('与任务列表 checkbox 共存：任务项显 checkbox，普通项显字符标记', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const doc = parser('- [ ] task\n- plain');
    const view = loadIntoView(ctx, '- [ ] task\n- plain', firstTextStart(doc, 'paragraph'));

    // 任务项有 checkbox，普通项有字符标记，两者并存且不报错。
    expect(view.dom.querySelectorAll('.task-checkbox').length).toBe(1);
    const texts = markerTexts(view);
    expect(texts).toContain('- '); // 普通项 plain 的标记
    // 任务项不重复叠字符标记（checkbox 已表达项身份）
    expect(texts.filter((t) => t === '- ').length).toBe(1);
  });

  it('引用块浮现 > 标记', async () => {
    const ctx = await makeEditor();
    const parser = ctx.get(parserCtx);
    const doc = parser('> quoted');
    // blockquote > paragraph(text "quoted")：段落正文起始。
    const view = loadIntoView(ctx, '> quoted', firstTextStart(doc, 'paragraph'));
    expect(markerTexts(view)).toContain('> ');
  });
});
