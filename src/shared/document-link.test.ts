import { describe, expect, it } from 'vitest';
import { classifyDocumentLinkHref } from './document-link';

describe('classifyDocumentLinkHref', () => {
  it('网页与邮件链接整体交给系统，包括其中的锚点', () => {
    expect(classifyDocumentLinkHref('https://example.com/a#top')).toEqual({
      kind: 'external',
      url: 'https://example.com/a#top',
    });
    expect(classifyDocumentLinkHref('http://example.com')).toEqual({
      kind: 'external',
      url: 'http://example.com',
    });
    expect(classifyDocumentLinkHref('mailto:someone@example.com')).toEqual({
      kind: 'external',
      url: 'mailto:someone@example.com',
    });
  });

  it('相对路径与绝对路径的文档链接', () => {
    expect(classifyDocumentLinkHref('./other.md')).toEqual({
      kind: 'document',
      path: './other.md',
      hash: '',
    });
    expect(classifyDocumentLinkHref('notes/todo.md')).toEqual({
      kind: 'document',
      path: 'notes/todo.md',
      hash: '',
    });
    expect(classifyDocumentLinkHref('../上层/文档.markdown')).toEqual({
      kind: 'document',
      path: '../上层/文档.markdown',
      hash: '',
    });
    expect(classifyDocumentLinkHref('/home/user/a.txt')).toEqual({
      kind: 'document',
      path: '/home/user/a.txt',
      hash: '',
    });
    expect(classifyDocumentLinkHref('C:\\docs\\计划.md')).toEqual({
      kind: 'document',
      path: 'C:\\docs\\计划.md',
      hash: '',
    });
    expect(classifyDocumentLinkHref('./A.MD')).toEqual({
      kind: 'document',
      path: './A.MD',
      hash: '',
    });
  });

  it('文档链接带锚点时拆出锚点并保留路径', () => {
    expect(classifyDocumentLinkHref('./release.md#发布流程')).toEqual({
      kind: 'document',
      path: './release.md',
      hash: '发布流程',
    });
  });

  it('百分号编码的路径先解码再判定', () => {
    expect(classifyDocumentLinkHref('my%20doc.md')).toEqual({
      kind: 'document',
      path: 'my doc.md',
      hash: '',
    });
    // 文件名里的 # 按 %23 编码，不应被误当锚点拆开。
    expect(classifyDocumentLinkHref('a%23b.md')).toEqual({
      kind: 'document',
      path: 'a#b.md',
      hash: '',
    });
  });

  it('首尾空白按 trim 处理', () => {
    expect(classifyDocumentLinkHref(' ./a.md ')).toEqual({
      kind: 'document',
      path: './a.md',
      hash: '',
    });
  });

  it('纯页内锚点、非文档文件与其他协议不做处理', () => {
    expect(classifyDocumentLinkHref('#section')).toEqual({ kind: 'none' });
    expect(classifyDocumentLinkHref('')).toEqual({ kind: 'none' });
    expect(classifyDocumentLinkHref('   ')).toEqual({ kind: 'none' });
    expect(classifyDocumentLinkHref('./image.png')).toEqual({ kind: 'none' });
    expect(classifyDocumentLinkHref('image.png')).toEqual({ kind: 'none' });
    expect(classifyDocumentLinkHref('file:///C:/a.md')).toEqual({ kind: 'none' });
    expect(classifyDocumentLinkHref('javascript:alert(1)')).toEqual({ kind: 'none' });
    expect(classifyDocumentLinkHref('inkmark-local://a.png')).toEqual({ kind: 'none' });
  });

  it('畸形百分号编码按原样参与扩展名判定', () => {
    expect(classifyDocumentLinkHref('my%zzdoc.md')).toEqual({
      kind: 'document',
      path: 'my%zzdoc.md',
      hash: '',
    });
    expect(classifyDocumentLinkHref('my%zzdoc')).toEqual({ kind: 'none' });
  });
});
