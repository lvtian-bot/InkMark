import { describe, expect, it } from 'vitest';
import {
  decideFileTreeFollow,
  directoryChainFromRoot,
  isPathInside,
  parentDirectory,
} from './file-tree-follow';

describe('file-tree-follow isPathInside', () => {
  it('matches a file directly under the root', () => {
    expect(isPathInside('C:\\Users\\me\\F\\a.md', 'C:\\Users\\me\\F')).toBe(true);
    expect(isPathInside('/home/me/F/a.md', '/home/me/F')).toBe(true);
  });

  it('matches a file in a nested subdirectory', () => {
    expect(isPathInside('C:\\Users\\me\\F\\sub\\deep\\a.md', 'C:\\Users\\me\\F')).toBe(true);
  });

  it('treats the root path itself as inside', () => {
    expect(isPathInside('C:\\Users\\me\\F', 'C:\\Users\\me\\F')).toBe(true);
  });

  it('is false for siblings and unrelated paths', () => {
    expect(isPathInside('C:\\Users\\me\\F2\\a.md', 'C:\\Users\\me\\F')).toBe(false);
    // 前缀同名但不在目录内:F2 不是 F 的子目录
    expect(isPathInside('C:\\Users\\me\\F-other\\a.md', 'C:\\Users\\me\\F')).toBe(false);
  });

  it('ignores Windows drive letter case', () => {
    expect(isPathInside('c:\\users\\me\\F\\a.md', 'C:\\Users\\me\\F')).toBe(true);
    expect(isPathInside('C:\\Users\\me\\F\\a.md', 'c:\\users\\ME\\f')).toBe(true);
  });

  it('tolerates mixed separators and trailing separators', () => {
    expect(isPathInside('C:/Users/me/F/sub/a.md', 'C:\\Users\\me\\F\\')).toBe(true);
    expect(isPathInside('C:\\Users\\me\\F\\a.md', 'C:/Users/me/F/')).toBe(true);
  });

  it('handles a drive root as the container', () => {
    expect(isPathInside('C:\\Users\\a.md', 'C:\\')).toBe(true);
    expect(isPathInside('C:\\a.md', 'C:\\')).toBe(true);
  });
});

describe('file-tree-follow parentDirectory', () => {
  it('returns the containing folder of a windows file', () => {
    expect(parentDirectory('C:\\Users\\me\\F\\a.md')).toBe('C:\\Users\\me\\F');
  });

  it('returns the containing folder of a unix file', () => {
    expect(parentDirectory('/home/me/F/a.md')).toBe('/home/me/F');
  });

  it('returns the drive root for a file directly on the drive', () => {
    expect(parentDirectory('C:\\a.md')).toBe('C:\\');
  });

  it('returns the unix root for a file directly under root', () => {
    expect(parentDirectory('/a.md')).toBe('/');
  });

  it('strips trailing separators before splitting', () => {
    expect(parentDirectory('C:\\Users\\me\\F\\')).toBe('C:\\Users\\me');
  });

  it('returns null for a bare drive or unparseable path', () => {
    expect(parentDirectory('C:\\')).toBeNull();
    expect(parentDirectory('a.md')).toBeNull();
  });
});

