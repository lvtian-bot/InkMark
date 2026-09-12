import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { saveReviewedFileVersion, writeNewReviewCopy } from './review-file-save';

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'inkmark-review-save-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    for (const entry of readdirSync(directory)) unlinkSync(join(directory, entry));
    rmdirSync(directory);
  }
});

describe('审阅版本保存', () => {
  const request = {
    path: 'note.md',
    content: '审阅结果',
    expectedContent: '进入审阅时的磁盘正文',
    expectedMtime: 10,
  };

  it('mtime 相同但正文改变时拒绝写入', () => {
    const write = vi.fn(() => 11);
    const result = saveReviewedFileVersion(request, write, () => ({
      content: '外部再次修改',
      mtime: 10,
    }));
    expect(result).toEqual({ status: 'conflict' });
    expect(write).not.toHaveBeenCalled();
  });

  it('正文相同但 mtime 改变时仍要求保留原件', () => {
    const write = vi.fn(() => 11);
    const result = saveReviewedFileVersion(request, write, () => ({
      content: request.expectedContent,
      mtime: 12,
    }));
    expect(result).toEqual({ status: 'conflict' });
    expect(write).not.toHaveBeenCalled();
  });

  it('真实文件正文和版本均匹配时仅执行一次写入', () => {
    const path = join(temporaryDirectory(), 'note.md');
    writeFileSync(path, request.expectedContent, 'utf-8');
    const write = vi.fn(() => 20);
    expect(
      saveReviewedFileVersion({ ...request, path, expectedMtime: statSync(path).mtimeMs }, write),
    ).toEqual({ status: 'ok', mtime: 20 });
    expect(write).toHaveBeenCalledOnce();
  });

  it('文件无法读取时不写入', () => {
    const write = vi.fn(() => 11);
    const result = saveReviewedFileVersion(request, write, () => {
      throw new Error('文件不存在或正在连续变化');
    });
    expect(result).toEqual({ status: 'conflict' });
    expect(write).not.toHaveBeenCalled();
  });
});

describe('审阅结果仅另存新文件', () => {
  it('创建完整新副本并返回该文件版本', () => {
    const path = join(temporaryDirectory(), 'copy.md');
    const mtime = writeNewReviewCopy(path, '审阅结果\n', join(path, '..', 'original.md'));
    expect(readFileSync(path, 'utf-8')).toBe('审阅结果\n');
    expect(mtime).toBe(statSync(path).mtimeMs);
  });

  it('已有同名文件不被覆盖', () => {
    const path = join(temporaryDirectory(), 'copy.md');
    writeFileSync(path, '已有正文', 'utf-8');
    expect(() =>
      writeNewReviewCopy(path, '审阅结果', join(path, '..', 'original.md')),
    ).toThrowError(expect.objectContaining({ code: 'EEXIST' }));
    expect(readFileSync(path, 'utf-8')).toBe('已有正文');
  });

  it('原件的硬链接别名也不能被覆盖', () => {
    const directory = temporaryDirectory();
    const original = join(directory, 'original.md');
    const alias = join(directory, 'alias.md');
    writeFileSync(original, '外部最新版', 'utf-8');
    linkSync(original, alias);
    expect(() => writeNewReviewCopy(alias, '审阅结果', original)).toThrowError(
      expect.objectContaining({ code: 'EEXIST' }),
    );
    expect(readFileSync(original, 'utf-8')).toBe('外部最新版');
    expect(readFileSync(alias, 'utf-8')).toBe('外部最新版');
  });

  it('原文件已被删除时也不能选回原路径重建', () => {
    const original = join(temporaryDirectory(), 'original.md');
    expect(() => writeNewReviewCopy(original, '审阅结果', original)).toThrowError(
      expect.objectContaining({ code: 'EEXIST' }),
    );
    expect(() => statSync(original)).toThrowError(expect.objectContaining({ code: 'ENOENT' }));
  });
});
