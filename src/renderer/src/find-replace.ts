export interface TextMatch {
  from: number;
  to: number;
  regexMatch?: {
    text: string;
    captures: (string | undefined)[];
    groups?: Record<string, string | undefined>;
    input: string;
    index: number;
  };
}

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface FindResult {
  matches: TextMatch[];
  invalidPattern: boolean;
}

export function isValidTextMatch(match: TextMatch, documentSize: number): boolean {
  return match.from >= 0 && match.from <= match.to && match.to <= documentSize;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const wordCharacter = /[\p{L}\p{N}\p{M}_]/u.source;

export function findTextMatches(
  text: string,
  query: string,
  options: FindOptions,
  range: { from: number; to: number } = { from: 0, to: text.length },
): FindResult {
  if (!query) return { matches: [], invalidPattern: false };
  let pattern: RegExp;
  try {
    pattern = new RegExp(
      options.regex ? query : escapeRegExp(query),
      `gu${options.caseSensitive ? '' : 'i'}${options.regex ? 'm' : ''}`,
    );
    if (options.wholeWord) {
      // 先验证原表达式，再加断言，避免包装意外修补无效语法。
      // 左边界在匹配正文之前检查，避免在单词内部反复扫描同一后缀。
      pattern = new RegExp(
        `(?<!${wordCharacter})(?:${pattern.source})(?!${wordCharacter})`,
        pattern.flags,
      );
    }
  } catch {
    return { matches: [], invalidPattern: true };
  }
  const matches: TextMatch[] = [];
  // 从范围起点开始搜索，但保留原文供锚点、断言和全字边界判断。
  pattern.lastIndex = range.from;
  while (true) {
    const match = pattern.exec(text);
    if (!match) break;
    const from = match.index;
    const to = from + match[0].length;
    if (from > range.to) break;
    const accepted = from >= range.from && to <= range.to;
    // 被选区边界拒绝的候选不能跳过它内部可能合法的匹配。
    // 空匹配也必须主动前进，否则 RegExp.exec 会反复返回同一位置。
    if (!accepted || from === to) {
      if (from === text.length && !accepted) break;
      const point = text.codePointAt(from);
      pattern.lastIndex = from + (point !== undefined && point > 0xffff ? 2 : 1);
    }
    if (!accepted) continue;
    const result: TextMatch = { from, to };
    if (options.regex) {
      result.regexMatch = {
        text: match[0],
        captures: match.slice(1),
        groups: match.groups,
        input: text,
        index: from,
      };
    }
    matches.push(result);
    if (from === text.length && from === to) break;
  }
  return { matches, invalidPattern: false };
}

/** 与 JavaScript 字符串替换的捕获组引用规则一致。 */
export function expandReplacement(match: TextMatch, replacement: string): string {
  const details = match.regexMatch;
  if (!details) return replacement;
  return replacement.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]*>)/g, (token, reference: string) => {
    if (reference === '$') return '$';
    if (reference === '&') return details.text;
    if (reference === '`') return details.input.slice(0, details.index);
    if (reference === "'") return details.input.slice(details.index + details.text.length);
    if (reference.startsWith('<')) {
      if (!details.groups) return token;
      return details.groups[reference.slice(1, -1)] ?? '';
    }
    let index = Number(reference);
    let suffix = '';
    if (index > details.captures.length && reference.length === 2) {
      index = Number(reference[0]);
      suffix = reference[1];
    }
    if (index === 0 || index > details.captures.length) return token;
    return (details.captures[index - 1] ?? '') + suffix;
  });
}

/**
 * 按用户输入的原文进行不区分大小写的非重叠查找。
 * 返回值使用 UTF-16 偏移，与 textarea 和 ProseMirror 的位置单位一致。
 */
export function findLiteralMatches(text: string, query: string): TextMatch[] {
  if (!query) return [];

  const matches: TextMatch[] = [];
  const pattern = new RegExp(escapeRegExp(query), 'giu');

  for (const match of text.matchAll(pattern)) {
    const from = match.index;
    matches.push({ from, to: from + match[0].length });
  }

  return matches;
}

export function findMatchAtOrAfter(matches: readonly TextMatch[], anchor: number): number {
  const index = matches.findIndex((match) => match.from >= anchor);
  return index === -1 ? 0 : index;
}

export function stepMatchIndex(matchCount: number, activeIndex: number, direction: 1 | -1): number {
  if (matchCount === 0) return -1;
  if (activeIndex < 0) return direction === 1 ? 0 : matchCount - 1;
  return (activeIndex + direction + matchCount) % matchCount;
}
