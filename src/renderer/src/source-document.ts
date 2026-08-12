import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { Heading } from './types';

interface Range {
  from: number;
  to: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter((range) => range.to > range.from).sort((a, b) => a.from - b.from);
  const merged: Range[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** 识别文档开头的 YAML frontmatter 区间(`---` 包裹块),没有则返回 null。 */
function findFrontmatterRange(doc: string): Range | null {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(doc);
  if (!match) return null;
  return { from: 0, to: match[0].length };
}

export function extractSourceText(state: EditorState): string {
  const doc = state.doc.toString();
  const excluded: Range[] = [];
  // frontmatter(YAML 元信息块)不计入正文字数。
  const frontmatter = findFrontmatterRange(doc);
  if (frontmatter) excluded.push(frontmatter);
  const cursor = syntaxTree(state).cursor();

  const visit = (): void => {
    const { name, from, to } = cursor;
    const parentName = cursor.node.parent?.name;
    const source = doc.slice(from, to);
    if (
      name === 'HeaderMark' ||
      name === 'QuoteMark' ||
      name === 'ListMark' ||
      name === 'EmphasisMark' ||
      name === 'CodeMark' ||
      name === 'CodeInfo' ||
      name === 'LinkMark' ||
      (name === 'URL' && (parentName === 'Link' || parentName === 'Image')) ||
      (name === 'Link' && /^\[[ xX]\]$/.test(source))
    ) {
      excluded.push({ from, to });
    }
    if (cursor.firstChild()) {
      do visit();
      while (cursor.nextSibling());
      cursor.parent();
    }
  };

  visit();
  let result = '';
  let offset = 0;
  for (const range of mergeRanges(excluded)) {
    result += doc.slice(offset, range.from);
    offset = range.to;
  }
  return result + doc.slice(offset);
}

export function extractSourceHeadings(state: EditorState): Heading[] {
  const doc = state.doc.toString();
  // frontmatter 结尾的 `---` 可能被 lezer 当成 setext 标题下划线,产生假标题;
  // 跳过文档开头 frontmatter 区间内的所有标题命中。
  const frontmatterEnd = findFrontmatterRange(doc)?.to ?? 0;
  const headings: Heading[] = [];
  const slugCount = new Map<string, number>();
  const cursor = syntaxTree(state).cursor();

  const visit = (): void => {
    const match = /^(?:ATXHeading|SetextHeading)([1-6])$/.exec(cursor.name);
    if (match && cursor.from >= frontmatterEnd) {
      const level = Number(match[1]);
      const source = doc.slice(cursor.from, cursor.to);
      const text = cursor.name.startsWith('ATX')
        ? source
            .replace(/^#{1,6}[\t ]*/, '')
            .replace(/[\t ]+#+[\t ]*$/, '')
            .trim()
        : (source.split(/\r?\n/, 1)[0] ?? '').trim();
      const base = slugify(text) || `heading-${cursor.from}`;
      const duplicateIndex = slugCount.get(base) ?? 0;
      slugCount.set(base, duplicateIndex + 1);
      headings.push({
        id: duplicateIndex === 0 ? base : `${base}-${duplicateIndex}`,
        level,
        text,
        pos: cursor.from,
      });
    }

    if (cursor.firstChild()) {
      do visit();
      while (cursor.nextSibling());
      cursor.parent();
    }
  };

  visit();

  return headings;
}
