import { create } from 'zustand';
import {
  parseThemeId,
  type AppTheme,
  type ContentTheme,
  type Heading,
  type ThemeId,
  type ViewMode,
} from '../types';
import { loadSettings, saveSettings, type AppSettings, type ToolbarWidth } from '../settings';

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

  viewMode: ViewMode;

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
  setThemeId: (themeId: ThemeId) => void;
  setOutlineWidth: (width: number) => void;
  setOutlineVisible: (visible: boolean) => void;
  setToolbarWidth: (width: ToolbarWidth) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
}

const initialSettings = loadSettings();

// themeId 是唯一权威主题字段；theme/contentTheme 仅为派生值，供需要明暗或排版风格
// 的组件读取（CSS 仍依赖 data-theme 与 theme-${contentTheme} class）。
export const selectAppTheme = (s: AppSettings): AppTheme => parseThemeId(s.themeId).theme;
export const selectContentTheme = (s: AppSettings): ContentTheme =>
  parseThemeId(s.themeId).contentTheme;

function selectSettings(state: AppSettings): AppSettings {
  return {
    themeId: state.themeId,
    outlineWidth: state.outlineWidth,
    outlineVisible: state.outlineVisible,
    toolbarWidth: state.toolbarWidth,
    startPageOnLaunch: state.startPageOnLaunch,
  };
}

let tabIdCounter = 0;
function nextTabId(): string {
  return `tab-${Date.now()}-${tabIdCounter++}`;
}

function createTab(
  init?: {
    filePath?: string | null;
    content?: string;
    fileMtime?: number | null;
  },
  startPageOnLaunch: boolean = initialSettings.startPageOnLaunch,
): Tab {
  const filePath = init?.filePath ?? null;
  const isStartPage = filePath ? false : startPageOnLaunch;
  return {
    id: nextTabId(),
    filePath,
    fileName: filePath
      ? filePath.split(/[/\\]/).pop()!
      : isStartPage
        ? '欢迎'
        : '新建文档',
    isDirty: false,
    isStartPage,
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
    const tab = createTab(init, true);
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
        const newTab = createTab(undefined, true);
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
    get().updateTab(get().activeTabId, {
      isStartPage: startPage,
      fileName: startPage ? '欢迎' : '新建文档',
    });
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

  setThemeId: (themeId) => {
    set(saveSettings({ ...selectSettings(get()), themeId }));
  },

  setOutlineWidth: (width) => {
    set(saveSettings({ ...selectSettings(get()), outlineWidth: width }));
  },

  setOutlineVisible: (visible) => {
    set(saveSettings({ ...selectSettings(get()), outlineVisible: visible }));
  },
  setToolbarWidth: (toolbarWidth) => {
    set(saveSettings({ ...selectSettings(get()), toolbarWidth }));
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  toggleViewMode: () => set((s) => ({ viewMode: s.viewMode === 'wysiwyg' ? 'source' : 'wysiwyg' })),
}));
