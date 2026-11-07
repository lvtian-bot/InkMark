import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDraftRecovery } from './draft-recovery';

const directory = mkdtempSync(join(tmpdir(), 'inkmark-drafts-'));
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('正文恢复草稿', () => {
  it('保存、更新并删除草稿，不修改原文档', () => {
    const original = join(directory, 'original.md');
    writeFileSync(original, '磁盘正文');
    const store = createDraftRecovery(join(directory, 'drafts'));
    const draft = {
      id: 'draft-1',
      filePath: original,
      fileMtime: 1,
      baseContent: '磁盘正文',
      content: '编辑内容',
    };
    store.save(draft);
    store.save({ ...draft, content: '更新内容' });
    expect(store.list()).toEqual([{ ...draft, content: '更新内容' }]);
    expect(readFileSync(original, 'utf8')).toBe('磁盘正文');
    store.remove(draft.id);
    expect(store.list()).toEqual([]);
  });

  it('拒绝路径穿越和无效数据', () => {
    const store = createDraftRecovery(join(directory, 'drafts'));
    expect(() => store.remove('../original')).toThrow();
    expect(() =>
      store.save({
        id: '../original',
        content: 'x',
        filePath: null,
        fileMtime: null,
        baseContent: null,
      }),
    ).toThrow();
  });
});
