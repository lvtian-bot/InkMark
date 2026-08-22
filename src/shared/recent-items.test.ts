import { describe, expect, it } from 'vitest';
import {
  addOrUpdateRecent,
  normalizeRecentItems,
  removeRecent,
  toggleRecentStar,
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

  it('sorts starred folders, starred files, folders and files into fixed sections', () => {
    const data = [
      { path: '/normal.md', kind: 'file' },
      { path: '/starred.md', kind: 'file', starred: true },
      { path: '/docs', kind: 'folder' },
      { path: '/star-dir', kind: 'folder', starred: true },
    ];
    expect(normalizeRecentItems(data)).toEqual([
      { path: '/star-dir', kind: 'folder', starred: true },
      { path: '/starred.md', kind: 'file', starred: true },
      { path: '/docs', kind: 'folder' },
      { path: '/normal.md', kind: 'file' },
    ]);
  });

  it('keeps starred flag on folders and ignores non-boolean starred values', () => {
    expect(normalizeRecentItems([{ path: '/docs', kind: 'folder', starred: true }])).toEqual([
      { path: '/docs', kind: 'folder', starred: true },
    ]);
    expect(normalizeRecentItems([{ path: '/a.md', kind: 'file', starred: 'yes' }])).toEqual([
      { path: '/a.md', kind: 'file' },
    ]);
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
    // Open 5 folders sequentially with default limit (3 folders, 7 files)
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
    // Folders are at indices 0, 1, 2; files are at indices 3, 4
    expect(items[0].path).toBe('/folder5');
    expect(items[3].path).toBe('/file1.md');
  });

  it('keeps starred flag when a starred file is reopened', () => {
    const items: RecentItem[] = [
      { path: '/docs', kind: 'folder' },
      { path: '/star.md', kind: 'file', starred: true },
      { path: '/new-star.md', kind: 'file', starred: true },
      { path: '/a.md', kind: 'file' },
    ];
    expect(addOrUpdateRecent(items, '/star.md', 'file', 10)).toEqual([
      { path: '/star.md', kind: 'file', starred: true },
      { path: '/new-star.md', kind: 'file', starred: true },
      { path: '/docs', kind: 'folder' },
      { path: '/a.md', kind: 'file' },
    ]);
  });

  it('returns same reference when starred file already at head of starred section', () => {
    const items: RecentItem[] = [{ path: '/star.md', kind: 'file', starred: true }];
    expect(addOrUpdateRecent(items, '/star.md', 'file', 10)).toBe(items);
  });

  it('exempts starred files from the normal file quota', () => {
    let items: RecentItem[] = [{ path: '/star.md', kind: 'file', starred: true }];
    for (let i = 1; i <= 12; i++) {
      items = addOrUpdateRecent(items, `/doc${i}.md`, 'file', 10);
    }
    expect(items[0]).toEqual({ path: '/star.md', kind: 'file', starred: true });
    // 普通文件仍按 10 条上限淘汰最旧的 doc1/doc2,加星文件不计入配额
    expect(items).toHaveLength(11);
    expect(items.filter((it) => it.starred !== true).map((it) => it.path)).toEqual([
      '/doc12.md',
      '/doc11.md',
      '/doc10.md',
      '/doc9.md',
      '/doc8.md',
      '/doc7.md',
      '/doc6.md',
      '/doc5.md',
      '/doc4.md',
      '/doc3.md',
    ]);
  });

  it('keeps starred flag when a starred folder is reopened and exempts it from folder quota', () => {
    let items: RecentItem[] = [{ path: '/star-dir', kind: 'folder', starred: true }];
    for (let i = 1; i <= 5; i++) {
      items = addOrUpdateRecent(items, `/folder${i}`, 'folder', { maxFiles: 10, maxFolders: 3 });
    }
    expect(items[0]).toEqual({ path: '/star-dir', kind: 'folder', starred: true });
    expect(
      items.filter((it) => it.kind === 'folder' && it.starred !== true).map((it) => it.path),
    ).toEqual(['/folder5', '/folder4', '/folder3']);
  });

  it('carries starred flag when the same path is reopened as the other kind', () => {
    const items: RecentItem[] = [{ path: '/x', kind: 'file', starred: true }];
    expect(addOrUpdateRecent(items, '/x', 'folder', 10)).toEqual([
      { path: '/x', kind: 'folder', starred: true },
    ]);
  });
});

describe('recent-items toggleRecentStar', () => {
  it('stars a normal file and moves it to the starred section on top', () => {
    const items: RecentItem[] = [
      { path: '/docs', kind: 'folder' },
      { path: '/other-star.md', kind: 'file', starred: true },
      { path: '/a.md', kind: 'file' },
      { path: '/b.md', kind: 'file' },
    ];
    expect(toggleRecentStar(items, '/b.md')).toEqual([
      { path: '/b.md', kind: 'file', starred: true },
      { path: '/other-star.md', kind: 'file', starred: true },
      { path: '/docs', kind: 'folder' },
      { path: '/a.md', kind: 'file' },
    ]);
  });

  it('stars a folder and moves it above everything', () => {
    const items: RecentItem[] = [
      { path: '/docs', kind: 'folder' },
      { path: '/star.md', kind: 'file', starred: true },
      { path: '/a.md', kind: 'file' },
    ];
    expect(toggleRecentStar(items, '/docs')).toEqual([
      { path: '/docs', kind: 'folder', starred: true },
      { path: '/star.md', kind: 'file', starred: true },
      { path: '/a.md', kind: 'file' },
    ]);
  });

  it('unstars a file back to the head of normal files without trimming quota', () => {
    const items: RecentItem[] = [
      { path: '/docs', kind: 'folder' },
      { path: '/star.md', kind: 'file', starred: true },
      { path: '/a.md', kind: 'file' },
    ];
    expect(toggleRecentStar(items, '/star.md')).toEqual([
      { path: '/docs', kind: 'folder' },
      { path: '/star.md', kind: 'file', starred: false },
      { path: '/a.md', kind: 'file' },
    ]);
  });

  it('unstars a folder back to the head of normal folders', () => {
    const items: RecentItem[] = [
      { path: '/star-dir', kind: 'folder', starred: true },
      { path: '/docs', kind: 'folder' },
      { path: '/a.md', kind: 'file' },
    ];
    expect(toggleRecentStar(items, '/star-dir')).toEqual([
      { path: '/star-dir', kind: 'folder', starred: false },
      { path: '/docs', kind: 'folder' },
      { path: '/a.md', kind: 'file' },
    ]);
  });

  it('returns the same reference for unknown paths', () => {
    const items: RecentItem[] = [
      { path: '/docs', kind: 'folder' },
      { path: '/a.md', kind: 'file' },
    ];
    expect(toggleRecentStar(items, '/missing.md')).toBe(items);
  });

  it('preserves extra fields carried by caller rows (generic contract)', () => {
    const rows = [
      { path: '/docs', kind: 'folder' as const, name: 'docs', dir: '/' },
      { path: '/a.md', kind: 'file' as const, name: 'a.md', dir: '/' },
    ];
    const next = toggleRecentStar(rows, '/a.md');
    expect(next[0]).toEqual({
      path: '/a.md',
      kind: 'file',
      starred: true,
      name: 'a.md',
      dir: '/',
    });
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
