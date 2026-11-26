import { describe, expect, it } from 'vitest';
import {
  extractReadableMarkdownText,
  renderMarkdownChunkToHtml,
  splitMarkdownForReader,
} from './large-markdown-chunks';

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

  it('跨空行但带缩进的列表续行段落保留在同一列表项片段中，不拆出列表容器', () => {
    const lines = ['- Intro'];
    for (let i = 0; i < 82; i++) {
      lines.push(`  indented continuation ${i}`);
    }
    lines.push('', '  second paragraph inside list item', '', '- Next top item');
    const content = lines.join('\n');

    const doc = splitMarkdownForReader(content, 60, 90);
    const firstListChunk = doc.chunks.find((c) => c.markdown.includes('- Intro'));
    expect(firstListChunk).toBeDefined();
    expect(firstListChunk!.markdown).toContain('second paragraph inside list item');

    const html = renderMarkdownChunkToHtml(firstListChunk!, doc.referenceDefs);
    expect(html).toContain('<li>');
    expect(html).toContain('second paragraph inside list item');
  });

  it('收集地址位于下一行的多行引用式链接定义并跨片段解析', () => {
    const filler = Array.from({ length: 165 }, (_, i) => `填充段落 ${i}\n`).join('\n');
    const content = [
      '请查看 [documentation][docs] 获取详情。',
      '',
      filler,
      '[docs]:',
      '  https://example.com/docs',
      '  "Documentation Title"',
    ].join('\n');

    const doc = splitMarkdownForReader(content, 60, 80);
    expect(doc.chunks.length).toBeGreaterThanOrEqual(2);
    expect(doc.referenceDefs).toContain('https://example.com/docs');

    const html0 = renderMarkdownChunkToHtml(doc.chunks[0], doc.referenceDefs);
    expect(html0).toContain(
      '<a href="https://example.com/docs" title="Documentation Title">documentation</a>',
    );
  });

  it('extractReadableMarkdownText 剔除 YAML 头、链接地址、引用定义与 Markdown 标记', () => {
    const sample = [
      '---',
      'title: MetaOnly',
      'author: Nobody',
      '---',
      '',
      '# Heading Title ###',
      '',
      'See [Click Here](https://very-long.example.com/path/to/page) and ![AltText](./img.png).',
      '',
      '- **BoldItem** with `code`',
      '',
      '[ref]:',
      '  https://ref-only.example.com',
    ].join('\n');

    const extracted = extractReadableMarkdownText(sample);
    expect(extracted).not.toContain('MetaOnly');
    expect(extracted).not.toContain('https://very-long.example.com');
    expect(extracted).not.toContain('https://ref-only.example.com');
    expect(extracted).toContain('Heading Title');
    expect(extracted).toContain('Click Here');
    expect(extracted).toContain('AltText');
    expect(extracted).toContain('BoldItem with code');
  });

  it('跨分块延续重复 1. 与非 1 起始有序列表编号，且更换列表分隔符时不错误延续', () => {
    const repeatedLines = Array.from({ length: 250 }, (_, i) => `1. Item ${i + 1}`);
    const doc = splitMarkdownForReader(repeatedLines.join('\n'), 80, 120);
    expect(doc.chunks).toHaveLength(3);

    const html0 = renderMarkdownChunkToHtml(doc.chunks[0], doc.referenceDefs);
    const html1 = renderMarkdownChunkToHtml(doc.chunks[1], doc.referenceDefs);
    const html2 = renderMarkdownChunkToHtml(doc.chunks[2], doc.referenceDefs);
    expect(html0).toContain('<ol>');
    expect(html0).not.toContain('start="');
    expect(html1).toContain('<ol start="121">');
    expect(html2).toContain('<ol start="241">');

    // 宽松有序列表与非 1 起始（5. 后接 1.）
    const looseLines: string[] = [];
    for (let i = 0; i < 65; i++) {
      looseLines.push(i === 0 ? '5. Loose start' : `1. Loose ${i}`, '');
    }
    const looseDoc = splitMarkdownForReader(looseLines.join('\n'), 80, 120);
    expect(looseDoc.chunks.length).toBeGreaterThanOrEqual(2);
    const looseHtml1 = renderMarkdownChunkToHtml(looseDoc.chunks[1], looseDoc.referenceDefs);
    expect(looseHtml1).toContain(`<ol start="${5 + 40}">`);

    // 分隔符由 '.' 换为 ')' 时应开启新有序列表，不延续此前 '.' 列表序号
    const switchedLines = [
      ...Array.from({ length: 120 }, (_, i) => `1. Dot ${i + 1}`),
      ...Array.from({ length: 20 }, (_, i) => `1) Paren ${i + 1}`),
    ];
    const switchedDoc = splitMarkdownForReader(switchedLines.join('\n'), 80, 120);
    expect(switchedDoc.chunks.length).toBeGreaterThanOrEqual(2);
    const switchedHtml1 = renderMarkdownChunkToHtml(
      switchedDoc.chunks[1],
      switchedDoc.referenceDefs,
    );
    expect(switchedHtml1).toContain('<ol>\n<li>Paren 1</li>');
    expect(switchedHtml1).not.toContain('start="121"');
  });

  it('存在同名重复引用定义时保持全文首个定义优先，且不破坏后续片段标题偏移', () => {
    const filler = Array.from({ length: 90 }, (_, i) => `间隔段落 ${i}`).join('\n\n');
    const content = [
      '[dup]: https://first.example "First"',
      '',
      filler,
      '',
      '## Later Heading',
      '',
      '访问 [Link][dup] 验证。',
      '',
      '[dup]: https://second.example "Second"',
    ].join('\n');

    const doc = splitMarkdownForReader(content, 60, 90);
    expect(doc.chunks.length).toBeGreaterThanOrEqual(2);
    const laterHeading = doc.headings.find((h) => h.text === 'Later Heading');
    expect(laterHeading).toBeDefined();
    const targetChunk = doc.chunks[doc.headingToChunk.get(laterHeading!.pos)!];
    const html = renderMarkdownChunkToHtml(targetChunk, doc.referenceDefs);

    expect(html).toContain(`<h2 data-heading-pos="${laterHeading!.pos}">Later Heading</h2>`);
    expect(html).toContain('<a href="https://first.example" title="First">Link</a>');
    expect(html).not.toContain('https://second.example');
  });

  it('列表项内含 20,000 行连续空行后接缩进续行时保持线性切分性能', () => {
    const blankGap = '\n'.repeat(20_000);
    const content = `1. Start\n${blankGap}   indented continuation\n\n2. Second`;

    const start = performance.now();
    const doc = splitMarkdownForReader(content, 80, 120);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(doc.chunks).toHaveLength(2);
    expect(doc.chunks[0].markdown).toContain('1. Start');
    expect(doc.chunks[0].markdown).toContain('indented continuation');
    expect(doc.chunks[1].markdown.trim()).toBe('2. Second');
  });

  it('引用式本地图片与跨片段图片统一输出 data-inkmark-src，未定义引用按原文回退', () => {
    const filler = Array.from({ length: 90 }, (_, i) => `段落 ${i}`).join('\n\n');
    const content = [
      '[photo]: ./assets/first.png "首图"',
      '',
      '![本地图][photo] 与 ![缺失图][missing]',
      '',
      filler,
      '',
      '后文再引用 ![重复图][photo]',
      '',
      '[photo]: ./assets/second.png "重复定义"',
    ].join('\n');

    const doc = splitMarkdownForReader(content, 60, 90);
    expect(doc.chunks.length).toBeGreaterThanOrEqual(2);

    const html0 = renderMarkdownChunkToHtml(doc.chunks[0], doc.referenceDefs);
    expect(html0).toContain('data-inkmark-src="./assets/first.png"');
    expect(html0).toContain('alt="本地图"');
    expect(html0).toContain('title="首图"');
    expect(html0).not.toMatch(/<img[^>]*\ssrc="/);
    expect(html0).toContain('![缺失图][missing]');

    const htmlLast = renderMarkdownChunkToHtml(
      doc.chunks[doc.chunks.length - 1],
      doc.referenceDefs,
    );
    expect(htmlLast).toContain('data-inkmark-src="./assets/first.png"');
    expect(htmlLast).not.toContain('./assets/second.png');

    const readable = extractReadableMarkdownText('看图 ![示例文字][photo]\n\n[photo]: ./a.png');
    expect(readable).toContain('示例文字');
    expect(readable).not.toContain('!示例文字');
  });

  it('引用块内嵌超长围栏代码块、嵌套引用围栏、引用表格与列表行内围栏保持完整，未闭合引用围栏随引用块结束', () => {
    const quotedCode = [
      '> ```js',
      ...Array.from({ length: 250 }, (_, i) => `> const line${i} = ${i};`),
      '> ```',
      '',
      '正常正文',
    ].join('\n');
    const quotedDoc = splitMarkdownForReader(quotedCode, 80, 120);
    const fenceChunk = quotedDoc.chunks.find((c) => c.markdown.includes('> ```js'));
    expect(fenceChunk).toBeDefined();
    expect(fenceChunk!.markdown).toContain('> const line249 = 249;');
    expect(fenceChunk!.markdown).toContain('\n> ```');
    const fenceHtml = renderMarkdownChunkToHtml(fenceChunk!, quotedDoc.referenceDefs);
    expect(fenceHtml).toContain('<blockquote>');
    expect(fenceHtml).toContain('<code class="language-js">');
    expect(fenceHtml).toContain('const line249 = 249;');

    // 未闭合的引用块围栏在空行结束引用块后自动关闭，后续真实标题正常提取
    const unclosedQuoted = [
      '> ```js',
      '> const orphan = 1;',
      '',
      '# Real Heading After Quote',
    ].join('\n');
    const unclosedDoc = splitMarkdownForReader(unclosedQuoted, 80, 120);
    expect(unclosedDoc.headings.map((h) => h.text)).toEqual(['Real Heading After Quote']);

    // 引用块内超长 GFM 表格不拆散
    const quotedTable = [
      '> | Col1 | Col2 |',
      '> | --- | --- |',
      ...Array.from({ length: 160 }, (_, i) => `> | R${i} | V${i} |`),
      '',
      '表后文本',
    ].join('\n');
    const tableDoc = splitMarkdownForReader(quotedTable, 60, 90);
    const tableChunk = tableDoc.chunks.find((c) => c.markdown.includes('> | Col1 | Col2 |'));
    expect(tableChunk).toBeDefined();
    expect(tableChunk!.markdown).toContain('> | R159 | V159 |');
    const tableHtml = renderMarkdownChunkToHtml(tableChunk!, tableDoc.referenceDefs);
    expect(tableHtml).toContain('<blockquote>');
    expect(tableHtml).toContain('<table>');
    expect(tableHtml).toContain('<td>R159</td>');

    // 列表项行内围栏保持完整且继续累加有序列表编号
    const listFence = [
      '1. First',
      '1. ```ts',
      ...Array.from({ length: 130 }, (_, i) => `   const v${i} = ${i};`),
      '   ```',
      '',
      '1. Third',
    ].join('\n');
    const listFenceDoc = splitMarkdownForReader(listFence, 60, 90);
    expect(listFenceDoc.chunks).toHaveLength(2);
    expect(listFenceDoc.chunks[0].markdown).toContain('const v129 = 129;');
    const nextListHtml = renderMarkdownChunkToHtml(
      listFenceDoc.chunks[1],
      listFenceDoc.referenceDefs,
    );
    expect(nextListHtml).toContain('<ol start="3">');
  });

  it('文档以未闭合代码围栏结尾时，全局引用定义不会泄露进代码块，且围栏前链接与前置 frontmatter/标题偏移正常', () => {
    const filler = Array.from({ length: 90 }, (_, i) => `填充行 ${i}`).join('\n\n');
    const content = [
      '---',
      'title: UnclosedFenceDoc',
      '---',
      '',
      '# Front Heading',
      '',
      '[ext]: https://example.com/ext "External"',
      '',
      '[not-a-def]: invalid url with spaces',
      '',
      filler,
      '',
      '## Final Section',
      '',
      '查看 [外链][ext]。',
      '',
      '```js',
      'const tail = 42;',
    ].join('\n');

    const doc = splitMarkdownForReader(content, 60, 90);
    expect(doc.chunks.length).toBeGreaterThanOrEqual(2);
    expect(doc.referenceDefs).toContain('https://example.com/ext');
    expect(doc.referenceDefs).not.toContain('invalid url with spaces');

    const frontHeading = doc.headings.find((h) => h.text === 'Front Heading')!;
    const finalHeading = doc.headings.find((h) => h.text === 'Final Section')!;
    const html0 = renderMarkdownChunkToHtml(doc.chunks[0], doc.referenceDefs);
    expect(html0).toContain('language-yaml');
    expect(html0).toContain('title: UnclosedFenceDoc');
    expect(html0).toContain(`<h1 data-heading-pos="${frontHeading.pos}">Front Heading</h1>`);

    const htmlLast = renderMarkdownChunkToHtml(
      doc.chunks[doc.chunks.length - 1],
      doc.referenceDefs,
    );
    expect(htmlLast).toContain(`<h2 data-heading-pos="${finalHeading.pos}">Final Section</h2>`);
    expect(htmlLast).toContain('<a href="https://example.com/ext" title="External">外链</a>');
    expect(htmlLast).toContain('<code class="language-js">const tail = 42;\n</code>');
    expect(htmlLast).not.toContain('[ext]: https://example.com/ext');
    expect(htmlLast).not.toContain('invalid url with spaces');
  });

  it('1..3 空格缩进的顶层无序与有序列表按上限正常切分，不合并成单块且保持有序编号延续', () => {
    const indentedBullets = Array.from({ length: 12_000 }, (_, i) => `  - Indented item ${i}`).join(
      '\n',
    );
    const bulletDoc = splitMarkdownForReader(indentedBullets, 80, 120);
    expect(bulletDoc.chunks.length).toBeGreaterThanOrEqual(90);
    for (const chunk of bulletDoc.chunks) {
      expect(chunk.endLine - chunk.startLine + 1).toBeLessThanOrEqual(160);
    }

    const indentedOrdered = Array.from({ length: 250 }, (_, i) => `  1. Ordered ${i + 1}`).join(
      '\n',
    );
    const ordDoc = splitMarkdownForReader(indentedOrdered, 80, 120);
    expect(ordDoc.chunks).toHaveLength(3);
    expect(renderMarkdownChunkToHtml(ordDoc.chunks[1], ordDoc.referenceDefs)).toContain(
      '<ol start="121">',
    );
    expect(renderMarkdownChunkToHtml(ordDoc.chunks[2], ordDoc.referenceDefs)).toContain(
      '<ol start="241">',
    );

    // 2 空格顶层列表项内部的 4 空格缩进续行段落仍保留在同一列表项片段内
    const indentedWithContinuation = [
      '  - Head item',
      ...Array.from({ length: 82 }, (_, i) => `    body line ${i}`),
      '',
      '    second paragraph in indented item',
      '',
      '  - Sibling item',
    ].join('\n');
    const contDoc = splitMarkdownForReader(indentedWithContinuation, 60, 90);
    expect(contDoc.chunks[0].markdown).toContain('second paragraph in indented item');
    expect(contDoc.chunks.length).toBe(2);
    expect(contDoc.chunks[1].markdown).toContain('  - Sibling item');
  });
});
