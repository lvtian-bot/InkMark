import { describe, expect, it } from 'vitest';
import {
  decideCloseDirty,
  decideExternalChange,
  resolveConflictChoice,
} from './file-conflict-decision';

describe('decideExternalChange', () => {
  it('returns noop when disk mtime equals the recorded file mtime', () => {
    expect(
      decideExternalChange({
        fileMtime: 100,
        diskMtime: 100,
        isDirty: false,
        inReview: false,
      }),
    ).toBe('noop');
    expect(
      decideExternalChange({
        fileMtime: 100,
        diskMtime: 100,
        isDirty: true,
        inReview: true,
      }),
    ).toBe('noop');
  });

  it('returns noop when the tab has no recorded mtime yet', () => {
    expect(
      decideExternalChange({
        fileMtime: null,
        diskMtime: 100,
        isDirty: false,
        inReview: false,
      }),
    ).toBe('noop');
    expect(
      decideExternalChange({
        fileMtime: null,
        diskMtime: 100,
        isDirty: true,
        inReview: true,
      }),
    ).toBe('noop');
  });

  it('prompts a clean tab when the disk mtime changed (banner: replace or review)', () => {
    expect(
      decideExternalChange({
        fileMtime: 100,
        diskMtime: 200,
        isDirty: false,
        inReview: false,
      }),
    ).toBe('prompt');
  });

  it('asks for conflict resolution when a dirty tab faces an external change', () => {
    expect(
      decideExternalChange({
        fileMtime: 100,
        diskMtime: 200,
        isDirty: true,
        inReview: false,
      }),
    ).toBe('conflict');
  });

  it('keeps asking for conflict resolution regardless of mtime delta', () => {
    expect(
      decideExternalChange({ fileMtime: 5, diskMtime: 6, isDirty: true, inReview: false }),
    ).toBe('conflict');
    expect(
      decideExternalChange({
        fileMtime: 1000,
        diskMtime: 1,
        isDirty: true,
        inReview: false,
      }),
    ).toBe('conflict');
  });

  it('ingests silently into the ongoing review when pending chunks exist', () => {
    expect(
      decideExternalChange({
        fileMtime: 100,
        diskMtime: 200,
        isDirty: false,
        inReview: true,
      }),
    ).toBe('review');
    expect(
      decideExternalChange({
        fileMtime: 100,
        diskMtime: 200,
        isDirty: true,
        inReview: true,
      }),
    ).toBe('review');
  });
});

describe('resolveConflictChoice', () => {
  it('maps choice 0 to reload', () => {
    expect(resolveConflictChoice(0)).toBe('reload');
  });

  it('maps choice 1 to review', () => {
    expect(resolveConflictChoice(1)).toBe('review');
  });

  it('maps choice 2 to keep-and-override', () => {
    expect(resolveConflictChoice(2)).toBe('keep-and-override');
  });

  it('maps choice 3 to cancel', () => {
    expect(resolveConflictChoice(3)).toBe('cancel');
  });

  it('falls back to cancel for unexpected indices', () => {
    expect(resolveConflictChoice(-1)).toBe('cancel');
    expect(resolveConflictChoice(4)).toBe('cancel');
    expect(resolveConflictChoice(99)).toBe('cancel');
  });
});

describe('decideCloseDirty', () => {
  it('proceeds immediately when the tab is not dirty', () => {
    expect(decideCloseDirty({ isDirty: false, choice: 0 })).toBe('proceed');
    expect(decideCloseDirty({ isDirty: false, choice: 2 })).toBe('proceed');
  });

  it('saves when a dirty tab is closed with the save choice', () => {
    expect(decideCloseDirty({ isDirty: true, choice: 0 })).toBe('save');
  });

  it('discards when a dirty tab is closed with the discard choice', () => {
    expect(decideCloseDirty({ isDirty: true, choice: 1 })).toBe('discard');
  });

  it('cancels when a dirty tab is closed with the cancel choice', () => {
    expect(decideCloseDirty({ isDirty: true, choice: 2 })).toBe('cancel');
  });

  it('cancels on an unexpected choice for a dirty tab', () => {
    expect(decideCloseDirty({ isDirty: true, choice: -1 })).toBe('cancel');
    expect(decideCloseDirty({ isDirty: true, choice: 3 })).toBe('cancel');
  });
});
