import { describe, expect, it } from 'vitest';
import {
  hasOpenableDocumentExtension,
  isLargeMarkdownContent,
  isMarkdownDocumentPath,
  LARGE_MARKDOWN_THRESHOLD_BYTES,
  MAX_OPEN_FILE_SIZE_BYTES,
  measureUtf8ByteLength,
  OPENABLE_DOCUMENT_EXTENSIONS,
  resolveDocumentKind,
} from './openable-document';

describe('hasOpenableDocumentExtension', () => {
  it('matches markdown, plain-text and code extensions case-insensitively', () => {
    expect(hasOpenableDocumentExtension('readme.md')).toBe(true);
    expect(hasOpenableDocumentExtension('notes.TXT')).toBe(true);
    expect(hasOpenableDocumentExtension('app.py')).toBe(true);
    expect(hasOpenableDocumentExtension('config.JSON')).toBe(true);
    expect(hasOpenableDocumentExtension('main.Ts')).toBe(true);
  });

  it('rejects unknown or binary extensions', () => {
    expect(hasOpenableDocumentExtension('image.png')).toBe(false);
    expect(hasOpenableDocumentExtension('archive.zip')).toBe(false);
    expect(hasOpenableDocumentExtension('debug.log')).toBe(false);
    expect(hasOpenableDocumentExtension('doc.mdown')).toBe(false);
    expect(hasOpenableDocumentExtension('Makefile')).toBe(false);
    expect(hasOpenableDocumentExtension('')).toBe(false);
  });
});

describe('resolveDocumentKind', () => {
  it('treats missing paths (new documents, start page) as markdown', () => {
    expect(resolveDocumentKind(null)).toBe('markdown');
  });

  it('classifies by extension regardless of letter case', () => {
    expect(resolveDocumentKind('C:/docs/note.md')).toBe('markdown');
    expect(resolveDocumentKind('C:/docs/note.MARKDOWN')).toBe('markdown');
    expect(resolveDocumentKind('C:/src/app.py')).toBe('text');
    expect(resolveDocumentKind('C:/notes/config.YML')).toBe('text');
  });
});

describe('isMarkdownDocumentPath', () => {
  it('returns false for null and non-markdown paths', () => {
    expect(isMarkdownDocumentPath(null)).toBe(false);
    expect(isMarkdownDocumentPath('C:/src/app.py')).toBe(false);
    expect(isMarkdownDocumentPath('C:/docs/note.md')).toBe(true);
  });
});

describe('MAX_OPEN_FILE_SIZE_BYTES', () => {
  it('matches the 10 MB limit referenced by user-facing messages', () => {
    expect(MAX_OPEN_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('LARGE_MARKDOWN_THRESHOLD_BYTES & isLargeMarkdownContent', () => {
  it('uses 1 MB threshold and accounts for UTF-8 multi-byte characters', () => {
    expect(LARGE_MARKDOWN_THRESHOLD_BYTES).toBe(1024 * 1024);
    expect(isLargeMarkdownContent('a'.repeat(LARGE_MARKDOWN_THRESHOLD_BYTES))).toBe(false);
    expect(isLargeMarkdownContent('a'.repeat(LARGE_MARKDOWN_THRESHOLD_BYTES + 1))).toBe(true);

    // 中文单字 UTF-8 占 3 字节，40 万字（length < 1M）实际字节已超过 1 MB
    const cjkOverLimit = '字'.repeat(400_000);
    expect(measureUtf8ByteLength(cjkOverLimit)).toBe(1_200_000);
    expect(isLargeMarkdownContent(cjkOverLimit)).toBe(true);

    const cjkUnderLimit = '字'.repeat(300_000);
    expect(measureUtf8ByteLength(cjkUnderLimit)).toBe(900_000);
    expect(isLargeMarkdownContent(cjkUnderLimit)).toBe(false);
  });
});

describe('OPENABLE_DOCUMENT_EXTENSIONS', () => {
  it('lists markdown extensions before plain-text ones', () => {
    expect(OPENABLE_DOCUMENT_EXTENSIONS.slice(0, 2)).toEqual(['.md', '.markdown']);
  });
});