describe('file-tree-follow directoryChainFromRoot', () => {
  it('returns just the root when the file is directly inside', () => {
    expect(directoryChainFromRoot('C:\\Users\\me\\F\\a.md', 'C:\\Users\\me\\F')).toEqual([
      'C:\\Users\\me\\F',
    ]);
  });

  it('walks each ancestor directory down to the file parent', () => {
    expect(directoryChainFromRoot('C:\\Users\\me\\F\\sub\\deep\\a.md', 'C:\\Users\\me\\F')).toEqual(
      ['C:\\Users\\me\\F', 'C:\\Users\\me\\F\\sub', 'C:\\Users\\me\\F\\sub\\deep'],
    );
  });

  it('preserves original segment case for matching against disk entries', () => {
    expect(directoryChainFromRoot('C:\\Users\\Me\\F\\Sub\\a.md', 'C:\\Users\\Me\\F')).toEqual([
      'C:\\Users\\Me\\F',
      'C:\\Users\\Me\\F\\Sub',
    ]);
  });

  it('works with forward-slash unix paths', () => {
    expect(directoryChainFromRoot('/home/me/F/sub/a.md', '/home/me/F')).toEqual([
      '/home/me/F',
      '/home/me/F/sub',
    ]);
  });

  it('returns null when the file is outside the root', () => {
    expect(directoryChainFromRoot('C:\\Users\\me\\F2\\a.md', 'C:\\Users\\me\\F')).toBeNull();
  });

  it('uses the root separator style even if the child mixes separators', () => {
    // child 用 /,root 用 \:拼接仍按 root 的反斜杠风格,保证与 dir:list 一致
    expect(directoryChainFromRoot('C:/Users/me/F/sub/a.md', 'C:\\Users\\me\\F')).toEqual([
      'C:\\Users\\me\\F',
      'C:\\Users\\me\\F\\sub',
    ]);
  });
});

describe('file-tree-follow decideFileTreeFollow', () => {
  it('does nothing when there is no file path (untitled doc)', () => {
    expect(decideFileTreeFollow(null, 'C:\\F', [])).toEqual({ type: 'none' });
  });

  it('stays when the file is inside the current root', () => {
    expect(decideFileTreeFollow('C:\\F\\sub\\a.md', 'C:\\F', ['C:\\F', 'C:\\Other'])).toEqual({
      type: 'stay',
    });
  });

  it('stays when current root is the drive root containing the file', () => {
    expect(decideFileTreeFollow('C:\\F\\a.md', 'C:\\', [])).toEqual({ type: 'stay' });
  });

  it('restores the most recent covering historical root', () => {
    // 历史根按最近显示优先:C:\Recent 比 C:\Older 更近,且都能覆盖文件
    const history = ['C:\\Other', 'C:\\Recent', 'C:\\Older'];
    expect(decideFileTreeFollow('C:\\Recent\\a.md', 'C:\\Current', history)).toEqual({
      type: 'restore',
      root: 'C:\\Recent',
    });
  });

  it('skips non-covering historical roots and picks the first covering one', () => {
    const history = ['C:\\NoCover', 'C:\\Covers\\F', 'C:\\AlsoNoCover'];
    expect(decideFileTreeFollow('C:\\Covers\\F\\a.md', null, history)).toEqual({
      type: 'restore',
      root: 'C:\\Covers\\F',
    });
  });

  it('switches to the file folder when no root covers it', () => {
    expect(decideFileTreeFollow('C:\\NewPlace\\b.md', null, [])).toEqual({
      type: 'switch',
      folder: 'C:\\NewPlace',
    });
  });

  it('switches when the file is outside both current root and all history', () => {
    expect(decideFileTreeFollow('C:\\Elsewhere\\b.md', 'C:\\F', ['C:\\F', 'C:\\Other'])).toEqual({
      type: 'switch',
      folder: 'C:\\Elsewhere',
    });
  });

  it('returns none when the file has no parent directory', () => {
    // 盘符根本身无父目录:决策放弃,不动树
    expect(decideFileTreeFollow('C:\\', null, [])).toEqual({ type: 'none' });
  });

  it('does not consider current root again when scanning history', () => {
    // currentRoot 已在 stay 分支处理,历史扫描跳过它;此处文件在 currentRoot 外,
    // 历史里只有 currentRoot,无覆盖者 → switch
    expect(decideFileTreeFollow('C:\\Out\\a.md', 'C:\\F', ['C:\\F'])).toEqual({
      type: 'switch',
      folder: 'C:\\Out',
    });
  });

  it('is case-insensitive when matching against historical roots', () => {
    expect(decideFileTreeFollow('c:\\proj\\a.md', null, ['C:\\Proj'])).toEqual({
      type: 'restore',
      root: 'C:\\Proj',
    });
  });
});
