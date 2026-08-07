import type { EditorState } from "@milkdown/kit/prose/state"

const cache = new Map<string, EditorState>()

export const editorStateCache = {
  get(id: string): EditorState | undefined {
    return cache.get(id)
  },
  set(id: string, state: EditorState): void {
    cache.set(id, state)
  },
  has(id: string): boolean {
    return cache.has(id)
  },
  delete(id: string): void {
    cache.delete(id)
  }
}