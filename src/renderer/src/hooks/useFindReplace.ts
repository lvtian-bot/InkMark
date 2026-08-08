import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { editorHandle } from '../editor-ref';
import {
  findLiteralMatches,
  findMatchAtOrAfter,
  stepMatchIndex,
  type TextMatch,
} from '../find-replace';
import type { ViewMode } from '../types';

interface UseFindReplaceOptions {
  activeTabId: string;
  sourceRef: RefObject<HTMLTextAreaElement>;
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

function replaceTextareaSelection(
  textarea: HTMLTextAreaElement,
  match: TextMatch,
  replacement: string,
): void {
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(match.from, match.to);

  if (document.execCommand('insertText', false, replacement)) return;

  textarea.setRangeText(replacement, match.from, match.to, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function replaceAllTextareaMatches(
  textarea: HTMLTextAreaElement,
  matches: readonly TextMatch[],
  replacement: string,
): void {
  if (matches.length === 0) return;

  let nextValue = textarea.value;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    nextValue = nextValue.slice(0, match.from) + replacement + nextValue.slice(match.to);
  }

  textarea.focus({ preventScroll: true });
  textarea.select();
  if (document.execCommand('insertText', false, nextValue)) return;

  textarea.setRangeText(nextValue, 0, textarea.value.length, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
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

function createSourceAdapter(
  getTextarea: () => HTMLTextAreaElement | null,
  focusQueryInput: () => void,
): FindReplaceAdapter {
  return {
    clear: () => editorHandle.current?.showTextMatches([], -1),
    find: (query) => findLiteralMatches(getTextarea()?.value ?? '', query),
    focus: () => getTextarea()?.focus(),
    replaceAll: (matches, replacement) => {
      const textarea = getTextarea();
      if (textarea) replaceAllTextareaMatches(textarea, matches, replacement);
    },
    replaceCurrent: (match, replacement) => {
      const textarea = getTextarea();
      if (textarea) replaceTextareaSelection(textarea, match, replacement);
    },
    select: (match) => {
      editorHandle.current?.showTextMatches([], -1);
      const textarea = getTextarea();
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(match.from, match.to);
      requestAnimationFrame(focusQueryInput);
    },
  };
}

export function useFindReplace({
  activeTabId,
  sourceRef,
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
  const getSourceTextarea = useCallback(() => sourceRef.current, [sourceRef]);
  const focusQueryInput = useCallback(
    () => queryInputRef.current?.focus({ preventScroll: true }),
    [],
  );

  useEffect(() => {
    adapterRef.current =
      viewMode === 'wysiwyg'
        ? createWysiwygAdapter()
        : createSourceAdapter(getSourceTextarea, focusQueryInput);
  }, [focusQueryInput, getSourceTextarea, viewMode]);

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
