import { describe, expect, it } from 'vitest';
import { useStore } from './stores/useStore';

describe('tab editor positions', () => {
  it('为每个标签页分别保存两种编辑模式的滚动位置', () => {
    const { addTab, setActiveTab, setWysiwygScrollTop, setSourceScrollTop } = useStore.getState();
    const tabId = addTab({ filePath: 'D:/notes/position.md', content: '# position' });
    setActiveTab(tabId);

    const initialTab = useStore.getState().tabs.find((tab) => tab.id === tabId);
    expect(initialTab?.wysiwygScrollTop).toBe(0);
    expect(initialTab?.sourceScrollTop).toBe(0);

    setWysiwygScrollTop(240);
    setSourceScrollTop(80);

    const tab = useStore.getState().tabs.find((item) => item.id === tabId);
    expect(tab?.wysiwygScrollTop).toBe(240);
    expect(tab?.sourceScrollTop).toBe(80);
  });
});
