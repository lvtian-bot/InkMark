import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderExportBodyHtml, renderExportDocument } from './export-document';

const baseOptions = {
  title: '示例文档',
  sourcePath: null,
  strictLineBreaks: false,
  target: 'standalone' as const,
};

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'inkmark-export-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  // 临时目录留给系统清理；测试进程不负责删除 Windows 上可能被占用的目录。
});

// 1×1 透明 PNG 的最小字节序列，仅用于真实文件读取路径，不做图像解码。
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

describe('renderExportBodyHtml 基础渲染', () => {
  it('渲染标题、强调、删除线与代码块', async () => {
    const html = await renderExportBodyHtml({
      ...baseOptions,
      markdown: '# 标题\n\n**粗体** 与 ~~删除~~\n\n```js\nconst a = 1;\n```\n',
    });
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).toContain('<del>删除</del>');
    expect(html).toContain('<pre><code');
    expect(html).toContain('const a = 1;');
  });

  it('渲染 GFM 表格与任务列表', async () => {
    const html = await renderExportBodyHtml({
      ...baseOptions,
      markdown: '| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] 已办\n- [ ] 待办\n',
    });
    expect(html).toContain('<table>');
    expect(html).toContain('task-list-item');
    expect(html).toContain('type="checkbox"');
  });

  it('frontmatter 保留为 YAML 代码块', async () => {
    const html = await renderExportBodyHtml({
      ...baseOptions,
      markdown: '---\ntitle: 计划\n---\n\n正文\n',
    });
    expect(html).toContain('<pre>');
    expect(html).toContain('language-yaml');
    expect(html).toContain('title: 计划');
  });

  it('原始 HTML 按字面文本转义，不产生可执行标签', async () => {
    const html = await renderExportBodyHtml({
      ...baseOptions,
      markdown: '前文\n\n<script>alert(1)</script>\n',
    });
    expect(html).not.toContain('<script');
    expect(html).toContain('alert(1)');
  });
});

describe('换行语义', () => {
  it('宽松换行把段内单回车渲染为 <br>', async () => {
    const html = await renderExportBodyHtml({
      ...baseOptions,
      strictLineBreaks: false,
      markdown: '第一行\n第二行\n',
    });
    expect(html).toContain('第一行<br>第二行');
  });

  it('严格换行把段内单回车渲染为空格', async () => {
    const html = await renderExportBodyHtml({
      ...baseOptions,
      strictLineBreaks: true,
      markdown: '第一行\n第二行\n',
    });
    expect(html).not.toContain('<br');
    expect(html).toContain('第一行 第二行');
  });
});

describe('图片引用', () => {
  it('standalone 把本地相对图片内嵌为 base64', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'pic.png'), PNG_BYTES);
    const docPath = join(dir, 'doc.md');
    const html = await renderExportBodyHtml({
      ...baseOptions,
      markdown: '![图](./pic.png)\n',
      sourcePath: docPath,
    });
    expect(html).toMatch(/<img src="data:image\/png;base64,/);
    expect(html).not.toContain('./pic.png');
  });

  it('print 把本地相对图片改写为 file:// URL', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'pic.png'), PNG_BYTES);
    const docPath = join(dir, 'doc.md');
    const html = await renderExportBodyHtml({
      ...baseOptions,
      target: 'print',
      markdown: '![图](./pic.png)\n',
      sourcePath: docPath,
    });
    expect(html).toMatch(/src="file:\/\/\//);
    expect(html).toContain('pic.png');
  });

  it('按 URI 解码候选解析 %20 空格路径', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'my image.png'), PNG_BYTES);
    const html = await renderExportBodyHtml({
      ...baseOptions,
      markdown: '![图](./my%20image.png)\n',
      sourcePath: join(dir, 'doc.md'),
    });
    expect(html).toContain('data:image/png;base64,');
  });

  it('不存在的本地图片保持原引用', async () => {
    const html = await renderExportBodyHtml({
      ...baseOptions,
      markdown: '![图](./missing.png)\n',
      sourcePath: join(makeTempDir(), 'doc.md'),
    });
    expect(html).toContain('src="./missing.png"');
  });

  it('http 与 data 引用原样保留', async () => {
    const html = await renderExportBodyHtml({
      ...baseOptions,
      markdown: '![a](https://example.com/x.png) ![b](data:image/png;base64,AAAA)\n',
    });
    expect(html).toContain('src="https://example.com/x.png"');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });
});

describe('renderExportDocument 文档外壳', () => {
  it('包含标题、markdown-body 容器与导出样式', async () => {
    const html = await renderExportDocument({
      ...baseOptions,
      markdown: '# H\n',
      title: '报告 <2026>',
    });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>报告 &lt;2026&gt;</title>');
    expect(html).toContain('class="markdown-body"');
    expect(html).toContain('max-width: 880px');
    expect(html).toContain('<h1>H</h1>');
  });

  it('print 目标不叠加页面内边距', async () => {
    const html = await renderExportDocument({ ...baseOptions, target: 'print', markdown: 'x' });
    expect(html).toContain('max-width: none');
    expect(html).not.toContain('max-width: 880px');
  });
});
