export type DocumentEditorMode = 'wysiwyg' | 'source';

interface Snapshot<State> {
  markdown: string;
  state: State;
}

type EditorStates = Record<DocumentEditorMode, unknown>;

export interface DocumentEditorState<States extends EditorStates> {
  capture: <Mode extends DocumentEditorMode>(
    tabId: string,
    mode: Mode,
    markdown: string,
    state: States[Mode],
  ) => void;
  restore: <Mode extends DocumentEditorMode>(
    tabId: string,
    mode: Mode,
    markdown: string,
  ) => States[Mode] | undefined;
  disposeMode: (tabId: string, mode: DocumentEditorMode) => void;
  dispose: (tabId: string) => void;
}

export function createDocumentEditorState<
  States extends EditorStates,
>(): DocumentEditorState<States> {
  type SnapshotByMode = { [Mode in DocumentEditorMode]?: Snapshot<States[Mode]> };
  const snapshots = new Map<string, SnapshotByMode>();

  return {
    capture(tabId, mode, markdown, state) {
      const tabSnapshots = snapshots.get(tabId) ?? {};
      tabSnapshots[mode] = { markdown, state } as SnapshotByMode[typeof mode];
      snapshots.set(tabId, tabSnapshots);
    },

    restore(tabId, mode, markdown) {
      const tabSnapshots = snapshots.get(tabId);
      const snapshot = tabSnapshots?.[mode] as Snapshot<States[typeof mode]> | undefined;
      if (!snapshot) return undefined;
      if (snapshot.markdown === markdown) return snapshot.state;

      delete tabSnapshots?.[mode];
      if (tabSnapshots && !tabSnapshots.source && !tabSnapshots.wysiwyg) snapshots.delete(tabId);
      return undefined;
    },

    disposeMode(tabId, mode) {
      const tabSnapshots = snapshots.get(tabId);
      if (!tabSnapshots) return;
      delete tabSnapshots[mode];
      if (!tabSnapshots.source && !tabSnapshots.wysiwyg) snapshots.delete(tabId);
    },

    dispose(tabId) {
      snapshots.delete(tabId);
    },
  };
}
