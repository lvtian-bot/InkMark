import { create } from 'zustand';
import type { Heading, ContentTheme } from '../types';

export interface Tab {
  id: string;
  filePath: string | null;
  fileName: string;
  isDirty: boolean;
  outline: Heading[];
  wordCount: number;
  charCount: number;
  sourceContent: string;
  scrollTop: number;
  fileMtime: number | null;
}

interface InkMarkState {
  tabs: Tab[];
  activeTabId: string;

  theme: 'light' | 'dark';
  contentTheme: ContentTheme;
  outlineWidth: number;
  outlineVisible: boolean;
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
  setOutline: (outline: Heading[]) => void;
  setWordCount: (words: number, chars: number) => void;
  setSourceContent: (content: string) => void;
  setScrollTop: (top: number) => void;

  setTheme: (theme: 'light' | 'dark') => void;
  setContentTheme: (theme: ContentTheme) => void;
  setOutlineWidth: (width: number) => void;
  setOutlineVisible: (visible: boolean) => void;
  setViewMode: (mode: 'wysiwyg' | 'source') => void;
  toggleViewMode: () => void;
}

const savedTheme =
  (typeof localStorage !== 'undefined' &&
    (localStorage.getItem('inkmark-theme') as 'light' | 'dark')) ||
  'light';

const savedContentTheme =
  (typeof localStorage !== 'undefined' &&
    (localStorage.getItem('inkmark-content-theme') as ContentTheme)) ||
  'inkmark';

const savedOutlineWidth =
  typeof localStorage !== 'undefined'
    ? parseInt(localStorage.getItem('inkmark-outline-width') || '240', 10)
    : 240;

const savedOutlineVisible =
  typeof localStorage !== 'undefined'
    ? localStorage.getItem('inkmark-outline-visible') !== 'false'
    : true;

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
    fileName: filePath ? filePath.split(/[/\\]/).pop()! : '未命名',
    isDirty: false,
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

  theme: savedTheme,
  contentTheme: savedContentTheme,
  outlineWidth: savedOutlineWidth,
  outlineVisible: savedOutlineVisible,
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
    });
  },

  setDirty: (dirty) => {
    get().updateTab(get().activeTabId, { isDirty: dirty });
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

  setTheme: (theme) => {
    localStorage.setItem('inkmark-theme', theme);
    set({ theme });
  },

  setContentTheme: (theme) => {
    localStorage.setItem('inkmark-content-theme', theme);
    set({ contentTheme: theme });
  },

  setOutlineWidth: (width) => {
    localStorage.setItem('inkmark-outline-width', String(width));
    set({ outlineWidth: width });
  },

  setOutlineVisible: (visible) => {
    localStorage.setItem('inkmark-outline-visible', String(visible));
    set({ outlineVisible: visible });
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  toggleViewMode: () => set((s) => ({ viewMode: s.viewMode === 'wysiwyg' ? 'source' : 'wysiwyg' })),
}));
