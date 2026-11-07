import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDocumentSaveAuthorization,
  resolveDocumentSaveTarget,
} from './document-save-authorization';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'inkmark-save-auth-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function target(path: string): string {
  const result = resolveDocumentSaveTarget(path);
  if (!result) throw new Error('Expected a save target');
  return result;
}

describe('原文件保存授权', () => {
  it('能读取的脚本默认不可覆盖，单文件授权不扩大到同目录', () => {
    const authorization = createDocumentSaveAuthorization();
    const script = join(directory, 'script.ps1');
    const anotherScript = join(directory, 'another.ps1');
    writeFileSync(script, 'first');
    writeFileSync(anotherScript, 'second');

    expect(authorization.isApproved(target(script))).toBe(false);
    authorization.approveFile(target(script));
    expect(authorization.isApproved(target(script))).toBe(true);
    expect(authorization.isApproved(target(anotherScript))).toBe(false);
  });

  it('显式授权的工作区允许保存，但目录联接不会放行外部文件', () => {
    const authorization = createDocumentSaveAuthorization();
    const workspace = join(directory, 'workspace');
    const outside = join(directory, 'outside');
    mkdirSync(workspace);
    mkdirSync(outside);
    writeFileSync(join(workspace, 'note.md'), 'note');
    writeFileSync(join(outside, 'script.ps1'), 'script');
    symlinkSync(outside, join(workspace, 'alias'), 'junction');

    authorization.approveWorkspace(workspace);
    expect(authorization.isApproved(target(join(workspace, 'note.md')))).toBe(true);
    const aliasTarget = target(join(workspace, 'alias', 'script.ps1'));
    expect(aliasTarget).toBe(realpathSync(join(outside, 'script.ps1')));
    expect(authorization.isApproved(aliasTarget)).toBe(false);
    expect(authorization.isApproved(target(join(workspace, 'alias', 'missing.ps1')))).toBe(false);
  });

  it('重命名已授权文件后将权限移到新路径', () => {
    const authorization = createDocumentSaveAuthorization();
    const before = join(directory, 'before.md');
    const after = join(directory, 'after.md');
    writeFileSync(before, 'note');
    const beforeTarget = target(before);
    authorization.approveFile(beforeTarget);

    renameSync(before, after);
    authorization.moveFile(beforeTarget, target(after));
    expect(authorization.isApproved(target(before))).toBe(false);
    expect(authorization.isApproved(target(after))).toBe(true);
  });
});
