import { describe, it, expect } from 'vitest';
import { shouldLiftTaskItemOnBackspace } from './task-list';

/// `shouldLiftTaskItemOnBackspace` 决定「任务项行首 Backspace」是否改为提升出列表，
/// 而非走默认的合并到前一项（合并会继承前一项 checked，导致串台）。这里覆盖它的全部
/// 分支：任务项/普通项、行首/非行首、修饰键、选区、按键名。
describe('shouldLiftTaskItemOnBackspace', () => {
  const base = {
    key: 'Backspace',
    hasModifier: false,
    selectionEmpty: true,
    parentOffset: 0,
  };

  it('任务项行首 + 纯 Backspace 拦截（未完成项）', () => {
    expect(shouldLiftTaskItemOnBackspace({ ...base, taskItemChecked: false })).toBe(true);
  });

  it('任务项行首 + 纯 Backspace 拦截（已完成项）', () => {
    expect(shouldLiftTaskItemOnBackspace({ ...base, taskItemChecked: true })).toBe(true);
  });

  it('普通列表项（checked 为 null）不拦截，走默认 lift/合并', () => {
    expect(shouldLiftTaskItemOnBackspace({ ...base, taskItemChecked: null })).toBe(false);
  });

  it('光标不在行首时不拦截（让默认 Backspace 删字符）', () => {
    expect(
      shouldLiftTaskItemOnBackspace({ ...base, parentOffset: 3, taskItemChecked: false }),
    ).toBe(false);
  });

  it('带 Ctrl/Meta/Alt 修饰键时不拦截（组合键语义不同）', () => {
    expect(
      shouldLiftTaskItemOnBackspace({ ...base, hasModifier: true, taskItemChecked: false }),
    ).toBe(false);
  });

  it('非空选区时不拦截（让默认删除处理选区内容）', () => {
    expect(
      shouldLiftTaskItemOnBackspace({ ...base, selectionEmpty: false, taskItemChecked: false }),
    ).toBe(false);
  });

  it('非 Backspace 键不拦截（Delete 走自己的分支）', () => {
    expect(shouldLiftTaskItemOnBackspace({ ...base, key: 'Delete', taskItemChecked: false })).toBe(
      false,
    );
  });
});
