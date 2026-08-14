import { describe, expect, it } from 'vitest';
import {
  findLiteralMatches,
  findMatchAtOrAfter,
  isValidTextMatch,
  stepMatchIndex,
} from './find-replace';

describe('findLiteralMatches', () => {
  it('returns nothing for an empty query', () => {
    expect(findLiteralMatches('some text', '')).toEqual([]);
  });

  it('matches case-insensitively and returns UTF-16 offsets', () => {
    expect(findLiteralMatches('Foo BAR foo', 'foo')).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
  });

  it('does not overlap matches', () => {
    expect(findLiteralMatches('aaa', 'aa')).toEqual([{ from: 0, to: 2 }]);
  });

  it('treats regex metacharacters in the query as literals', () => {
    // 'a.b' must match the literal "a.b", not "a*b"
    expect(findLiteralMatches('a.b a*b', 'a.b')).toEqual([{ from: 0, to: 3 }]);
  });

  it('handles non-ASCII (single-code-unit) characters', () => {
    expect(findLiteralMatches('café café', 'café')).toEqual([
      { from: 0, to: 4 },
      { from: 5, to: 9 },
    ]);
  });
});

describe('stepMatchIndex', () => {
  it('returns -1 when there are no matches', () => {
    expect(stepMatchIndex(0, -1, 1)).toBe(-1);
  });

  it('steps forward and wraps around', () => {
    expect(stepMatchIndex(3, 0, 1)).toBe(1);
    expect(stepMatchIndex(3, 2, 1)).toBe(0);
  });

  it('steps backward and wraps around', () => {
    expect(stepMatchIndex(3, 0, -1)).toBe(2);
    expect(stepMatchIndex(3, 2, -1)).toBe(1);
  });

  it('picks the first when stepping forward from nothing, last when backward', () => {
    expect(stepMatchIndex(3, -1, 1)).toBe(0);
    expect(stepMatchIndex(3, -1, -1)).toBe(2);
  });
});

describe('findMatchAtOrAfter', () => {
  const matches = [
    { from: 0, to: 2 },
    { from: 5, to: 7 },
  ];

  it('picks the first match at or after the anchor', () => {
    expect(findMatchAtOrAfter(matches, 0)).toBe(0);
    expect(findMatchAtOrAfter(matches, 3)).toBe(1);
  });

  it('wraps to the first match when the anchor is past the last', () => {
    expect(findMatchAtOrAfter(matches, 99)).toBe(0);
  });
});

describe('isValidTextMatch', () => {
  const size = 10;

  it('accepts a well-formed range within the document', () => {
    expect(isValidTextMatch({ from: 0, to: 3 }, size)).toBe(true);
    expect(isValidTextMatch({ from: 8, to: 10 }, size)).toBe(true); // to == size is allowed
  });

  it('rejects empty, reversed, negative or out-of-bounds ranges', () => {
    expect(isValidTextMatch({ from: 0, to: 0 }, size)).toBe(false);
    expect(isValidTextMatch({ from: 3, to: 1 }, size)).toBe(false);
    expect(isValidTextMatch({ from: -1, to: 3 }, size)).toBe(false);
    expect(isValidTextMatch({ from: 8, to: 12 }, size)).toBe(false);
  });
});
