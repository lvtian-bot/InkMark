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
  // 同名标题会生成相同 slug，用作 React key 时会导致重复 key，
  // 引发列表渲染错乱（切窗回来后大纲出现重复/错位条目）。
  // 对重复 slug 追加序号保证 id 唯一。
  const slugCount = new Map<string, number>();
  d.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.attrs.level) {
      const base = slugify(node.textContent) || `heading-${pos}`;
      const n = slugCount.get(base) ?? 0;
      slugCount.set(base, n + 1);
      headings.push({
        id: n === 0 ? base : `${base}-${n}`,
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
