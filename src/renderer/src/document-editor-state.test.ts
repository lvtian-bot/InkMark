import { describe, expect, it } from 'vitest';
import { createDocumentEditorState } from './document-editor-state';

describe('document editor state', () => {
  it('isolates editor history by tab and mode', () => {
    const states = createDocumentEditorState<{ source: object; wysiwyg: object }>();
    const sourceA = { name: 'source-a-history' };
    const sourceB = { name: 'source-b-history' };
    const wysiwygA = { name: 'wysiwyg-a-history' };

    states.capture('a', 'source', 'A2', sourceA);
    states.capture('b', 'source', 'B2', sourceB);
    states.capture('a', 'wysiwyg', 'A2', wysiwygA);

    expect(states.restore('a', 'source', 'A2')).toBe(sourceA);
    expect(states.restore('b', 'source', 'B2')).toBe(sourceB);
    expect(states.restore('a', 'wysiwyg', 'A2')).toBe(wysiwygA);
  });

  it('does not restore editor history captured for stale content', () => {
    const states = createDocumentEditorState<{ source: object; wysiwyg: object }>();
    const staleState = { name: 'before-external-reload' };

    states.capture('a', 'source', 'before', staleState);

    expect(states.restore('a', 'source', 'after')).toBeUndefined();
    expect(states.restore('a', 'source', 'before')).toBeUndefined();
  });

  it('disposes every editor state owned by a closed tab', () => {
    const states = createDocumentEditorState<{ source: object; wysiwyg: object }>();

    states.capture('a', 'source', 'A', { name: 'source' });
    states.capture('a', 'wysiwyg', 'A', { name: 'wysiwyg' });
    states.dispose('a');

    expect(states.restore('a', 'source', 'A')).toBeUndefined();
    expect(states.restore('a', 'wysiwyg', 'A')).toBeUndefined();
  });
});
