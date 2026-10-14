import { describe, expect, it } from 'vitest';
import {
  ensureUniqueFileName,
  isWorkspaceFileNameTaken,
  validateWorkspaceDocumentName,
  validateWorkspaceFileName,
} from './workspace-file-name';

describe('validateWorkspaceFileName', () => {
  it('普通名称可用', () => {
    expect(validateWorkspaceFileName('会议记录.md')).toBeNull();
    expect(validateWorkspaceFileName('note.markdown')).toBeNull();
    expect(validateWorkspaceFileName('2026 计划.v2.md')).toBeNull();
  });

  it('空名称不可用', () => {
    expect(validateWorkspaceFileName('')).toBe('empty');
  });

  it('禁止路径分隔符与 Windows 特殊字符', () => {
    expect(validateWorkspaceFileName('a/b.md')).toBe('invalid-chars');
    expect(validateWorkspaceFileName('a\\b.md')).toBe('invalid-chars');
    expect(validateWorkspaceFileName('a:b.md')).toBe('invalid-chars');
    expect(validateWorkspaceFileName('a*b.md')).toBe('invalid-chars');
    expect(validateWorkspaceFileName('a?b.md')).toBe('invalid-chars');
    expect(validateWorkspaceFileName('a"b.md')).toBe('invalid-chars');
    expect(validateWorkspaceFileName('a<b.md')).toBe('invalid-chars');
    expect(validateWorkspaceFileName('a>b.md')).toBe('invalid-chars');
    expect(validateWorkspaceFileName('a|b.md')).toBe('invalid-chars');
  });

  it('禁止结尾点与空格', () => {
    expect(validateWorkspaceFileName('note.md.')).toBe('trailing-dot-or-space');
    expect(validateWorkspaceFileName('note ')).toBe('trailing-dot-or-space');
  });

  it('Windows 保留设备名不可用，含带扩展名形式', () => {
    expect(validateWorkspaceFileName('CON')).toBe('reserved-name');
    expect(validateWorkspaceFileName('con.md')).toBe('reserved-name');
    expect(validateWorkspaceFileName('LPT1.txt')).toBe('reserved-name');
    expect(validateWorkspaceFileName('COM9')).toBe('reserved-name');
    expect(validateWorkspaceFileName('content.md')).toBeNull();
    expect(validateWorkspaceFileName('null 结果.md')).toBeNull();
  });
});

describe('validateWorkspaceDocumentName', () => {
  it('可见的 Markdown 名称可用，大小写扩展名均可', () => {
    expect(validateWorkspaceDocumentName('会议记录.md')).toBeNull();
    expect(validateWorkspaceDocumentName('notes.MARKDOWN')).toBeNull();
  });

  it('点号开头的隐藏名称不可用', () => {
    expect(validateWorkspaceDocumentName('.notes.md')).toBe('hidden-name');
  });

  it('非 Markdown 扩展名或无扩展名不可用', () => {
    expect(validateWorkspaceDocumentName('notes.txt')).toBe('unsupported-extension');
    expect(validateWorkspaceDocumentName('notes')).toBe('unsupported-extension');
  });

  it('基础规则同样生效', () => {
    expect(validateWorkspaceDocumentName('a|b.md')).toBe('invalid-chars');
    expect(validateWorkspaceDocumentName('')).toBe('empty');
  });
});

describe('isWorkspaceFileNameTaken', () => {
  it('同名（含大小写差异）视为冲突', () => {
    expect(isWorkspaceFileNameTaken('note.md', ['todo.md', 'Note.md'])).toBe(true);
    expect(isWorkspaceFileNameTaken('note.md', ['todo.md', 'idea.md'])).toBe(false);
  });
});

describe('ensureUniqueFileName', () => {
  it('无冲突时原样返回', () => {
    expect(ensureUniqueFileName('新建文档.md', ['todo.md'])).toBe('新建文档.md');
  });

  it('冲突时按序号递增直到可用', () => {
    expect(ensureUniqueFileName('新建文档.md', ['新建文档.md'])).toBe('新建文档 2.md');
    expect(
      ensureUniqueFileName('新建文档.md', ['新建文档.md', '新建文档 2.md', '新建文档 3.md']),
    ).toBe('新建文档 4.md');
  });

  it('无扩展名时同样追加序号', () => {
    expect(ensureUniqueFileName('笔记', ['笔记'])).toBe('笔记 2');
  });
});
