import type { EditorState } from '@milkdown/kit/prose/state';
import type { TextMatch } from './find-replace';

export interface EditorHandle {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
  skipFrontmatterIfSelected: () => void;
  getEditorState: () => EditorState | null;
  setEditorState: (state: EditorState) => void;
  getMarkdownFromState: (state: EditorState) => string;
  scrollToPos: (pos: number) => void;
  getScrollContainer: () => HTMLElement | null;
  getScrollTop: () => number;
  setScrollTop: (top: number) => void;
  undo: () => void;
  redo: () => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleStrike: () => void;
  toggleInlineCode: () => void;
  wrapHeading: (level: number) => void;
  wrapBulletList: () => void;
  wrapOrderedList: () => void;
  wrapTaskList: () => void;
  insertCodeBlock: () => void;
  insertLink: (href: string, title?: string) => void;
  insertTable: () => void;
  findTextMatches: (query: string) => readonly TextMatch[];
  showTextMatches: (matches: readonly TextMatch[], activeIndex: number) => void;
  replaceTextMatch: (match: TextMatch, replacement: string) => boolean;
  replaceAllTextMatches: (matches: readonly TextMatch[], replacement: string) => number;
  focus: () => void;
}

export const editorHandle: { current: EditorHandle | null } = { current: null };
