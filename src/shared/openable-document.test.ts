import { describe, expect, it } from 'vitest';
import {
  hasOpenableDocumentExtension,
  isMarkdownDocumentPath,
  MAX_OPEN_FILE_SIZE_BYTES,
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

describe('OPENABLE_DOCUMENT_EXTENSIONS', () => {
  it('lists markdown extensions before plain-text ones', () => {
    expect(OPENABLE_DOCUMENT_EXTENSIONS.slice(0, 2)).toEqual(['.md', '.markdown']);
  });
});
