import { useCallback } from 'react';
import { useStore } from '../stores/useStore';

export function useWordCount() {
  const setWordCount = useStore((s) => s.setWordCount);
  const wordCount = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.wordCount ?? 0);
  const charCount = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.charCount ?? 0);

  const updateWordCount = useCallback(
    (doc: unknown) => {
      const d = doc as { textContent?: string };
      const text = d?.textContent ?? '';
      const chars = text.length;
      const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      const enWords = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[a-zA-Z0-9]+/g) || []).length;
      setWordCount(cjk + enWords, chars);
    },
    [setWordCount],
  );

  return { wordCount, charCount, updateWordCount };
}
