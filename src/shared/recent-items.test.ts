import { describe, expect, it } from 'vitest';
import {
  addOrUpdateRecent,
  normalizeRecentItems,
  removeRecent,
  type RecentItem,
} from './recent-items';

describe('recent-items normalizeRecentItems', () => {
  it('parses new object format with path and kind', () => {
    const data = [
      { path: '/a/b.md', kind: 'file' },
      { path: '/a/docs', kind: 'folder' },
    ];
    expect(normalizeRecentItems(data)).toEqual([
      { path: '/a/b.md', kind: 'file' },
      { path: '/a/docs', kind: 'folder' },
    ]);
  });

  it('treats legacy plain string entries as files', () => {
    const data = ['/old/a.md', '/old/notes.md'];
    expect(normalizeRecentItems(data)).toEqual([
      { path: '/old/a.md', kind: 'file' },
      { path: '/old/notes.md', kind: 'file' },
    ]);
  });

  it('mixes legacy strings and new objects', () => {
    const data = ['/legacy.md', { path: '/dir', kind: 'folder' }];
    expect(normalizeRecentItems(data)).toEqual([
      { path: '/legacy.md', kind: 'file' },
      { path: '/dir', kind: 'folder' },
    ]);
  });

  it('drops malformed entries and defaults invalid kind to file', () => {
    const data = [{ path: '/ok.md', kind: 'weird' }, { noPath: true }, null, 42, { path: 123 }];
    expect(normalizeRecentItems(data)).toEqual([{ path: '/ok.md', kind: 'file' }]);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizeRecentItems(null)).toEqual([]);
    expect(normalizeRecentItems({})).toEqual([]);
    expect(normalizeRecentItems('x')).toEqual([]);
  });
});

describe('recent-items addOrUpdateRecent', () => {
  it('prepends a new item', () => {
    const items: RecentItem[] = [{ path: '/a.md', kind: 'file' }];
    expect(addOrUpdateRecent(items, '/b.md', 'file', 10)).toEqual([
      { path: '/b.md', kind: 'file' },
      { path: '/a.md', kind: 'file' },
    ]);
  });

  it('moves an existing path to top and updates its kind', () => {
    const items: RecentItem[] = [
      { path: '/a.md', kind: 'file' },
      { path: '/docs', kind: 'folder' },
    ];
    expect(addOrUpdateRecent(items, '/docs', 'folder', 10)).toEqual([
      { path: '/docs', kind: 'folder' },
      { path: '/a.md', kind: 'file' },
    ]);
  });

  it('returns same reference when item already at top with matching kind', () => {
    const items: RecentItem[] = [
      { path: '/a.md', kind: 'file' },
      { path: '/b.md', kind: 'file' },
    ];
    expect(addOrUpdateRecent(items, '/a.md', 'file', 10)).toBe(items);
  });

  it('truncates to maxItems', () => {
    const items: RecentItem[] = [
      { path: '/1.md', kind: 'file' },
      { path: '/2.md', kind: 'file' },
      { path: '/3.md', kind: 'file' },
    ];
    expect(addOrUpdateRecent(items, '/new.md', 'file', 3)).toEqual([
      { path: '/new.md', kind: 'file' },
      { path: '/1.md', kind: 'file' },
      { path: '/2.md', kind: 'file' },
    ]);
  });

  it('dedupes by path regardless of kind', () => {
    const items: RecentItem[] = [{ path: '/x', kind: 'file' }];
    expect(addOrUpdateRecent(items, '/x', 'folder', 10)).toEqual([{ path: '/x', kind: 'folder' }]);
  });
});

describe('recent-items removeRecent', () => {
  it('removes the matching path', () => {
    const items: RecentItem[] = [
      { path: '/a.md', kind: 'file' },
      { path: '/docs', kind: 'folder' },
    ];
    expect(removeRecent(items, '/a.md')).toEqual([{ path: '/docs', kind: 'folder' }]);
  });

  it('returns equivalent array when path absent', () => {
    const items: RecentItem[] = [{ path: '/a.md', kind: 'file' }];
    expect(removeRecent(items, '/missing.md')).toEqual([{ path: '/a.md', kind: 'file' }]);
  });
});
