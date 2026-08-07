import { useCallback } from 'react';
import { useStore } from '../stores/useStore';
import type { Heading } from '../types';

interface DocLike {
  descendants: (
    fn: (
      node: { type: { name: string }; attrs: { level?: number }; textContent: string },
      pos: number,
    ) => boolean,
  ) => void;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function extractHeadings(doc: unknown): Heading[] {
  const headings: Heading[] = [];
  const d = doc as DocLike;
  if (!d || typeof d.descendants !== 'function') return headings;
  d.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.attrs.level) {
      headings.push({
        id: slugify(node.textContent) || `heading-${pos}`,
        level: node.attrs.level,
        text: node.textContent,
        pos,
      });
    }
    return true;
  });
  return headings;
}

export function useOutline() {
  const setOutline = useStore((s) => s.setOutline);
  const outline = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.outline ?? []);

  const updateOutline = useCallback(
    (doc: unknown) => {
      const headings = extractHeadings(doc);
      setOutline(headings);
    },
    [setOutline],
  );

  return { outline, updateOutline };
}
