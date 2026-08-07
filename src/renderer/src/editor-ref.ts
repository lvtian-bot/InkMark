import type { EditorState } from "@milkdown/kit/prose/state"

export interface EditorHandle {
  getMarkdown: () => string
  setMarkdown: (md: string) => void
  getEditorState: () => EditorState | null
  setEditorState: (state: EditorState) => void
  getMarkdownFromState: (state: EditorState) => string
  scrollToPos: (pos: number) => void
  getScrollContainer: () => HTMLElement | null
  getScrollTop: () => number
  setScrollTop: (top: number) => void
}

export const editorHandle: { current: EditorHandle | null } = { current: null }