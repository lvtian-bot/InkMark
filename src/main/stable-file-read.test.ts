import { describe, expect, it } from 'vitest';
import { readStableTextFile, type FileVersion } from './stable-file-read';

function version(overrides: Partial<FileVersion> = {}): FileVersion {
  return {
    dev: 1,
    ino: 1,
    size: 3,
    mtimeMs: 1,
    ctimeMs: 1,
    ...overrides,
  };
}

describe('readStableTextFile', () => {
  it('正文读取期间文件被替换时重读，避免旧正文配上新 mtime', () => {
    const oldVersion = version();
    const newVersion = version({ ino: 2, mtimeMs: 2, ctimeMs: 2 });
    const stats = [oldVersion, newVersion, newVersion, newVersion];
    const contents = [Buffer.from('old'), Buffer.from('new')];

    const result = readStableTextFile('note.md', {
      stat: () => stats.shift()!,
      read: () => contents.shift()!,
    });

    expect(result).toEqual({ content: 'new', mtime: 2 });
  });

  it('文件持续变化时不返回不可信快照', () => {
    let call = 0;
    expect(() =>
      readStableTextFile(
        'note.md',
        {
          stat: () => version({ mtimeMs: call++, ctimeMs: call }),
          read: () => Buffer.from('new'),
        },
        2,
      ),
    ).toThrow('File changed repeatedly while being read.');
  });
});
