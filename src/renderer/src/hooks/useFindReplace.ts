import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { editorHandle } from '../editor-ref';
import { sourceEditorHandle } from '../source-editor-ref';
import {
  findLiteralMatches,
  findMatchAtOrAfter,
  stepMatchIndex,
  type TextMatch,
} from '../find-replace';
import type { ViewMode } from '../types';

interface UseFindReplaceOptions {
  activeTabId: string;
  viewMode: ViewMode;
}

interface FindReplaceAdapter {
  clear: () => void;
  find: (query: string) => readonly TextMatch[];
  focus: () => void;
  replaceAll: (matches: readonly TextMatch[], replacement: string) => void;
  replaceCurrent: (match: TextMatch, replacement: string) => void;
  select: (match: TextMatch, matches: readonly TextMatch[], selectedIndex: number) => void;
}

export interface FindReplaceController {
  activeIndex: number;
  close: () => void;
  isOpen: boolean;
  matchCount: number;
  next: () => void;
  notifyContentChanged: () => void;
  open: (withReplace: boolean) => void;
  previous: () => void;
  query: string;
  queryInputRef: RefObject<HTMLInputElement>;
  replaceAll: () => void;
  replaceCurrent: () => void;
  replacement: string;
  setQuery: (value: string) => void;
  setReplacement: (value: string) => void;
  showReplace: boolean;
}

function createWysiwygAdapter(): FindReplaceAdapter {
  return {
    clear: () => editorHandle.current?.showTextMatches([], -1),
    find: (query) => editorHandle.current?.findTextMatches(query) ?? [],
    focus: () => editorHandle.current?.focus(),
    replaceAll: (matches, replacement) => {
      editorHandle.current?.replaceAllTextMatches(matches, replacement);
    },
    replaceCurrent: (match, replacement) => {
      editorHandle.current?.replaceTextMatch(match, replacement);
    },
    select: (_match, matches, selectedIndex) => {
      editorHandle.current?.showTextMatches(matches, selectedIndex);
    },
  };
}

function createSourceAdapter(focusQueryInput: () => void): FindReplaceAdapter {
  return {
    clear: () => editorHandle.current?.showTextMatches([], -1),
    find: (query) => findLiteralMatches(sourceEditorHandle.current?.getValue() ?? '', query),
    focus: () => sourceEditorHandle.current?.focus(),
    replaceAll: (matches, replacement) => {
      const handle = sourceEditorHandle.current;
      if (!handle || matches.length === 0) return;
      // 从后往前逐处替换，避免前面的偏移影响后面 match 的位置。用 quiet 写入
      // 不触发 onChange：替换后由调用方统一 refresh 刷新匹配。
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index];
        handle.replaceRangeQuiet(match.from, match.to, replacement);
      }
    },
    replaceCurrent: (match, replacement) => {
      sourceEditorHandle.current?.replaceRangeQuiet(match.from, match.to, replacement);
    },
    select: (match) => {
      editorHandle.current?.showTextMatches([], -1);
      const handle = sourceEditorHandle.current;
      if (!handle) return;
      handle.setSelection(match.from, match.to);
      requestAnimationFrame(focusQueryInput);
    },
  };
}

