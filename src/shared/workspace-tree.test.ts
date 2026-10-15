import { describe, expect, it } from 'vitest';
import {
  compareWorkspaceEntries,
  filterWorkspaceEntries,
  shouldIncludeEntry,
  WORKSPACE_IGNORED_DIRECTORIES,
  type WorkspaceEntry,
} from './workspace-tree';

function entry(name: string, isDirectory = false): WorkspaceEntry {
  return { name, absolutePath: `/root/${name}`, isDirectory };
}

describe('workspace-tree shouldIncludeEntry', () => {
  it('keeps markdown files and directories', () => {
    expect(shouldIncludeEntry('readme.md', false)).toBe(true);
    expect(shouldIncludeEntry('Notes.MARKDOWN', false)).toBe(true);
    expect(shouldIncludeEntry('docs', true)).toBe(true);
  });

  it('keeps plain-text, code and config files from the openable whitelist', () => {
    expect(shouldIncludeEntry('notes.txt', false)).toBe(true);
    expect(shouldIncludeEntry('main.ts', false)).toBe(true);
    expect(shouldIncludeEntry('app.py', false)).toBe(true);
    expect(shouldIncludeEntry('config.YAML', false)).toBe(true);
    expect(shouldIncludeEntry('Makefile', false)).toBe(false);
  });

  it('drops files outside the openable whitelist but keeps directories of any name', () => {
    expect(shouldIncludeEntry('image.png', false)).toBe(false);
    expect(shouldIncludeEntry('archive.zip', false)).toBe(false);
    expect(shouldIncludeEntry('debug.log', false)).toBe(false);
    // 目录即使名字不像文档也保留,以便展开浏览
    expect(shouldIncludeEntry('assets', true)).toBe(true);
  });

  it('hides dependency and cache directories by default', () => {
    expect(shouldIncludeEntry('node_modules', true)).toBe(false);
    expect(shouldIncludeEntry('__pycache__', true)).toBe(false);
    expect(shouldIncludeEntry('Node_Modules', true)).toBe(false);
    expect(shouldIncludeEntry('dist', true)).toBe(true);
    expect([...WORKSPACE_IGNORED_DIRECTORIES]).toEqual(['node_modules', '__pycache__']);
  });

  it('ignores dotfiles and dot-directories', () => {
    expect(shouldIncludeEntry('.git', true)).toBe(false);
    expect(shouldIncludeEntry('.assets', true)).toBe(false);
    expect(shouldIncludeEntry('.DS_Store', false)).toBe(false);
    expect(shouldIncludeEntry('.hidden.md', false)).toBe(false);
    expect(shouldIncludeEntry('', false)).toBe(false);
  });
});

describe('workspace-tree compareWorkspaceEntries', () => {
  it('lists directories before files', () => {
    const dir = entry('z-dir', true);
    const file = entry('a-file', false);
    expect(compareWorkspaceEntries(dir, file)).toBeLessThan(0);
    expect(compareWorkspaceEntries(file, dir)).toBeGreaterThan(0);
  });

  it('sorts names case-insensitively within the same type', () => {
    expect(compareWorkspaceEntries(entry('Banana.md'), entry('apple.md'))).toBeGreaterThan(0);
    expect(compareWorkspaceEntries(entry('apple.md'), entry('Apple.md'))).toBe(0);
  });

  it('keeps directories ordered among themselves', () => {
    expect(compareWorkspaceEntries(entry('Zeta', true), entry('alpha', true))).toBeGreaterThan(0);
  });
});

describe('workspace-tree filterWorkspaceEntries', () => {
  it('filters hidden, non-document files and dependency dirs, sorts dirs-first', () => {
    const result = filterWorkspaceEntries([
      entry('readme.md'),
      entry('image.png'),
      entry('.git', true),
      entry('node_modules', true),
      entry('Docs', true),
      entry('Apple.md'),
      entry('main.ts'),
      entry('apple.md'),
      entry('.hidden.md'),
      entry('z-notes', true),
    ]);

    expect(result).toEqual([
      entry('Docs', true),
      entry('z-notes', true),
      // 大小写不敏感下 Apple.md 与 apple.md 视为相等,保留输入相对顺序
      entry('Apple.md'),
      entry('apple.md'),
      entry('main.ts'),
      entry('readme.md'),
    ]);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterWorkspaceEntries([entry('.git', true), entry('pic.png')])).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [entry('b.md'), entry('a.md')];
    const snapshot = [...input];
    filterWorkspaceEntries(input);
    expect(input).toEqual(snapshot);
  });
});
