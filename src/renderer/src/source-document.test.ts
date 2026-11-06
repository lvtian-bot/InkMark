import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { describe, expect, it } from 'vitest';
import { extractSourceHeadings, extractSourceText } from './source-document';

function sourceState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown()] });
}

describe('source document', () => {
  it('extracts real headings and ignores heading markers in code fences', () => {
    const state = sourceState(
      '# One\n\nOne\n===\n\n## One\n\n> # Nested\n\n```md\n# not a heading\n```',
    );

    expect(extractSourceHeadings(state)).toEqual([
      { id: 'one', level: 1, text: 'One', pos: 0 },
      { id: 'one-1', level: 1, text: 'One', pos: 7 },
      { id: 'one-2', level: 2, text: 'One', pos: 16 },
      { id: 'nested', level: 1, text: 'Nested', pos: 26 },
    ]);
  });

  it('extracts visible text without Markdown markers or link destinations', () => {
    const state = sourceState(
      '# 标题 One\n\n> **粗体** and [链接](https://example.com)\n\n- [x] task\n\n`code`',
    );

    expect(extractSourceText(state)).toBe(' 标题 One\n\n 粗体 and 链接\n\n  task\n\ncode');
  });

  it('keeps heading IDs unique when a numbered title collides with a duplicate', () => {
    const headings = extractSourceHeadings(sourceState('# a\n\n# a-1\n\n# a\n\n# B'));
    expect(headings.map((heading) => heading.id)).toEqual(['a', 'a-1', 'a-2', 'b']);
  });
});
