import { create } from 'zustand';
import type { Heading, ContentTheme } from '../types';
import { loadSettings, saveSettings, type AppSettings, type AppTheme } from '../settings';

export interface Tab {
  id: string;
  filePath: string | null;
  fileName: string;
  isDirty: boolean;
  isStartPage: boolean;
  outline: Heading[];
  wordCount: number;
  charCount: number;
  sourceContent: string;
  scrollTop: number;
  fileMtime: number | null;
}

interface InkMarkState extends AppSettings {
  tabs: Tab[];
  activeTabId: string;

  viewMode: 'wysiwyg' | 'source';

  addTab: (init?: {
    filePath?: string | null;
    content?: string;
    fileMtime?: number | null;
  }) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Omit<Tab, 'id'>>) => void;

  setFilePath: (path: string | null) => void;
  setDirty: (dirty: boolean) => void;
  setStartPage: (startPage: boolean) => void;
  setOutline: (outline: Heading[]) => void;
  setWordCount: (words: number, chars: number) => void;
  setSourceContent: (content: string) => void;
  setScrollTop: (top: number) => void;

  applySettings: (settings: AppSettings) => void;
  setTheme: (theme: AppTheme) => void;
  setContentTheme: (theme: ContentTheme) => void;
  setOutlineWidth: (width: number) => void;
  setOutlineVisible: (visible: boolean) => void;
  setViewMode: (mode: 'wysiwyg' | 'source') => void;
  toggleViewMode: () => void;
}

const initialSettings = loadSettings();

function selectSettings(state: AppSettings): AppSettings {
  return {
    theme: state.theme,
    contentTheme: state.contentTheme,
    outlineWidth: state.outlineWidth,
    outlineVisible: state.outlineVisible,
  };
}

let tabIdCounter = 0;
function nextTabId(): string {
  return `tab-${Date.now()}-${tabIdCounter++}`;
}

function createTab(init?: {
  filePath?: string | null;
  content?: string;
  fileMtime?: number | null;
}): Tab {
  const filePath = init?.filePath ?? null;
  return {
    id: nextTabId(),
    filePath,
    fileName: filePath ? filePath.split(/[/\\]/).pop()! : '新建文档',
    isDirty: false,
    isStartPage: !filePath,
    outline: [],
    wordCount: 0,
    charCount: 0,
    sourceContent: init?.content ?? '',
    scrollTop: 0,
    fileMtime: init?.fileMtime ?? null,
  };
}

const initialTab = createTab();

export const useStore = create<InkMarkState>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,

  ...initialSettings,
  viewMode: 'wysiwyg',

  addTab: (init) => {
    const tab = createTab(init);
    set({
      tabs: [...get().tabs, tab],
      activeTabId: tab.id,
    });
    return tab.id;
  },

  closeTab: (id) => {
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return state;
      const tabs = state.tabs.filter((t) => t.id !== id);

      if (tabs.length === 0) {
        const newTab = createTab();
        return {
          tabs: [newTab],
          activeTabId: newTab.id,
        };
      }

      if (id === state.activeTabId) {
        const newActive = tabs[Math.min(idx, tabs.length - 1)];
        return {
          tabs,
          activeTabId: newActive.id,
        };
      }

      return { tabs };
    });
  },

  setActiveTab: (id) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return state;
      return {
        activeTabId: id,
      };
    });
  },

  updateTab: (id, updates) => {
    set((state) => {
      const tabs = state.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t));
      return { tabs };
    });
  },

  setFilePath: (path) => {
    get().updateTab(get().activeTabId, {
      filePath: path,
      fileName: path ? path.split(/[/\\]/).pop()! : '未命名',
      isDirty: false,
      isStartPage: false,
    });
  },

  setDirty: (dirty) => {
    get().updateTab(get().activeTabId, { isDirty: dirty });
  },

  setStartPage: (startPage) => {
    get().updateTab(get().activeTabId, { isStartPage: startPage });
  },

  setOutline: (outline) => {
    get().updateTab(get().activeTabId, { outline });
  },

  setWordCount: (words, chars) => {
    get().updateTab(get().activeTabId, { wordCount: words, charCount: chars });
  },

  setSourceContent: (content) => {
    get().updateTab(get().activeTabId, { sourceContent: content });
  },

  setScrollTop: (top) => {
    get().updateTab(get().activeTabId, { scrollTop: top });
  },

  applySettings: (settings) => {
    set(saveSettings(settings));
  },

  setTheme: (theme) => {
    set(saveSettings({ ...selectSettings(get()), theme }));
  },

  setContentTheme: (theme) => {
    set(saveSettings({ ...selectSettings(get()), contentTheme: theme }));
  },

  setOutlineWidth: (width) => {
    set(saveSettings({ ...selectSettings(get()), outlineWidth: width }));
  },

  setOutlineVisible: (visible) => {
    set(saveSettings({ ...selectSettings(get()), outlineVisible: visible }));
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  toggleViewMode: () => set((s) => ({ viewMode: s.viewMode === 'wysiwyg' ? 'source' : 'wysiwyg' })),
}));
