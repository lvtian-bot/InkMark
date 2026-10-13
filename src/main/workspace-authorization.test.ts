import { describe, expect, it } from 'vitest';
import { createWorkspaceAuthorization } from './workspace-authorization';

describe('workspace-authorization', () => {
  it('已批准目录覆盖其内目标（含大小写与分隔符差异）', () => {
    const auth = createWorkspaceAuthorization();
    auth.approve('D:\\笔记');
    expect(auth.isApproved('D:\\笔记\\a.md')).toBe(true);
    expect(auth.isApproved('d:/笔记/子/b.md')).toBe(true);
  });

  it('目录外目标被拒绝', () => {
    const auth = createWorkspaceAuthorization();
    auth.approve('D:\\笔记');
    expect(auth.isApproved('D:\\其他\\a.md')).toBe(false);
  });

  it('带 .. 的路径先解析再判定，不能穿越出已批准目录', () => {
    const auth = createWorkspaceAuthorization();
    auth.approve('C:\\work');
    expect(auth.isApproved('C:\\work\\..\\Documents\\secret.md')).toBe(false);
    expect(auth.isApproved('C:\\work\\sub\\..\\ok.md')).toBe(true);
  });

  it('登记时同样规范化，.. 片段不会混入已批准根', () => {
    const auth = createWorkspaceAuthorization();
    auth.approve('C:\\work\\..\\Users');
    // resolve 后实际登记的是 C:\Users,只覆盖该目录,不是任意路径
    expect(auth.isApproved('C:\\Users\\me\\a.md')).toBe(true);
    expect(auth.isApproved('C:\\work\\x.md')).toBe(false);
  });

  it('盘符根与文件系统根不授权', () => {
    const auth = createWorkspaceAuthorization();
    auth.approve('C:\\');
    auth.approve('C:');
    auth.approve('/');
    expect(auth.isApproved('C:\\anything\\a.md')).toBe(false);
    expect(auth.isApproved('/etc/passwd.md')).toBe(false);
  });
});
