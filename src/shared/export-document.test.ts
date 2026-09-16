import { describe, expect, it } from 'vitest';
import { isExportDocumentRequest, sanitizeExportFileName } from './export-document';

describe('sanitizeExportFileName', () => {
  it('去掉 Markdown/TXT 扩展名', () => {
    expect(sanitizeExportFileName('报告.md')).toBe('报告');
    expect(sanitizeExportFileName('notes.markdown')).toBe('notes');
    expect(sanitizeExportFileName('readme.TXT')).toBe('readme');
  });

  it('替换文件系统非法字符', () => {
    expect(sanitizeExportFileName('a<b>c:d"e/f\\g|h?i*j%k#l')).toBe('a-b-c-d-e-f-g-h-i-j-k-l');
    expect(sanitizeExportFileName('line1\nline2')).toBe('line1-line2');
  });

  it('清理结尾的点与空格并截断超长名称', () => {
    expect(sanitizeExportFileName('标题...  ')).toBe('标题');
    expect(sanitizeExportFileName('x'.repeat(100)).length).toBe(80);
  });

  it('空名称或纯非法字符回落 document', () => {
    expect(sanitizeExportFileName('')).toBe('document');
    expect(sanitizeExportFileName('.md')).toBe('document');
    expect(sanitizeExportFileName('???')).toBe('---');
  });
});

describe('isExportDocumentRequest', () => {
  it('放行合法请求', () => {
    expect(
      isExportDocumentRequest({
        kind: 'pdf',
        markdown: '# t',
        title: 't.md',
        sourcePath: null,
      }),
    ).toBe(true);
  });

  it('拒绝非法 kind、缺失字段与空 sourcePath', () => {
    expect(isExportDocumentRequest(null)).toBe(false);
    expect(
      isExportDocumentRequest({
        kind: 'docx',
        markdown: '',
        title: '',
        sourcePath: null,
      }),
    ).toBe(false);
    expect(
      isExportDocumentRequest({
        kind: 'html',
        title: '',
        sourcePath: null,
      }),
    ).toBe(false);
    expect(
      isExportDocumentRequest({
        kind: 'html',
        markdown: '',
        sourcePath: null,
      }),
    ).toBe(false);
    expect(
      isExportDocumentRequest({
        kind: 'html',
        markdown: '',
        title: '',
        sourcePath: '',
      }),
    ).toBe(false);
  });
});
