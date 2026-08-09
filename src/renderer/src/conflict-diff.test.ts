import { describe, expect, it } from 'vitest';
import { buildConflictDiff } from './conflict-diff';

describe('conflict diff', () => {
  it('marks disk-only and current-only lines in their display order', () => {
    expect(buildConflictDiff('same\ndisk\n', 'same\ncurrent\n')).toEqual([
      { kind: 'unchanged', value: 'same\n' },
      { kind: 'removed', value: 'disk\n' },
      { kind: 'added', value: 'current\n' },
    ]);
  });
});
