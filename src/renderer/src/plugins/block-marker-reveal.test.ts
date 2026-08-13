import { describe, it, expect } from 'vitest';
import {
  headingMarker,
  unorderedListItemMarker,
  orderedListItemMarker,
  isAtHeadingTextStart,
} from './block-marker-reveal';

describe('headingMarker', () => {
  it('level 个 # 加空格', () => {
    expect(headingMarker(1)).toBe('# ');
    expect(headingMarker(2)).toBe('## ');
    expect(headingMarker(6)).toBe('###### ');
  });

  it('level 钳制到 1..6', () => {
    expect(headingMarker(0)).toBe('# ');
    expect(headingMarker(-3)).toBe('# ');
    expect(headingMarker(7)).toBe('###### ');
    expect(headingMarker(99)).toBe('###### ');
  });
});

describe('unorderedListItemMarker', () => {
  it('bullet + 空格', () => {
    expect(unorderedListItemMarker('-')).toBe('- ');
    expect(unorderedListItemMarker('*')).toBe('* ');
    expect(unorderedListItemMarker('+')).toBe('+ ');
  });
});

describe('orderedListItemMarker', () => {
  it('按 start + itemIndex 计数，标点紧跟', () => {
    expect(orderedListItemMarker(1, '.', 0)).toBe('1. ');
    expect(orderedListItemMarker(1, '.', 2)).toBe('3. ');
    expect(orderedListItemMarker(3, '.', 0)).toBe('3. ');
    expect(orderedListItemMarker(1, ')', 0)).toBe('1) ');
    expect(orderedListItemMarker(1, ')', 4)).toBe('5) ');
  });
});

describe('isAtHeadingTextStart', () => {
  it('parentOffset=0 且父为 heading 才为真', () => {
    expect(isAtHeadingTextStart({ parentOffset: 0, parentTypeName: 'heading' })).toBe(true);
  });

  it('非 heading 或非起始为假', () => {
    expect(isAtHeadingTextStart({ parentOffset: 1, parentTypeName: 'heading' })).toBe(false);
    expect(isAtHeadingTextStart({ parentOffset: 0, parentTypeName: 'paragraph' })).toBe(false);
    expect(isAtHeadingTextStart({ parentOffset: 0, parentTypeName: 'list_item' })).toBe(false);
  });
});
