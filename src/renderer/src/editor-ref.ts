export interface EditorHandle {
  getMarkdown: () => string
  setMarkdown: (md: string) => void
  scrollToPos: (pos: number) => void
  getScrollContainer: () => HTMLElement | null
}

export const editorHandle: { current: EditorHandle | null } = { current: null }
