import { unified } from 'unified';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import type { Definition, Image, ImageReference, Node, Nodes, Root } from 'mdast';

type Replacement = { start: number; end: number; value: string };

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, 'yaml');

function nodePosition(node: Node): { start: number; end: number } {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end < start) {
    throw new Error('Unable to locate Markdown image reference.');
  }
  return { start, end };
}

function isEscaped(text: string, offset: number): boolean {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && text[index] === '\\'; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function findClosingCodeSpan(
  markdown: string,
  start: number,
  end: number,
  runLength: number,
): number | null {
  for (let index = start; index < end; index += 1) {
    if (markdown[index] !== '`') continue;
    const runStart = index;
    while (markdown[index + 1] === '`') index += 1;
    const closingLength = index - runStart + 1;
    if (
      closingLength === runLength &&
      (runStart === start || markdown[runStart - 1] !== '`') &&
      (index + 1 >= end || markdown[index + 1] !== '`')
    ) {
      return runStart;
    }
  }
  return null;
}

function skipMarkdownContinuation(markdown: string, start: number, end: number): number {
  let index = start;
  let atLineStart = false;
  while (index < end) {
    const character = markdown[index];
    if (character === '\r' || character === '\n') {
      if (character === '\r' && markdown[index + 1] === '\n') index += 1;
      index += 1;
      atLineStart = true;
      continue;
    }
    if (atLineStart) {
      while (markdown[index] === ' ' || markdown[index] === '\t') index += 1;
      if (markdown[index] === '>') {
        index += 1;
        if (markdown[index] === ' ' || markdown[index] === '\t') index += 1;
        continue;
      }
      atLineStart = false;
    }
    if (/\s/.test(markdown[index] ?? '')) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function findImageDestination(
  markdown: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let index = start;
  if (markdown[index] !== '!' || markdown[index + 1] !== '[') {
    throw new Error('Unable to locate Markdown image destination.');
  }
  index += 2;
  let bracketDepth = 1;
  for (; index < end; index += 1) {
    const character = markdown[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '`') {
      const runStart = index;
      while (markdown[index + 1] === '`') index += 1;
      const runLength = index - runStart + 1;
      const closing = findClosingCodeSpan(markdown, index + 1, end, runLength);
      if (closing !== null) {
        index = closing + runLength - 1;
        continue;
      }
    }
    if (character === '[') bracketDepth += 1;
    if (character === ']') {
      bracketDepth -= 1;
      if (bracketDepth === 0) break;
    }
  }
  if (bracketDepth !== 0) throw new Error('Unable to locate Markdown image label.');
  index += 1;
  index = skipMarkdownContinuation(markdown, index, end);
  if (markdown[index] !== '(') throw new Error('Unable to locate Markdown image destination.');
  index += 1;
  index = skipMarkdownContinuation(markdown, index, end);
  if (markdown[index] === '<') {
    const valueStart = index + 1;
    index = valueStart;
    for (; index < end; index += 1) {
      if (markdown[index] === '>' && !isEscaped(markdown, index)) {
        return { start: valueStart, end: index };
      }
      if (markdown[index] === '\\') index += 1;
    }
    throw new Error('Unable to locate Markdown image destination.');
  }

  const valueStart = index;
  let parentheses = 0;
  for (; index < end; index += 1) {
    const character = markdown[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '(') {
      parentheses += 1;
      continue;
    }
    if (character === ')') {
      if (parentheses === 0) return { start: valueStart, end: index };
      parentheses -= 1;
      continue;
    }
    if (/\s/.test(character) && parentheses === 0) return { start: valueStart, end: index };
  }
  throw new Error('Unable to locate Markdown image destination.');
}

function findDefinitionDestination(
  markdown: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let index = start;
  while (/\s/.test(markdown[index] ?? '') && index < end) index += 1;
  if (markdown[index] !== '[') throw new Error('Unable to locate Markdown definition.');
  index += 1;
  let brackets = 1;
  for (; index < end; index += 1) {
    if (markdown[index] === '\\') {
      index += 1;
      continue;
    }
    if (markdown[index] === '[') brackets += 1;
    if (markdown[index] === ']') {
      brackets -= 1;
      if (brackets === 0) break;
    }
  }
  if (brackets !== 0) throw new Error('Unable to locate Markdown definition label.');
  index += 1;
  while (markdown[index] === ' ' || markdown[index] === '\t') index += 1;
  if (markdown[index] !== ':') throw new Error('Unable to locate Markdown definition.');
  index += 1;
  index = skipMarkdownContinuation(markdown, index, end);
  if (markdown[index] === '<') {
    const valueStart = index + 1;
    index = valueStart;
    for (; index < end; index += 1) {
      if (markdown[index] === '>' && !isEscaped(markdown, index))
        return { start: valueStart, end: index };
      if (markdown[index] === '\\') index += 1;
    }
    throw new Error('Unable to locate Markdown definition destination.');
  }
  const valueStart = index;
  for (; index < end; index += 1) {
    if (markdown[index] === '\\') {
      index += 1;
      continue;
    }
    if (/\s/.test(markdown[index])) return { start: valueStart, end: index };
  }
  return { start: valueStart, end };
}

function assertDestinationMatches(
  markdown: string,
  destination: { start: number; end: number },
  expected: string,
): void {
  const raw = markdown.slice(destination.start, destination.end);
  const isAngle = markdown[destination.start - 1] === '<';
  const probe = parser.parse(`![x](${isAngle ? `<${raw}>` : raw})`);
  const first = probe.children[0];
  if (!first || first.type !== 'paragraph') {
    throw new Error('Unable to validate Markdown image destination.');
  }
  const image = first.children.find((child): child is Image => child.type === 'image');
  if (!image || image.url !== expected) {
    throw new Error('Unable to validate Markdown image destination.');
  }
}

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ('children' in node) {
    for (const child of node.children) walk(child, visit);
  }
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 只改写解析确认的 Markdown 图片 URL 区间，其他原文保持不变，包括换行和 YAML。
 */
export function rewriteMarkdownImageSources(
  markdown: string,
  replaceSource: (source: string) => string,
): string {
  const tree: Root = parser.parse(markdown);
  const definitions = new Map<string, Definition>();
  const imageReferences: ImageReference[] = [];
  const images: Image[] = [];

  walk(tree, (node) => {
    if (node.type === 'definition' && typeof node.identifier === 'string') {
      const key = normalizeIdentifier(node.identifier);
      if (!definitions.has(key)) definitions.set(key, node);
    } else if (node.type === 'imageReference') {
      imageReferences.push(node);
    } else if (node.type === 'image') {
      images.push(node);
    }
  });

  const replacements: Replacement[] = [];
  const addReplacement = (
    node: Image | Definition,
    destination: { start: number; end: number },
  ): void => {
    assertDestinationMatches(markdown, destination, node.url);
    const replacement = replaceSource(node.url);
    if (replacement === node.url) return;
    if (
      destination.start < 0 ||
      destination.end < destination.start ||
      destination.end > markdown.length
    ) {
      throw new Error('Unable to locate Markdown image destination.');
    }
    replacements.push({ ...destination, value: replacement });
  };

  for (const image of images) {
    const position = nodePosition(image);
    addReplacement(image, findImageDestination(markdown, position.start, position.end));
  }

  const usedDefinitions = new Set<string>();
  for (const reference of imageReferences) {
    if (typeof reference.identifier !== 'string') continue;
    const key = normalizeIdentifier(reference.identifier);
    if (usedDefinitions.has(key)) continue;
    const definition = definitions.get(key);
    if (!definition) continue;
    usedDefinitions.add(key);
    const position = nodePosition(definition);
    addReplacement(definition, findDefinitionDestination(markdown, position.start, position.end));
  }

  replacements.sort((left, right) => right.start - left.start);
  let result = markdown;
  for (const replacement of replacements) {
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  }
  return result;
}
