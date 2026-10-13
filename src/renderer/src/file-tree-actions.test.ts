import { describe, expect, it } from 'vitest';
import {
  decideDeleteWarning,
  findTabsUnderPath,
  findTabsWithActiveReview,
} from './file-tree-actions';
import type { Tab } from './stores/useStore';

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'tab-1',
    filePath: null,
    fileName: '欢迎',
    isDirty: false,
    isStartPage: true,
    outline: [],
    wordCount: 0,
    charCount: 0,
    sourceContent: '',
    wysiwygScrollTop: 0,
    sourceScrollTop: 0,
    fileMtime: null,
    externalUpdatePending: false,
    pendingReviewCount: 0,
    reviewSession: false,
    ...overrides,
  };
}

describe('findTabsUnderPath', () => {
  it('命中目标文件自身与目录内文件，Windows 路径比较不区分大小写与分隔符', () => {
    const tabs = [
      makeTab({ id: 'a', filePath: 'D:\\笔记\\a.md' }),
      makeTab({ id: 'b', filePath: 'D:\\笔记\\子\\b.md' }),
      makeTab({ id: 'c', filePath: 'D:\\其他\\c.md' }),
      makeTab({ id: 'd', filePath: null }),
    ];

    const byFile = findTabsUnderPath(tabs, 'd:/笔记/a.md');
    expect(byFile.map((t) => t.id)).toEqual(['a']);

    const byDir = findTabsUnderPath(tabs, 'D:\\笔记');
    expect(byDir.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('findTabsWithActiveReview', () => {
  it('审阅会话与未决审阅块都算审阅中', () => {
    const tabs = [
      makeTab({ id: 'a', reviewSession: true }),
      makeTab({ id: 'b', pendingReviewCount: 2 }),
      makeTab({ id: 'c' }),
    ];
    expect(findTabsWithActiveReview(tabs).map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('decideDeleteWarning', () => {
  it('目标内有审阅中标签时阻止删除', () => {
    const tabs = [makeTab({ filePath: 'D:\\n\\a.md', reviewSession: true })];
    expect(decideDeleteWarning(tabs, 'D:\\n\\a.md')).toBe('review-blocked');
  });

  it('无审阅但有未保存修改时警示丢失', () => {
    const tabs = [
      makeTab({ filePath: 'D:\\n\\a.md', isDirty: false }),
      makeTab({ filePath: 'D:\\n\\b.md', isDirty: true }),
    ];
    expect(decideDeleteWarning(tabs, 'D:\\n')).toBe('dirty-open');
  });

  it('无关标签与干净标签不影响判定', () => {
    const tabs = [
      makeTab({ filePath: 'D:\\其他\\c.md', isDirty: true }),
      makeTab({ filePath: 'D:\\n\\a.md' }),
    ];
    expect(decideDeleteWarning(tabs, 'D:\\n\\a.md')).toBe('none');
    expect(decideDeleteWarning([], 'D:\\n\\a.md')).toBe('none');
  });
});
