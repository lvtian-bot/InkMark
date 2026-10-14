import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import {
  createTempWorkspaceDir,
  createWorkspaceDocument,
  renameWorkspaceFile,
} from './workspace-file-ops';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = createTempWorkspaceDir();
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('createWorkspaceDocument', () => {
  it('在目标目录创建空文档并返回路径与修改时间', () => {
    const dir = makeTempDir();
    const result = createWorkspaceDocument(dir, '会议记录.md');

    expect(result).toMatchObject({ path: join(dir, '会议记录.md') });
    expect(existsSync(join(dir, '会议记录.md'))).toBe(true);
    if ('mtime' in result) expect(result.mtime).toBeGreaterThan(0);
  });

  it('拒绝非法文件名', () => {
    const dir = makeTempDir();
    expect(createWorkspaceDocument(dir, 'a/b.md')).toEqual({ error: 'invalid-name' });
    expect(createWorkspaceDocument(dir, '')).toEqual({ error: 'invalid-name' });
    expect(createWorkspaceDocument(dir, 'CON.md')).toEqual({ error: 'invalid-name' });
  });

  it('拒绝文件树不显示的名称:隐藏项与非 Markdown 扩展名', () => {
    const dir = makeTempDir();
    expect(createWorkspaceDocument(dir, '.notes.md')).toEqual({ error: 'invalid-name' });
    expect(createWorkspaceDocument(dir, 'notes.txt')).toEqual({ error: 'invalid-name' });
    expect(createWorkspaceDocument(dir, 'notes')).toEqual({ error: 'invalid-name' });
  });

  it('目标已存在时报 exists 且不覆盖', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'note.md'), '已有内容', 'utf8');

    const result = createWorkspaceDocument(dir, 'note.md');

    expect(result).toEqual({ error: 'exists' });
    expect(join(dir, 'note.md') && existsSync(join(dir, 'note.md'))).toBe(true);
  });

  it('目录不存在时报 parent-missing', () => {
    const dir = join(makeTempDir(), '不存在');
    expect(createWorkspaceDocument(dir, 'note.md')).toEqual({ error: 'parent-missing' });
  });
});

describe('renameWorkspaceFile', () => {
  it('重命名文件并返回新路径与修改时间', () => {
    const dir = makeTempDir();
    const oldPath = join(dir, '旧名.md');
    writeFileSync(oldPath, '# hello', 'utf8');

    const result = renameWorkspaceFile(oldPath, '新名.md');

    expect(result).toMatchObject({ path: join(dir, '新名.md') });
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(join(dir, '新名.md'))).toBe(true);
  });

  it('拒绝非法新名', () => {
    const dir = makeTempDir();
    const oldPath = join(dir, 'note.md');
    writeFileSync(oldPath, '', 'utf8');
    expect(renameWorkspaceFile(oldPath, 'a|b.md')).toEqual({ error: 'invalid-name' });
  });

  it('新名已存在时报 exists 且原文件保留', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'a.md'), 'A', 'utf8');
    writeFileSync(join(dir, 'b.md'), 'B', 'utf8');

    const result = renameWorkspaceFile(join(dir, 'a.md'), 'b.md');

    expect(result).toEqual({ error: 'exists' });
    expect(existsSync(join(dir, 'a.md'))).toBe(true);
  });

  it('原文件不存在时报 source-missing', () => {
    const dir = makeTempDir();
    expect(renameWorkspaceFile(join(dir, 'ghost.md'), 'new.md')).toEqual({
      error: 'source-missing',
    });
  });

  it('子目录中的文件可重命名，新名落在同目录', () => {
    const dir = makeTempDir();
    const sub = join(dir, '子目录');
    mkdirSync(sub);
    writeFileSync(join(sub, 'a.md'), '', 'utf8');

    const result = renameWorkspaceFile(join(sub, 'a.md'), 'b.md');

    expect(result).toMatchObject({ path: join(sub, 'b.md') });
  });

  it('Windows 上仅大小写差异的改名视为同一文件，允许执行', () => {
    const dir = makeTempDir();
    const oldPath = join(dir, 'note.md');
    writeFileSync(oldPath, '', 'utf8');

    const result = renameWorkspaceFile(oldPath, 'Note.md');

    expect(result).toMatchObject({ path: join(dir, 'Note.md') });
    // Windows 目录大小写不敏感,改名后按任一大小写查询都指向同一文件
    const names = readdirSync(dir);
    expect(names).toEqual(['Note.md']);
  });
});

describe('renameWorkspaceFile 基线核对', () => {
  it('磁盘修改时间与基线不一致（存在外部版本）时报 conflict', () => {
    const dir = makeTempDir();
    const oldPath = join(dir, 'a.md');
    writeFileSync(oldPath, '', 'utf8');
    const baseline = statSync(oldPath).mtimeMs;
    // 模拟外部写入使磁盘 mtime 前移
    const future = new Date(Date.now() + 5000);
    utimesSync(oldPath, future, future);

    const result = renameWorkspaceFile(oldPath, 'b.md', baseline);

    expect(result).toEqual({ error: 'conflict' });
    expect(existsSync(oldPath)).toBe(true);
  });

  it('基线一致时正常重命名', () => {
    const dir = makeTempDir();
    const oldPath = join(dir, 'a.md');
    writeFileSync(oldPath, '', 'utf8');
    const baseline = statSync(oldPath).mtimeMs;

    const result = renameWorkspaceFile(oldPath, 'b.md', baseline);

    expect(result).toMatchObject({ path: join(dir, 'b.md') });
  });

  it('不传基线时不做核对，保持既有行为', () => {
    const dir = makeTempDir();
    const oldPath = join(dir, 'a.md');
    writeFileSync(oldPath, '', 'utf8');

    const result = renameWorkspaceFile(oldPath, 'b.md');

    expect(result).toMatchObject({ path: join(dir, 'b.md') });
  });
});
