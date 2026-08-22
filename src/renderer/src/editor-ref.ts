import type { EditorState } from '@milkdown/kit/prose/state';
import type { TextMatch } from './find-replace';

export interface EditorHandle {
  getMarkdown: () => string;
  getSelectedMarkdown: () => string;
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
  /// 删除光标所在的整行（文本块；列表项内容时删除整个列表项）。表格内不执行。
  deleteLine: () => void;
  /// 在光标所在表格指定方向加行/列。
  addTableLine: (kind: 'row' | 'col', position: 'before' | 'after') => void;
  /// 删除光标所在行/列。
  deleteTableLine: (kind: 'row' | 'col') => void;
  /// 删除光标所在表格。
  deleteTableAt: () => void;
  findTextMatches: (query: string) => readonly TextMatch[];
  showTextMatches: (matches: readonly TextMatch[], activeIndex: number) => void;
  replaceTextMatch: (match: TextMatch, replacement: string) => boolean;
  replaceAllTextMatches: (matches: readonly TextMatch[], replacement: string) => number;
  focus: () => void;
}

export const editorHandle: { current: EditorHandle | null } = { current: null };
