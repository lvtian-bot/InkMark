import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToggleViewModeThrottleForTesting, useStore } from './stores/useStore';

describe('useStore addTab', () => {
  // store 是模块级单例，测试间共享状态；记录初始状态，每个用例结束后恢复，
  // 避免本组用例新增的标签页污染其它用例对「初始仅一个标签页」的假设。
  const initialState = {
    tabs: useStore.getState().tabs,
    activeTabId: useStore.getState().activeTabId,
  };

  afterEach(() => {
    useStore.setState(initialState);
  });

  it('addTab({ startPage: false }) 创建跳过开始页的空白文档标签', () => {
    const { addTab } = useStore.getState();
    const tabId = addTab({ startPage: false });

    const state = useStore.getState();
    const tab = state.tabs.find((t) => t.id === tabId);
    expect(tab).toBeDefined();
    expect(tab!.isStartPage).toBe(false);
    expect(tab!.filePath).toBeNull();
    expect(tab!.sourceContent).toBe('');
    expect(state.activeTabId).toBe(tabId);
  });

  it('缺省 addTab() 仍创建开始页标签', () => {
    const { addTab } = useStore.getState();
    const tabId = addTab();

    const state = useStore.getState();
    const tab = state.tabs.find((t) => t.id === tabId);
    expect(tab!.isStartPage).toBe(true);
  });

  it('externalUpdatePending 默认为 false，且 updateTab 可置位（外部改动提示条状态）', () => {
    const { addTab, updateTab } = useStore.getState();
    const tabId = addTab({ startPage: false });
    const tab = useStore.getState().tabs.find((t) => t.id === tabId);
    expect(tab!.externalUpdatePending).toBe(false);

    updateTab(tabId, { externalUpdatePending: true });
    expect(useStore.getState().tabs.find((t) => t.id === tabId)!.externalUpdatePending).toBe(true);
  });
});

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

describe('useStore toggleViewMode', () => {
  beforeEach(() => {
    resetToggleViewModeThrottleForTesting();
  });

  it('正常切换 viewMode', () => {
    useStore.setState({ viewMode: 'wysiwyg' });
    const { toggleViewMode } = useStore.getState();
    toggleViewMode();
    expect(useStore.getState().viewMode).toBe('source');
  });

  it('短时间内重复触发（如 DOM keydown 与原生菜单 accelerator 双重派发）只执行一次', () => {
    useStore.setState({ viewMode: 'wysiwyg' });
    const { toggleViewMode } = useStore.getState();
    toggleViewMode();
    // 毫秒内紧接着的第二次调用被防抖过滤
    toggleViewMode();
    expect(useStore.getState().viewMode).toBe('source');
  });
});

describe('useStore toolbarVisible', () => {
  it('默认 toolbarVisible 为 true，并可通过 setToolbarVisible 切换', () => {
    const { setToolbarVisible } = useStore.getState();
    expect(useStore.getState().toolbarVisible).toBe(true);

    setToolbarVisible(false);
    expect(useStore.getState().toolbarVisible).toBe(false);

    setToolbarVisible(true);
    expect(useStore.getState().toolbarVisible).toBe(true);
  });
});
