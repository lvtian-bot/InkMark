import { EditorState } from '@codemirror/state';
import { useStore, selectViewMode } from './stores/useStore';
import { editorHandle } from './editor-ref';
import { sourceEditorHandle } from './source-editor-ref';
import { extractSourceHeadings, serializeDoc } from './source-document';
import { extractHeadings } from './hooks/useOutline';
import { headingsFromMarkdown } from './outline-move';
import { editOutlineSection, type OutlineAction } from './outline-edit';

function readContext() {
  const state = useStore.getState();
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab || tab.isStartPage || tab.pendingReviewCount > 0) return null;
  const mode = selectViewMode(state);
  const handle = mode === 'source' ? sourceEditorHandle.current : editorHandle.current;
  if (!handle) return null;

  let doc: string;
  let liveOutline;
  if (mode === 'source') {
    const sourceState = sourceEditorHandle.current?.getEditorState();
    if (!sourceState || sourceState.facet(EditorState.readOnly)) return null;
    doc = serializeDoc(sourceState);
    liveOutline = extractSourceHeadings(sourceState);
  } else {
    const editor = editorHandle.current;
    const editorState = editor?.getEditorState();
    if (!editor || !editorState) return null;
    // 没有待同步输入时保留原始 Markdown（包括引用定义和原有换行）。
    doc = editor.getPendingMarkdown() ?? tab.sourceContent;
    liveOutline = extractHeadings(editorState.doc);
  }
  // 大纲可能尚未刷新；不能仅靠旧序号去修改最新正文中的另一个标题。
  if (
    liveOutline.length !== tab.outline.length ||
    liveOutline.some((item, i) => {
      const displayed = tab.outline[i];
      return (
        item.pos !== displayed.pos || item.level !== displayed.level || item.text !== displayed.text
      );
    })
  )
    return null;
  const headings = headingsFromMarkdown(doc);
  if (
    headings.length !== liveOutline.length ||
    headings.some((item, i) => item.level !== liveOutline[i].level)
  )
    return null;
  return { tabId: tab.id, mode, handle, doc };
}

/** 菜单捕获当前正文；执行时再次核对，切页、切模式、编辑或审阅后旧操作失效。 */
export function prepareOutlineActions(index: number) {
  const original = readContext();
  const results = new Map<OutlineAction, string | null>();
  for (const action of ['delete', 'promote', 'demote'] as const) {
    results.set(action, original ? editOutlineSection(original.doc, index, action) : null);
  }
  return {
    can: (action: OutlineAction): boolean => results.get(action) != null,
    run: (action: OutlineAction): boolean => {
      const next = results.get(action);
      const current = readContext();
      if (
        next == null ||
        !original ||
        !current ||
        current.tabId !== original.tabId ||
        current.mode !== original.mode ||
        current.handle !== original.handle ||
        current.doc !== original.doc
      )
        return false;
      current.handle.replaceDocumentUndoable(next);
      return true;
    },
  };
}
