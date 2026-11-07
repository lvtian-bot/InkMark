import { unified } from 'unified';
import { parse, postprocess, preprocess } from 'micromark';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import type { Definition, Image, ImageReference, Nodes } from 'mdast';

type Token = ReturnType<typeof postprocess>[number][1];
type Destination = { start: number; end: number; nodeEnd: number };
type Replacement = { start: number; end: number; value: string };

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, 'yaml');

/** 使用与 remark 相同的语法扩展取原文坐标，不再重复实现内联 Markdown 语法。 */
function imageDestinations(markdown: string): Map<number, Destination> {
  const events = postprocess(
    parse({ extensions: parser.data('micromarkExtensions') })
      .document()
      .write(preprocess()(markdown, 'utf8', true)),
  );
  const owners: Token[] = [];
  const destinations = new Map<number, Destination>();
  for (const [phase, token] of events) {
    if (token.type === 'image' || token.type === 'link' || token.type === 'definition') {
      if (phase === 'enter') owners.push(token);
      else owners.pop();
      continue;
    }
    if (phase !== 'enter') continue;
    const owner = owners.at(-1);
    if (
      (owner?.type === 'image' && token.type === 'resourceDestinationString') ||
      (owner?.type === 'definition' && token.type === 'definitionDestinationString')
    ) {
      destinations.set(owner.start.offset, {
        start: token.start.offset,
        end: token.end.offset,
        nodeEnd: owner.end.offset,
      });
    }
  }
  return destinations;
}

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ('children' in node) {
    for (const child of node.children) walk(child, visit);
  }
}

/** 只改写图片 URL 区间；保留其他原文，包括换行、标题、YAML 和代码示例。 */
export function rewriteMarkdownImageSources(
  markdown: string,
  replaceSource: (source: string) => string,
): string {
  const tree = parser.parse(markdown);
  const definitions = new Map<string, Definition>();
  const images: Image[] = [];
  const imageReferences: ImageReference[] = [];
  walk(tree, (node) => {
    if (node.type === 'definition') {
      if (!definitions.has(node.identifier)) definitions.set(node.identifier, node);
    } else if (node.type === 'image') {
      images.push(node);
    } else if (node.type === 'imageReference') {
      imageReferences.push(node);
    }
  });

  const replacements: Replacement[] = [];
  let destinations: Map<number, Destination> | undefined;
  const addReplacement = (node: Image | Definition): void => {
    const value = replaceSource(node.url);
    if (value === node.url) return;
    destinations ??= imageDestinations(markdown);
    const nodeStart = node.position?.start.offset;
    const nodeEnd = node.position?.end.offset;
    const destination = nodeStart === undefined ? undefined : destinations.get(nodeStart);
    if (
      !destination ||
      nodeStart === undefined ||
      destination.nodeEnd !== nodeEnd ||
      destination.start < nodeStart ||
      destination.end < destination.start ||
      destination.end > destination.nodeEnd
    ) {
      throw new Error('Unable to locate Markdown image destination.');
    }
    replacements.push({ start: destination.start, end: destination.end, value });
  };
  for (const image of images) addReplacement(image);
  const usedDefinitions = new Set<string>();
  for (const reference of imageReferences) {
    if (usedDefinitions.has(reference.identifier)) continue;
    const definition = definitions.get(reference.identifier);
    if (!definition) continue;
    usedDefinitions.add(reference.identifier);
    addReplacement(definition);
  }

  replacements.sort((left, right) => right.start - left.start);
  let result = markdown;
  for (const replacement of replacements) {
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  }
  return result;
}
