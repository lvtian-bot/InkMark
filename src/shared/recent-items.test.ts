import { describe, expect, it } from 'vitest';
import {
  addOrUpdateRecent,
  normalizeRecentItems,
  removeRecent,
  type RecentItem,
} from './recent-items';

describe('recent-items normalizeRecentItems', () => {
  it('parses new object format with path and kind (folders placed on top)', () => {
    const data = [
      { path: '/a/b.md', kind: 'file' },
      { path: '/a/docs', kind: 'folder' },
    ];
    expect(normalizeRecentItems(data)).toEqual([
      { path: '/a/docs', kind: 'folder' },
      { path: '/a/b.md', kind: 'file' },
    ]);
  });

  it('treats legacy plain string entries as files', () => {
    const data = ['/old/a.md', '/old/notes.md'];
    expect(normalizeRecentItems(data)).toEqual([
      { path: '/old/a.md', kind: 'file' },
      { path: '/old/notes.md', kind: 'file' },
    ]);
  });

  it('mixes legacy strings and new objects (folders on top)', () => {
    const data = ['/legacy.md', { path: '/dir', kind: 'folder' }];
    expect(normalizeRecentItems(data)).toEqual([
      { path: '/dir', kind: 'folder' },
      { path: '/legacy.md', kind: 'file' },
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

  it('places folders at the top and files below', () => {
    const items: RecentItem[] = [
      { path: '/docs', kind: 'folder' },
      { path: '/a.md', kind: 'file' },
    ];
    expect(addOrUpdateRecent(items, '/b.md', 'file', 10)).toEqual([
      { path: '/docs', kind: 'folder' },
      { path: '/b.md', kind: 'file' },
      { path: '/a.md', kind: 'file' },
    ]);
  });

  it('moves an existing path to top of its kind section and updates kind', () => {
    const items: RecentItem[] = [
      { path: '/docs', kind: 'folder' },
      { path: '/a.md', kind: 'file' },
    ];
    expect(addOrUpdateRecent(items, '/docs', 'folder', 10)).toBe(items);

    expect(addOrUpdateRecent(items, '/new-folder', 'folder', 10)).toEqual([
      { path: '/new-folder', kind: 'folder' },
      { path: '/docs', kind: 'folder' },
      { path: '/a.md', kind: 'file' },
    ]);
  });

  it('returns same reference when item already at top of section with matching kind', () => {
    const items: RecentItem[] = [
      { path: '/a.md', kind: 'file' },
      { path: '/b.md', kind: 'file' },
    ];
    expect(addOrUpdateRecent(items, '/a.md', 'file', 10)).toBe(items);
  });

  it('truncates files and folders independently', () => {
    const items: RecentItem[] = [
      { path: '/f1', kind: 'folder' },
      { path: '/1.md', kind: 'file' },
      { path: '/2.md', kind: 'file' },
      { path: '/3.md', kind: 'file' },
    ];
    expect(addOrUpdateRecent(items, '/new.md', 'file', { maxFiles: 3, maxFolders: 3 })).toEqual([
      { path: '/f1', kind: 'folder' },
      { path: '/new.md', kind: 'file' },
      { path: '/1.md', kind: 'file' },
      { path: '/2.md', kind: 'file' },
    ]);
  });

  it('dedupes by path regardless of kind', () => {
    const items: RecentItem[] = [{ path: '/x', kind: 'file' }];
    expect(addOrUpdateRecent(items, '/x', 'folder', 10)).toEqual([{ path: '/x', kind: 'folder' }]);
  });

  it('keeps folders intact at the top when many files are opened (independent quota)', () => {
    let items: RecentItem[] = [
      { path: '/projA', kind: 'folder' },
      { path: '/projB', kind: 'folder' },
    ];
    // Open 12 files sequentially with limit of 10 files and 3 folders
    for (let i = 1; i <= 12; i++) {
      items = addOrUpdateRecent(items, `/doc${i}.md`, 'file', { maxFiles: 10, maxFolders: 3 });
    }
    // Folders stay on top, latest 10 files follow
    expect(items).toHaveLength(12);
    expect(items[0]).toEqual({ path: '/projA', kind: 'folder' });
    expect(items[1]).toEqual({ path: '/projB', kind: 'folder' });
    expect(items[2]).toEqual({ path: '/doc12.md', kind: 'file' });
    expect(items[11]).toEqual({ path: '/doc3.md', kind: 'file' });
  });

  it('caps folders at default 3 and keeps files intact below', () => {
    let items: RecentItem[] = [
      { path: '/file1.md', kind: 'file' },
      { path: '/file2.md', kind: 'file' },
    ];
    // Open 5 folders sequentially with default limit (3 folders, 10 files)
    for (let i = 1; i <= 5; i++) {
      items = addOrUpdateRecent(items, `/folder${i}`, 'folder');
    }
    const folderItems = items.filter((it) => it.kind === 'folder');
    const fileItems = items.filter((it) => it.kind === 'file');
    expect(folderItems).toHaveLength(3);
    expect(folderItems.map((f) => f.path)).toEqual(['/folder5', '/folder4', '/folder3']);
    expect(fileItems).toEqual([
      { path: '/file1.md', kind: 'file' },
      { path: '/file2.md', kind: 'file' },
    ]);
    // Folders are at indices 0, 1, 2; files are at 3, 4
    expect(items[0].path).toBe('/folder5');
    expect(items[3].path).toBe('/file1.md');
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
