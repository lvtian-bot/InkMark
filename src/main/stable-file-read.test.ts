import { describe, expect, it } from 'vitest';
import {
  readStableTextFile,
  FileTooLargeError,
  UnsupportedEncodingError,
  type FileVersion,
} from './stable-file-read';

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

describe('readStableTextFile BOM 与大小上限', () => {
  it('合法 UTF-8 的 BOM 原样保留，不因严格解码被吞掉', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文', 'utf-8')]);
    const result = readStableTextFile('bom.md', {
      stat: () => version({ size: bytes.byteLength }),
      read: () => bytes,
    });
    expect(result.content).toBe('﻿中文');
  });

  it('读取前核对大小上限，超限抛出 FileTooLargeError 且不读字节', () => {
    let readCalled = 0;
    expect(() =>
      readStableTextFile(
        'huge.log',
        {
          stat: () => version({ size: 11 * 1024 * 1024 }),
          read: () => {
            readCalled += 1;
            return Buffer.alloc(11 * 1024 * 1024);
          },
        },
        5,
        10 * 1024 * 1024,
      ),
    ).toThrow(FileTooLargeError);
    expect(readCalled).toBe(0);
  });
});
