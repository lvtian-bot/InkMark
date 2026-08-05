import { create } from 'zustand'
import type { Heading } from '../types'

interface InkMarkState {
  filePath: string | null
  fileName: string
  isDirty: boolean
  theme: 'light' | 'dark'
  outline: Heading[]
  outlineWidth: number
  outlineVisible: boolean
  setFilePath: (path: string | null) => void
  setDirty: (dirty: boolean) => void
  setTheme: (theme: 'light' | 'dark') => void
  setOutline: (headings: Heading[]) => void
  setOutlineWidth: (width: number) => void
  setOutlineVisible: (visible: boolean) => void
  reset: () => void
}

const savedTheme = (typeof localStorage !== 'undefined' &&
  (localStorage.getItem('inkmark-theme') as 'light' | 'dark')) || 'light'

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
  outline: [],
  outlineWidth: savedOutlineWidth,
  outlineVisible: savedOutlineVisible,
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
  setOutlineWidth: (width) => {
    localStorage.setItem('inkmark-outline-width', String(width))
    set({ outlineWidth: width })
  },
  setOutlineVisible: (visible) => {
    localStorage.setItem('inkmark-outline-visible', String(visible))
    set({ outlineVisible: visible })
  },
  reset: () =>
    set({
      filePath: null,
      fileName: '\u672a\u547d\u540d',
      isDirty: false,
      outline: []
    })
}))