export function useFindReplace({
  activeTabId,
  viewMode,
}: UseFindReplaceOptions): FindReplaceController {
  const [isOpen, setIsOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [query, setQueryState] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matches, setMatches] = useState<readonly TextMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [contentRevision, setContentRevision] = useState(0);

  const queryInputRef = useRef<HTMLInputElement>(null);
  const isOpenRef = useRef(isOpen);
  const queryRef = useRef(query);
  const matchesRef = useRef(matches);
  const activeIndexRef = useRef(activeIndex);
  const activeMatchRef = useRef<TextMatch | null>(null);
  const contextRef = useRef(`${activeTabId}:${viewMode}`);
  const adapterRef = useRef<FindReplaceAdapter>(createWysiwygAdapter());
  const focusQueryInput = useCallback(
    () => queryInputRef.current?.focus({ preventScroll: true }),
    [],
  );

  useEffect(() => {
    adapterRef.current =
      viewMode === 'wysiwyg'
        ? createWysiwygAdapter()
        : createSourceAdapter(focusQueryInput);
  }, [focusQueryInput, viewMode]);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const refresh = useCallback((): void => {
    const adapter = adapterRef.current;
    const currentContext = `${activeTabId}:${viewMode}`;
    if (contextRef.current !== currentContext) {
      contextRef.current = currentContext;
      activeMatchRef.current = null;
    }

    const nextMatches = queryRef.current ? adapter.find(queryRef.current) : [];
    const previousAnchor = activeMatchRef.current?.from ?? 0;
    const nextIndex = nextMatches.length ? findMatchAtOrAfter(nextMatches, previousAnchor) : -1;
    const nextActiveMatch = nextIndex >= 0 ? nextMatches[nextIndex] : null;

    matchesRef.current = nextMatches;
    activeIndexRef.current = nextIndex;
    activeMatchRef.current = nextActiveMatch;
    setMatches(nextMatches);
    setActiveIndex(nextIndex);

    if (nextActiveMatch) {
      adapter.select(nextActiveMatch, nextMatches, nextIndex);
    } else {
      adapter.clear();
    }
  }, [activeTabId, viewMode]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(refresh);
    return () => cancelAnimationFrame(frame);
  }, [activeTabId, contentRevision, isOpen, query, refresh, viewMode]);

  const open = useCallback((withReplace: boolean): void => {
    setIsOpen(true);
    setShowReplace(withReplace);
    requestAnimationFrame(() => {
      queryInputRef.current?.focus({ preventScroll: true });
      queryInputRef.current?.select();
    });
  }, []);

  const close = useCallback((): void => {
    setIsOpen(false);
    setMatches([]);
    setActiveIndex(-1);
    matchesRef.current = [];
    activeIndexRef.current = -1;
    activeMatchRef.current = null;
    adapterRef.current.clear();
    adapterRef.current.focus();
  }, []);

  const setQuery = useCallback((value: string): void => {
    queryRef.current = value;
    activeMatchRef.current = null;
    setQueryState(value);
  }, []);

  const step = useCallback((direction: 1 | -1): void => {
    const nextIndex = stepMatchIndex(matchesRef.current.length, activeIndexRef.current, direction);
    if (nextIndex < 0) return;

    const nextMatch = matchesRef.current[nextIndex];
    activeIndexRef.current = nextIndex;
    activeMatchRef.current = nextMatch;
    setActiveIndex(nextIndex);
    adapterRef.current.select(nextMatch, matchesRef.current, nextIndex);
  }, []);

  const previous = useCallback(() => step(-1), [step]);
  const next = useCallback(() => step(1), [step]);

  const notifyContentChanged = useCallback((): void => {
    if (isOpenRef.current) setContentRevision((revision) => revision + 1);
  }, []);

  const replaceCurrent = useCallback((): void => {
    const match = activeMatchRef.current;
    if (!match) return;

    adapterRef.current.replaceCurrent(match, replacement);

    const nextAnchor = match.from + replacement.length;
    activeMatchRef.current = { from: nextAnchor, to: nextAnchor };
    requestAnimationFrame(refresh);
    requestAnimationFrame(() => queryInputRef.current?.focus({ preventScroll: true }));
  }, [refresh, replacement]);

  const replaceAll = useCallback((): void => {
    const currentMatches = matchesRef.current;
    if (currentMatches.length === 0) return;

    adapterRef.current.replaceAll(currentMatches, replacement);

    activeMatchRef.current = null;
    requestAnimationFrame(refresh);
    requestAnimationFrame(() => queryInputRef.current?.focus({ preventScroll: true }));
  }, [refresh, replacement]);

  return {
    activeIndex,
    close,
    isOpen,
    matchCount: matches.length,
    next,
    notifyContentChanged,
    open,
    previous,
    query,
    queryInputRef,
    replaceAll,
    replaceCurrent,
    replacement,
    setQuery,
    setReplacement,
    showReplace,
  };
}
