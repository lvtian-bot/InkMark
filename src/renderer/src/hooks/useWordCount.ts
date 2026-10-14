import { useCallback, useEffect, useRef } from 'react';
import type { EditorState } from '@codemirror/state';
import { useStore } from '../stores/useStore';
import { resolveDocumentKind } from '../../../shared/openable-document';
import { extractSourceText } from '../source-document';

export function useWordCount() {
  const updateTab = useStore((s) => s.updateTab);
  const wordCount = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.wordCount ?? 0);
  const charCount = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.charCount ?? 0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitCount = useCallback(
    (tabId: string, text: string) => {
      const chars = text.length;
      const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      const enWords = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[a-zA-Z0-9]+/g) || []).length;
      updateTab(tabId, { wordCount: cjk + enWords, charCount: chars });
    },
    [updateTab],
  );

  const scheduleCount = useCallback(
    (text: string, immediate: boolean) => {
      const tabId = useStore.getState().activeTabId;
      if (immediate) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        commitCount(tabId, text);
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        commitCount(tabId, text);
      }, 300);
    },
    [commitCount],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const updateWordCount = useCallback(
    (doc: unknown, immediate = false) => {
      const d = doc as { textContent?: string };
      scheduleCount(d?.textContent ?? '', immediate);
    },
    [scheduleCount],
  );

  const updateSourceWordCount = useCallback(
    (state: EditorState, immediate = false) => {
      // 纯文本/代码文件按字面内容统计：Markdown 提取器会把 YAML 头、
      // 标记符号等当作结构剔除，对文本文件没有意义。
      const isTextDoc = (() => {
        const tab = useStore
          .getState()
          .tabs.find((item) => item.id === useStore.getState().activeTabId);
        return !!tab && resolveDocumentKind(tab.filePath) === 'text';
      })();
      scheduleCount(isTextDoc ? state.doc.toString() : extractSourceText(state), immediate);
    },
    [scheduleCount],
  );

  return { wordCount, charCount, updateWordCount, updateSourceWordCount };
}
