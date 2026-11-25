// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { SerializerState } from '@milkdown/kit/transformer';
import { remarkCtx, schemaCtx } from '@milkdown/kit/core';
import { frontmatter } from './frontmatter';
import { taskList } from './task-list';
import { listMarker } from './list-marker';
import { breaks } from './breaks';
import { cellAwareHardbreak, cellBrRemark } from './table-cell-breaks';
import { fastSerializer } from './fast-serializer';

async function createPair() {
  const host = document.createElement('div');
  const ed = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, '');
    })
    .use(cellBrRemark)
    .use(commonmark)
    .use(gfm)
    .use(frontmatter)
    .use(taskList)
    .use(listMarker)
    .use(breaks)
    .use(cellAwareHardbreak)
    .use(fastSerializer)
    .create();

  const parser = ed.ctx.get(parserCtx);
  const fast = ed.ctx.get(serializerCtx);
  const original = SerializerState.create(ed.ctx.get(schemaCtx), ed.ctx.get(remarkCtx));
  return { ed, parser, fast, original };
}

describe('fastSerializer', () => {
  it('produces identical markdown output to Milkdown SerializerState across Markdown constructs', async () => {
    const { ed, parser, fast, original } = await createPair();
    const sample = [
      '---',
      'title: Demo',
      '---',
      '',
      '# Heading 1',
      '',
      'Normal **bold** and *italic* and `inline code` and [link](https://example.com) and ~~strike~~.',
      '',
      'Adjacent **bold** *italic* and ** spaced ** text.',
      '',
      '- item 1',
      '- [x] task done',
      '- [ ] task todo',
      '',
      '1. ordered 1',
      '2. ordered 2',
      '',
      '| Col A | Col B |',
      '| --- | --- |',
      '| line1<br>line2 | cell 2 |',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '> quote line',
    ].join('\n');

    const doc = parser(sample);
    expect(fast(doc)).toBe(original(doc));

    // 相邻同名 mark（如先加粗再合并相邻文本节点）也应与原版一致
    const view = ed.ctx.get(editorViewCtx);
    const { schema } = view.state;
    const boldMark = schema.marks.strong.create();
    const tr = view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      schema.nodes.paragraph.create(null, [
        schema.text('hello ', [boldMark]),
        schema.text('world', [boldMark]),
      ]),
    );
    expect(fast(tr.doc)).toBe(original(tr.doc));

    await ed.destroy();
  });

  it('serializes 20,000 paragraphs in linear time (< 1000ms)', async () => {
    const { ed, parser, fast } = await createPair();
    const manyParagraphs = '这是一段普通测试正文。\n\n'.repeat(20_000);
    const doc = parser(manyParagraphs);

    const t0 = performance.now();
    const md = fast(doc);
    const elapsed = performance.now() - t0;

    expect(md.length).toBeGreaterThan(100_000);
    expect(elapsed).toBeLessThan(1000);
    await ed.destroy();
  });
});
