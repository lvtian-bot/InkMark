import type { EditorState } from '@codemirror/state';

export interface SourceSelection {
  from: number;
  to: number;
}

/// Handle for the CodeMirror 6 source editor, mirroring the role of
/// `editorHandle` for the WYSIWYG editor.  Consumers (App, useFile,
/// useFindReplace, Toolbar) talk to the source editor exclusively through this
/// interface so the underlying engine can be swapped without touching call
/// sites.
export interface SourceEditorHandle {
  /// Current full document text.
  getValue: () => string;
  getEditorState: () => EditorState;
  setEditorState: (state: EditorState) => void;
  /// Replace the whole document.  Used when switching tabs / reloading from
  /// disk.  Does NOT fire the user-edit callback path - callers set the store
  /// themselves.
  setValue: (value: string) => void;
  /// Focus the editor.
  focus: () => void;
  /// Current selection as character offsets.
  getSelection: () => SourceSelection;
  /// Set selection (caret when from === to) and focus.
  setSelection: (from: number, to: number) => void;
  /// Current CodeMirror scroll position.
  getScrollTop: () => number;
  /// Restore CodeMirror scroll position.
  setScrollTop: (top: number) => void;
  /// Replace [from, to) with `text`, place caret after the inserted text, and
  /// dispatch a transaction that is treated as a user edit (fires onChange).
  replaceRange: (from: number, to: number, text: string) => void;
  /// Replace [from, to) with `text` WITHOUT firing the normal change callback.
  /// Used by find/replace which manages its own dirty/refresh signalling.
  replaceRangeQuiet: (from: number, to: number, text: string) => void;
  notifyChange: () => void;
  /// Undo / redo (history is managed by CodeMirror).
  undo: () => void;
  redo: () => void;
}

export const sourceEditorHandle: { current: SourceEditorHandle | null } = { current: null };
