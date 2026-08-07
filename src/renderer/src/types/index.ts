export interface Heading {
  id: string
  level: number
  text: string
  pos: number
}

export interface FileResult {
  path: string
  content: string
}

export type ContentTheme = 'inkmark' | 'github'

export interface InkMarkAPI {
  openFileDialog: () => Promise<FileResult | null>
  saveFile: (content: string, path: string) => Promise<void>
  saveFileAs: (content: string) => Promise<string | null>
  openFilePath: (path: string) => Promise<FileResult>
  onOpenFilePath: (cb: (path: string) => void) => void
  onMenuNew: (cb: () => void) => void
  onMenuOpen: (cb: () => void) => void
  onMenuSave: (cb: () => void) => void
  onMenuSaveAs: (cb: () => void) => void
  onMenuSetTheme: (cb: (themeId: string) => void) => void
  onMenuClose: (cb: () => void) => void
  setWindowTitle: (title: string) => Promise<void>
  closeWindow: () => Promise<void>
  confirmDialog: (title: string, message: string, buttons: string[]) => Promise<number>
  syncThemeId: (themeId: string) => void
  platform: string
}

declare global {
  interface Window {
    inkmark: InkMarkAPI
  }
}