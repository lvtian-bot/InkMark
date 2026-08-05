import { create } from 'zustand'
import type { Heading } from '../types'

interface InkMarkState {
  filePath: string | null
  fileName: string
  isDirty: boolean
  theme: 'light' | 'dark'
  outline: Heading[]
  hasContent: boolean
  setFilePath: (path: string | null) => void
  setDirty: (dirty: boolean) => void
  setTheme: (theme: 'light' | 'dark') => void
  setOutline: (headings: Heading[]) => void
  setHasContent: (hasContent: boolean) => void
  reset: () => void
}

const savedTheme = (typeof localStorage !== 'undefined' &&
  (localStorage.getItem('inkmark-theme') as 'light' | 'dark')) || 'light'

export const useStore = create<InkMarkState>((set) => ({
  filePath: null,
  fileName: '\u672a\u547d\u540d',
  isDirty: false,
  theme: savedTheme,
  outline: [],
  hasContent: false,
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
  setOutline: (outline) => set({ outline }),
  setHasContent: (hasContent) => set({ hasContent }),
  reset: () =>
    set({
      filePath: null,
      fileName: '\u672a\u547d\u540d',
      isDirty: false,
      outline: [],
      hasContent: false
    })
}))
