import type { EditorState as SourceEditorState } from '@codemirror/state';
import type { EditorState as WysiwygEditorState } from '@milkdown/kit/prose/state';
import { createDocumentEditorState } from './document-editor-state';

export const editorStateCache = createDocumentEditorState<{
  source: SourceEditorState;
  wysiwyg: WysiwygEditorState;
}>();
