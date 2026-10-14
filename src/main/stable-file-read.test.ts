import { describe, expect, it } from 'vitest';
import { readStableTextFile, UnsupportedEncodingError, type FileVersion } from './stable-file-read';

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

describe('readStableTextFile 编码校验', () => {
  it('非 UTF-8 字节流抛出 UnsupportedEncodingError，不返回乱码', () => {
    expect(() =>
      readStableTextFile('gbk.txt', {
        stat: () => version({ size: 4 }),
        read: () => Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
      }),
    ).toThrow(UnsupportedEncodingError);
  });

  it('合法 UTF-8 内容（含多字节字符）正常返回', () => {
    const result = readStableTextFile('utf8.md', {
      stat: () => version({ size: 8 }),
      read: () => Buffer.from('中文ok', 'utf-8'),
    });
    expect(result.content).toBe('中文ok');
  });
});
