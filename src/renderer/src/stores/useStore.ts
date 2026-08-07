import { create } from 'zustand'
import type { Heading, ContentTheme } from '../types'

interface InkMarkState {
  filePath: string | null
  fileName: string
  isDirty: boolean
  theme: 'light' | 'dark'
  contentTheme: ContentTheme
  outline: Heading[]
  outlineWidth: number
  outlineVisible: boolean
  wordCount: number
  charCount: number
  viewMode: 'wysiwyg' | 'source'
  setFilePath: (path: string | null) => void
  setDirty: (dirty: boolean) => void
  setTheme: (theme: 'light' | 'dark') => void
  setContentTheme: (theme: ContentTheme) => void
  setOutline: (headings: Heading[]) => void
  setOutlineWidth: (width: number) => void
  setOutlineVisible: (visible: boolean) => void
  setWordCount: (words: number, chars: number) => void
  setViewMode: (mode: 'wysiwyg' | 'source') => void
  toggleViewMode: () => void
  reset: () => void
}

const savedTheme = (typeof localStorage !== 'undefined' &&
  (localStorage.getItem('inkmark-theme') as 'light' | 'dark')) || 'light'

const savedContentTheme = (typeof localStorage !== 'undefined' &&
  (localStorage.getItem('inkmark-content-theme') as ContentTheme)) || 'inkmark'

const savedOutlineWidth = typeof localStorage !== 'undefined'
  ? parseInt(localStorage.getItem('inkmark-outline-width') || '240', 10)
  : 240

const savedOutlineVisible = typeof localStorage !== 'undefined'
  ? localStorage.getItem('inkmark-outline-visible') !== 'false'
  : true

export const useStore = create<InkMarkState>((set) => ({
  filePath: null,
  fileName: '\u672a\u547d\u540d',
  isDirty: false,
  theme: savedTheme,
  contentTheme: savedContentTheme,
  outline: [],
  outlineWidth: savedOutlineWidth,
  outlineVisible: savedOutlineVisible,
  wordCount: 0,
  charCount: 0,
  viewMode: 'wysiwyg',
  setFilePath: (path) =>
    set({
      filePath: path,
      fileName: path ? path.split(/[/\\]/).pop()! : '\u672a\u547d\u540d',
      isDirty: false
    }),
  setDirty: (dirty) => set({ isDirty: dirty }),
  setTheme: (theme) => {
    localStorage.setItem('inkmark-theme', theme)
    set({ theme })
  },
  setContentTheme: (theme) => {
    localStorage.setItem('inkmark-content-theme', theme)
    set({ contentTheme: theme })
  },
  setOutline: (outline) => set({ outline }),
  setOutlineWidth: (width) => {
    localStorage.setItem('inkmark-outline-width', String(width))
    set({ outlineWidth: width })
  },
  setOutlineVisible: (visible) => {
    localStorage.setItem('inkmark-outline-visible', String(visible))
    set({ outlineVisible: visible })
  },
  setWordCount: (words, chars) => set({ wordCount: words, charCount: chars }),
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleViewMode: () => set((s) => ({ viewMode: s.viewMode === 'wysiwyg' ? 'source' : 'wysiwyg' })),
  reset: () =>
    set({
      filePath: null,
      fileName: '\u672a\u547d\u540d',
      isDirty: false,
      outline: [],
      wordCount: 0,
      charCount: 0
    })
}))