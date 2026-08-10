import { describe, expect, it } from 'vitest';
import {
  computeCollapsibleIds,
  computeVisibleHeadings,
  resolveActiveId,
} from './outline-visibility';
import type { Heading } from './types';

function h(id: string, level: number): Heading {
  return { id, level, text: id, pos: 0 };
}

const sample: Heading[] = [h('a', 1), h('a1', 2), h('a1x', 3), h('a2', 2), h('b', 1), h('b1', 2)];

function ids(headings: Heading[]): string[] {
  return headings.map((h) => h.id);
}

describe('computeCollapsibleIds', () => {
  it('只有后跟更深层级标题的条目可折叠', () => {
    expect(computeCollapsibleIds(sample)).toEqual(new Set(['a', 'a1', 'b']));
  });

  it('空大纲返回空集合', () => {
    expect(computeCollapsibleIds([])).toEqual(new Set());
  });
});

describe('computeVisibleHeadings', () => {
  it('无折叠时全部可见', () => {
    expect(computeVisibleHeadings(sample, new Set())).toEqual(sample);
  });

  it('折叠父级隐藏其全部后代,不影响同级及后续章节', () => {
    const visible = computeVisibleHeadings(sample, new Set(['a']));
    expect(ids(visible)).toEqual(['a', 'b', 'b1']);
  });

  it('折叠中间层级只隐藏更深层级', () => {
    const visible = computeVisibleHeadings(sample, new Set(['a1']));
    expect(ids(visible)).toEqual(['a', 'a1', 'a2', 'b', 'b1']);
  });

  it('外层折叠时内层折叠状态不泄漏到外层之后', () => {
    const visible = computeVisibleHeadings(sample, new Set(['a', 'a2']));
    expect(ids(visible)).toEqual(['a', 'b', 'b1']);
  });
});

describe('resolveActiveId', () => {
  it('活跃标题可见时原样返回', () => {
    expect(resolveActiveId(sample, new Set(['a', 'a1', 'a1x']), 'a1x')).toBe('a1x');
  });

  it('活跃标题被折叠时回落到最近的可见祖先', () => {
    const visible = computeVisibleHeadings(sample, new Set(['a1']));
    expect(resolveActiveId(sample, new Set(ids(visible)), 'a1x')).toBe('a1');
  });

  it('多层折叠时回落到最外层可见祖先', () => {
    const visible = computeVisibleHeadings(sample, new Set(['a', 'a1']));
    expect(resolveActiveId(sample, new Set(ids(visible)), 'a1x')).toBe('a');
  });

  it('无活跃标题返回 null', () => {
    expect(resolveActiveId(sample, new Set(['a']), null)).toBeNull();
  });

  it('活跃标题不在大纲中返回 null', () => {
    expect(resolveActiveId(sample, new Set(['a']), 'missing')).toBeNull();
  });
});
