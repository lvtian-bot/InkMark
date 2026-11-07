import { describe, expect, it } from 'vitest';
import {
  findLiteralMatches,
  findTextMatches,
  expandReplacement,
  findMatchAtOrAfter,
  isValidTextMatch,
  stepMatchIndex,
} from './find-replace';

describe('精确查找与正则替换', () => {
  const defaults = { caseSensitive: false, wholeWord: false, regex: false };

  it('可以区分大小写，普通模式将特殊字符视为原文', () => {
    expect(
      findTextMatches('Foo foo f.o fxo', 'foo', { ...defaults, caseSensitive: true }).matches,
    ).toEqual([{ from: 4, to: 7 }]);
    expect(findTextMatches('f.o fxo', 'f.o', defaults).matches).toEqual([{ from: 0, to: 3 }]);
  });

  it('全字匹配考虑中英文及其他 Unicode 字符', () => {
    expect(
      findTextMatches('app apple app 中文 中文字', 'app', { ...defaults, wholeWord: true }).matches,
    ).toEqual([
      { from: 0, to: 3 },
      { from: 10, to: 13 },
    ]);
    expect(
      findTextMatches('中文 中文字', '中文', { ...defaults, wholeWord: true }).matches,
    ).toEqual([{ from: 0, to: 2 }]);
  });

  it('全字边界拒绝候选后，仍可找到与它重叠的合法结果', () => {
    const text = 'xa-a-a ';
    const options = { ...defaults, wholeWord: true };
    expect(findTextMatches(text, 'a-a', options).matches).toEqual([{ from: 3, to: 6 }]);
    expect(
      findTextMatches(text, 'a-a', { ...options, regex: true }).matches.map(({ from, to }) => ({
        from,
        to,
      })),
    ).toEqual([{ from: 3, to: 6 }]);
  });

  it('正则无效时报告错误', () => {
    expect(findTextMatches('abc', '[', { ...defaults, regex: true })).toEqual({
      matches: [],
      invalidPattern: true,
    });
  });

  it('零宽匹配可定位和替换，并按 Unicode 码点前进避免无限循环', () => {
    const matches = findTextMatches('a😀b', '(?=(.))|$', { ...defaults, regex: true }).matches;
    expect(matches.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 0, to: 0 },
      { from: 1, to: 1 },
      { from: 3, to: 3 },
      { from: 4, to: 4 },
    ]);
    expect(expandReplacement(matches[1], '<$1>')).toBe('<😀>');
    expect(expandReplacement(matches[3], '<$1>')).toBe('<>');
  });

  it('正则行首行尾匹配每一行，原文模式仍按字面匹配', () => {
    const text = 'Foo\nfoo\nbar';
    const opts = { ...defaults, regex: true };
    expect(
      findTextMatches(text, '^foo$', opts).matches.map(({ from, to }) => ({ from, to })),
    ).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
    ]);
    expect(
      findTextMatches(text, '^foo$', { ...opts, caseSensitive: true }).matches.map(
        ({ from, to }) => ({ from, to }),
      ),
    ).toEqual([{ from: 4, to: 7 }]);
    expect(findTextMatches('^foo$\nfoo', '^foo$', defaults).matches).toEqual([{ from: 0, to: 5 }]);
  });

  it('限定范围内的正则匹配保留原文上下文，并跳过跨界结果', () => {
    const options = { ...defaults, regex: true };
    const range = { from: 1, to: 4 };
    const { matches } = findTextMatches('xabc!', '(?<=x)abc!|(?<=a)bc(?=!)', options, range);
    expect(matches.map(({ from, to }) => ({ from, to }))).toEqual([{ from: 2, to: 4 }]);
    expect(findTextMatches('xabc!', '^abc$', options, range).matches).toEqual([]);
  });

  it('正则替换支持捕获组、命名捕获组及美元符号', () => {
    const [match] = findTextMatches('A 2026-11 B', '(?<year>\\d+)-(\\d+)', {
      ...defaults,
      regex: true,
    }).matches;
    expect(expandReplacement(match, '$2/$<year> $$ $&')).toBe('11/2026 $ 2026-11');
    expect(expandReplacement(match, '$1 $3 $12')).toBe('2026 $3 20262');
    expect(expandReplacement({ from: 0, to: 1 }, '$1')).toBe('$1');
  });
});

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

  it('accepts zero-width matches including at the document end', () => {
    expect(isValidTextMatch({ from: 0, to: 0 }, size)).toBe(true);
    expect(isValidTextMatch({ from: 10, to: 10 }, size)).toBe(true);
  });

  it('rejects reversed, negative or out-of-bounds ranges', () => {
    expect(isValidTextMatch({ from: 3, to: 1 }, size)).toBe(false);
    expect(isValidTextMatch({ from: -1, to: 3 }, size)).toBe(false);
    expect(isValidTextMatch({ from: 8, to: 12 }, size)).toBe(false);
  });
});
