export interface TextMatch {
  from: number;
  to: number;
}

export function isValidTextMatch(match: TextMatch, documentSize: number): boolean {
  return match.from >= 0 && match.from < match.to && match.to <= documentSize;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
