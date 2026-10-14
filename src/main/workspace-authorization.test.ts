import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createWorkspaceAuthorization } from './workspace-authorization';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'inkmark-workspace-auth-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('workspace-authorization', () => {
  it('已批准目录覆盖其内目标（含分隔符差异）', () => {
    const dir = makeTempDir();
    const auth = createWorkspaceAuthorization();
    auth.approve(dir);
    expect(auth.isApproved(join(dir, 'a.md'))).toBe(true);
    expect(auth.isApproved(join(dir, 'sub', 'b.md'))).toBe(true);
    expect(auth.isApproved(`${dir.replace(/\\/g, '/')}/c.md`)).toBe(true);
  });

  it('目录外目标被拒绝', () => {
    const dir = makeTempDir();
    const outside = makeTempDir();
    const auth = createWorkspaceAuthorization();
    auth.approve(dir);
    expect(auth.isApproved(join(outside, 'a.md'))).toBe(false);
  });

  it('带 .. 的路径先解析再判定，不能穿越出已批准目录', () => {
    const work = join(makeTempDir(), 'work');
    mkdirSync(work);
    const auth = createWorkspaceAuthorization();
    auth.approve(work);
    expect(auth.isApproved(join(work, '..', 'Documents', 'secret.md'))).toBe(false);
    expect(auth.isApproved(join(work, 'sub', '..', 'ok.md'))).toBe(true);
  });

  it('登记时同样规范化，.. 片段不会混入已批准根', () => {
    const base = makeTempDir();
    const users = join(base, 'users');
    mkdirSync(users);
    const auth = createWorkspaceAuthorization();
    auth.approve(join(base, 'work', '..', 'users'));
    // resolve 后实际登记的是 base/users,只覆盖该目录,不是任意路径
    expect(auth.isApproved(join(users, 'me', 'a.md'))).toBe(true);
    expect(auth.isApproved(join(base, 'work', 'x.md'))).toBe(false);
  });

  it('严格子级判定:批准根本身不算,子路径算', () => {
    const dir = makeTempDir();
    const auth = createWorkspaceAuthorization();
    auth.approve(dir);
    expect(auth.isApproved(dir)).toBe(true);
    expect(auth.isApprovedDescendant(dir)).toBe(false);
    expect(auth.isApprovedDescendant(join(dir, 'a.md'))).toBe(true);
    expect(auth.isApprovedDescendant(join(dir, 'sub'))).toBe(true);
  });

  it('指向批准根的链接别名按根本身拒绝,不当作后代', () => {
    const real = makeTempDir();
    const holder = makeTempDir();
    symlinkSync(real, join(holder, 'alias'), 'junction');
    const auth = createWorkspaceAuthorization();
    auth.approve(real);
    expect(auth.isApprovedDescendant(join(holder, 'alias'))).toBe(false);
    expect(auth.isApprovedDescendant(join(holder, 'alias', 'a.md'))).toBe(true);
  });

  it('盘符根与文件系统根不授权', () => {
    const auth = createWorkspaceAuthorization();
    auth.approve('C:\\');
    auth.approve('/');
    expect(auth.isApproved('C:\\anything\\a.md')).toBe(false);
  });
});

describe('workspace-authorization 链接解析', () => {
  it('批准目录内的符号链接不把边界外的真实位置带进来', () => {
    const inside = makeTempDir();
    const outside = makeTempDir();
    symlinkSync(outside, join(inside, 'alias'), 'junction');

    const auth = createWorkspaceAuthorization();
    auth.approve(inside);

    expect(auth.isApproved(join(inside, 'alias', 'x.md'))).toBe(false);
    expect(auth.isApproved(join(inside, 'direct.md'))).toBe(true);
  });

  it('批准目录本身经链接登记时解析到真实位置', () => {
    const inside = makeTempDir();
    const outside = makeTempDir();
    symlinkSync(outside, join(inside, 'alias'), 'junction');

    const auth = createWorkspaceAuthorization();
    auth.approve(join(inside, 'alias'));

    expect(auth.isApproved(join(outside, 'x.md'))).toBe(true);
    expect(auth.isApproved(join(inside, 'x.md'))).toBe(false);
  });
});
