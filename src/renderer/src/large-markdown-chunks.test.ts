import { describe, expect, it } from 'vitest';
import { renderMarkdownChunkToHtml, splitMarkdownForReader } from './large-markdown-chunks';

describe('splitMarkdownForReader & renderMarkdownChunkToHtml', () => {
  it('将 12,000 行连续列表（约 3 MB）切分为有界片段，并在预算内完成切分与首屏渲染', () => {
    const line = `- [Awesome Project Entry With Description And Metadata](https://example.com/project/item) - ${'描述文字'.repeat(25)}`;
    const lines = ['# 主标题', ''];
    for (let i = 0; i < 12_000; i++) {
      lines.push(`${line} #${i}`);
    }
    const content = lines.join('\n');
    expect(content.length).toBeGreaterThan(2_000_000);

    const start = performance.now();
    const doc = splitMarkdownForReader(content);
    const firstHtml = renderMarkdownChunkToHtml(doc.chunks[0], doc.referenceDefs);
    const secondHtml = renderMarkdownChunkToHtml(doc.chunks[1], doc.referenceDefs);
    const elapsed = performance.now() - start;

    expect(doc.chunks.length).toBeGreaterThan(80);
    for (const chunk of doc.chunks) {
      expect(chunk.endLine - chunk.startLine + 1).toBeLessThanOrEqual(160);
    }
    expect(doc.headings).toHaveLength(1);
    expect(doc.headings[0].text).toBe('主标题');
    expect(firstHtml).toContain('<h1 data-heading-pos="0">主标题</h1>');
    expect(secondHtml).toContain('<li>');
    expect(elapsed).toBeLessThan(1500);
  });

  it('不破坏 YAML frontmatter、围栏代码块与 GFM 表格完整性，且不把围栏/frontmatter 内 # 误认作标题', () => {
    const frontmatter = ['---', 'title: 测试文档', '# comment in yaml', '---', ''].join('\n');
    const filler = Array.from({ length: 85 }, (_, i) => `段落行 ${i}`).join('\n');
    const fence = [
      '```ts',
      ...Array.from({ length: 50 }, (_, i) => `# fake heading ${i}\nconst v${i} = ${i};`),
      '```',
      '',
    ].join('\n');
    const table = [
      '| 列一 | 列二 |',
      '| --- | --- |',
      ...Array.from({ length: 45 }, (_, i) => `| 值 ${i}<br>换行 | 备注 ${i} |`),
      '',
    ].join('\n');
    const afterHeading = '## 真实二级标题\n\n正文';

    const doc = splitMarkdownForReader(
      `${frontmatter}${filler}\n\n${fence}${table}${afterHeading}`,
      60,
      90,
    );

    expect(doc.headings.map((h) => h.text)).toEqual(['真实二级标题']);
    // 围栏代码块在某一个独立片段内完整闭合
    const fenceChunk = doc.chunks.find((c) => c.markdown.includes('```ts'));
    expect(fenceChunk).toBeDefined();
    expect(fenceChunk!.markdown).toContain('```ts');
    expect(fenceChunk!.markdown).toContain('const v49 = 49;');
    expect(fenceChunk!.markdown).toContain('\n```');

    // GFM 表格头与分隔行在同一片段中保持完整
    const tableChunk = doc.chunks.find((c) => c.markdown.includes('| 列一 | 列二 |'));
    expect(tableChunk).toBeDefined();
    expect(tableChunk!.markdown).toContain('| --- | --- |');
    const tableHtml = renderMarkdownChunkToHtml(tableChunk!, doc.referenceDefs);
    expect(tableHtml).toContain('<table>');
    expect(tableHtml).toContain('<br>');
  });

  it('提取 ATX 与 Setext 标题、生成唯一 slug id，并忽略引用块内假标题偏移冲突', () => {
    const content = [
      '# 重复标题',
      '',
      'Setext 一级',
      '===========',
      '',
      'Setext 二级',
      '-----------',
      '',
      '> # 引用块内标题',
      '',
      '## 重复标题',
    ].join('\n');

    const doc = splitMarkdownForReader(content);
    expect(doc.headings.map((h) => ({ id: h.id, level: h.level, text: h.text }))).toEqual([
      { id: '重复标题', level: 1, text: '重复标题' },
      { id: 'setext-一级', level: 1, text: 'Setext 一级' },
      { id: 'setext-二级', level: 2, text: 'Setext 二级' },
      { id: '重复标题-1', level: 2, text: '重复标题' },
    ]);

    const html = renderMarkdownChunkToHtml(doc.chunks[0], doc.referenceDefs);
    for (const h of doc.headings) {
      expect(html).toContain(`data-heading-pos="${h.pos}"`);
    }
  });

  it('解析跨片段引用链接，且后续片段中的水平分割线不会被误判为 YAML frontmatter', () => {
    const chunk0Lines = ['点击[跨片段链接][ref-target]查看详情。', ''];
    for (let i = 0; i < 90; i++) {
      chunk0Lines.push(`填充文本 ${i}`);
      chunk0Lines.push('');
    }
    const chunk1Lines = [
      '---',
      '',
      '分割线下方正文',
      '',
      '---',
      '',
      '[ref-target]: https://example.com/docs',
    ];
    const doc = splitMarkdownForReader([...chunk0Lines, ...chunk1Lines].join('\n'), 80, 100);
    expect(doc.chunks.length).toBeGreaterThanOrEqual(2);

    const html0 = renderMarkdownChunkToHtml(doc.chunks[0], doc.referenceDefs);
    const html1 = renderMarkdownChunkToHtml(doc.chunks[doc.chunks.length - 1], doc.referenceDefs);

    expect(html0).toContain('<a href="https://example.com/docs">跨片段链接</a>');
    expect(html1).toContain('<hr>');
    expect(html1).toContain('分割线下方正文');
    expect(html1).not.toContain('language-yaml');
  });

  it('对原始 HTML 与危险脚本保持纯文本转义，并重写图片 src 为 data-inkmark-src', () => {
    const content = [
      '<script>alert("xss")</script>',
      '',
      '<img src="x" onerror="alert(1)">',
      '',
      '![示意图](./assets/demo.png "标题")',
    ].join('\n');

    const doc = splitMarkdownForReader(content);
    const html = renderMarkdownChunkToHtml(doc.chunks[0], doc.referenceDefs);

    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/<img[^>]*onerror=/i);
    expect(html).toContain('&#x3C;script>alert("xss")&#x3C;/script>');
    expect(html).toContain('&#x3C;img src="x" onerror="alert(1)">');
    expect(html).toContain('data-inkmark-src="./assets/demo.png"');
    expect(html).not.toMatch(/<img[^>]*\ssrc="/);
  });

  it('超过 360 行的超长 GFM 表格保持在同一片段中，不被切分破坏表格语义', () => {
    const tableLines = ['| 列A | 列B |', '| --- | --- |'];
    for (let i = 0; i < 420; i++) {
      tableLines.push(`| 行${i} | 值${i} |`);
    }
    const content = `# 表格测试\n\n${tableLines.join('\n')}\n\n表格后段落`;

    const doc = splitMarkdownForReader(content, 60, 90);
    const tableChunk = doc.chunks.find((c) => c.markdown.includes('| 列A | 列B |'));
    expect(tableChunk).toBeDefined();
    expect(tableChunk!.markdown).toContain('| 行419 | 值419 |');

    const html = renderMarkdownChunkToHtml(tableChunk!, doc.referenceDefs);
    expect(html).toContain('<table>');
    expect(html).toContain('<td>行419</td>');
  });

  it('记录多行 Setext 标题的完整起点偏移与全文标题文本并标记 data-heading-pos', () => {
    const content = ['Title', 'continued', '---', '', '正文段落'].join('\n');

    const doc = splitMarkdownForReader(content);
    expect(doc.headings).toHaveLength(1);
    expect(doc.headings[0]).toMatchObject({
      level: 2,
      text: 'Title continued',
      pos: 0,
    });

    const html = renderMarkdownChunkToHtml(doc.chunks[0], doc.referenceDefs);
    expect(html).toContain('<h2 data-heading-pos="0">Title<br>continued</h2>');
  });
});
