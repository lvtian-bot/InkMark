import { describe, it, expect } from 'vitest';
import { shouldLiftListItemOnBackspace } from './list-keymap';

/// `shouldLiftListItemOnBackspace` 决定「列表项行首 Backspace」是否改为提升出列表，
/// 而非走默认的合并到前一项。这里覆盖它的全部分支：任务项/普通无序/有序项、项内
/// 首块/后续块、行首/非行首、修饰键、选区、按键名。
describe('shouldLiftListItemOnBackspace', () => {
  const base = {
    key: 'Backspace',
    hasModifier: false,
    selectionEmpty: true,
    parentOffset: 0,
    inListItem: true,
    atFirstBlockInItem: true,
  };

  it('列表项（无序/有序/任务，判定同构）行首 + 纯 Backspace 拦截（本次修复的核心场景）', () => {
    expect(shouldLiftListItemOnBackspace({ ...base })).toBe(true);
  });

  it('不在列表项内（普通段落行首）不拦截，走默认行为', () => {
    expect(shouldLiftListItemOnBackspace({ ...base, inListItem: false })).toBe(false);
  });

  it('松散列表项的后续块行首不拦截（默认合并到项内上一块，不整体提升）', () => {
    expect(shouldLiftListItemOnBackspace({ ...base, atFirstBlockInItem: false })).toBe(false);
  });

  it('光标不在行首时不拦截（让默认 Backspace 删字符）', () => {
    expect(shouldLiftListItemOnBackspace({ ...base, parentOffset: 3 })).toBe(false);
  });

  it('带 Ctrl/Meta/Alt 修饰键时不拦截（组合键语义不同）', () => {
    expect(shouldLiftListItemOnBackspace({ ...base, hasModifier: true })).toBe(false);
  });

  it('非空选区时不拦截（让默认删除处理选区内容）', () => {
    expect(shouldLiftListItemOnBackspace({ ...base, selectionEmpty: false })).toBe(false);
  });

  it('非 Backspace 键不拦截（Delete 走自己的分支）', () => {
    expect(shouldLiftListItemOnBackspace({ ...base, key: 'Delete' })).toBe(false);
  });
});
