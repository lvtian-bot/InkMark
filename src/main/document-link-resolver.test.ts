import { describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'path';
import { resolveDocumentLink } from './document-link-resolver';

// 期望值统一用 path 模块动态计算，保持与被测实现同源的平台语义，
// 测试只验证「基准目录取所在文档目录、目标经归一化」这一约定本身。
const expectedPath = (sourcePath: string, href: string): string =>
  resolve(dirname(sourcePath), href);

describe('resolveDocumentLink', () => {
  it('相对链接以链接所在文档的目录为基准解析', () => {
    expect(resolveDocumentLink('C:\\docs\\a.md', './b.md')).toEqual({
      status: 'ok',
      path: expectedPath('C:\\docs\\a.md', './b.md'),
    });
    expect(resolveDocumentLink(join('/', 'notes', 'index.md'), 'sub/b.md')).toEqual({
      status: 'ok',
      path: expectedPath(join('/', 'notes', 'index.md'), 'sub/b.md'),
    });
  });

  it('上级目录与多级相对路径正常归一化', () => {
    expect(resolveDocumentLink(join('/', 'notes', '2026', 'a.md'), '../../b.md')).toEqual({
      status: 'ok',
      path: expectedPath(join('/', 'notes', '2026', 'a.md'), '../../b.md'),
    });
  });

  it('带锚点的文档链接按去锚点后的路径解析', () => {
    const result = resolveDocumentLink(join('/', 'docs', 'a.md'), './b.md#发布流程');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.path.endsWith('b.md')).toBe(true);
  });

  it('非文档类目标返回 not-document，交由调用方维持现状', () => {
    expect(resolveDocumentLink(join('/', 'docs', 'a.md'), './image.png')).toEqual({
      status: 'not-document',
    });
    expect(resolveDocumentLink(join('/', 'docs', 'a.md'), 'https://example.com')).toEqual({
      status: 'not-document',
    });
    expect(resolveDocumentLink(join('/', 'docs', 'a.md'), '#section')).toEqual({
      status: 'not-document',
    });
    expect(resolveDocumentLink(join('/', 'docs', 'a.md'), '')).toEqual({ status: 'not-document' });
  });
});
