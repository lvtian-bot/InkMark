import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../stores/useStore';

export function useWordCount() {
  const setWordCount = useStore((s) => s.setWordCount);
  const wordCount = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.wordCount ?? 0);
  const charCount = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.charCount ?? 0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const updateWordCount = useCallback(
    (doc: unknown, immediate = false) => {
      const compute = () => {
        const d = doc as { textContent?: string };
        const text = d?.textContent ?? '';
        const chars = text.length;
        const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        const enWords = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[a-zA-Z0-9]+/g) || []).length;
        setWordCount(cjk + enWords, chars);
      };
      if (immediate) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        compute();
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        compute();
      }, 300);
    },
    [setWordCount],
  );

  return { wordCount, charCount, updateWordCount };
}