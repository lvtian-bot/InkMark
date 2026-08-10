import { describe, expect, it } from 'vitest';
import { useStore } from './stores/useStore';

describe('useStore closeTab', () => {
  it('关闭最后一个标签页后回到欢迎页，而非清空标签或关闭应用', () => {
    const { addTab, closeTab } = useStore.getState();
    const fileId = addTab({ filePath: 'D:/notes/demo.md', content: '# demo', fileMtime: 1 });

    closeTab(fileId);

    const state = useStore.getState();
    // 标签页清空后由 store 自动新建一个欢迎页标签页，保持「始终至少一个标签页」。
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].isStartPage).toBe(true);
    expect(state.tabs[0].fileName).toBe('欢迎');
    expect(state.activeTabId).toBe(state.tabs[0].id);
  });

  it('关闭非活动的中间标签页不影响当前活动标签', () => {
    const { addTab, setActiveTab, closeTab } = useStore.getState();
    const aId = addTab({ filePath: 'D:/notes/a.md', content: 'a', fileMtime: 1 });
    const bId = addTab({ filePath: 'D:/notes/b.md', content: 'b', fileMtime: 1 });
    setActiveTab(bId);

    closeTab(aId);

    const state = useStore.getState();
    expect(state.tabs.find((t) => t.id === aId)).toBeUndefined();
    expect(state.activeTabId).toBe(bId);
  });
});
