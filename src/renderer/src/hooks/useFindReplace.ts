import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { editorHandle } from '../editor-ref';
import { sourceEditorHandle } from '../source-editor-ref';
import {
  expandReplacement,
  findMatchAtOrAfter,
  findTextMatches,
  stepMatchIndex,
  type TextMatch,
} from '../find-replace';
import type { ViewMode } from '../types';

interface UseFindReplaceOptions {
  activeTabId: string;
  viewMode: ViewMode;
}

interface Range {
  from: number;
  to: number;
}

interface Segment {
  from: number;
  text: string;
}

export interface FindReplaceController {
  activeIndex: number;
  canSearchInSelection: boolean;
  close: () => void;
  inSelection: boolean;
  isOpen: boolean;
  matchCase: boolean;
  matchCount: number;
  next: () => void;
  notifyContentChanged: () => void;
  open: (withReplace: boolean) => void;
  previous: () => void;
  query: string;
  queryInputRef: RefObject<HTMLInputElement>;
  regexError: boolean;
  replaceAll: () => void;
  replaceCurrent: () => void;
  replacement: string;
  setInSelection: (value: boolean) => void;
  setMatchCase: (value: boolean) => void;
  setQuery: (value: string) => void;
  setReplacement: (value: string) => void;
  setUseRegex: (value: boolean) => void;
  setWholeWord: (value: boolean) => void;
  showReplace: boolean;
  useRegex: boolean;
  wholeWord: boolean;
}

export function useFindReplace({
  activeTabId,
  viewMode,
}: UseFindReplaceOptions): FindReplaceController {
  const [isOpen, setIsOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [inSelection, setSelectionMode] = useState(false);
  const [canSearchInSelection, setCanSearchInSelection] = useState(false);
  const [regexError, setRegexError] = useState(false);
  const [matches, setMatches] = useState<readonly TextMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [contentRevision, setContentRevision] = useState(0);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const selectedScope = useRef<Range | null>(null);
  const scopeSnapshot = useRef('');
  const scopeInvalid = useRef(false);
  const activeMatch = useRef<TextMatch | null>(null);
  const matchesRef = useRef<readonly TextMatch[]>([]);
  const indexRef = useRef(-1);
  const openRef = useRef(false);
  const contextRef = useRef(`${activeTabId}:${viewMode}`);

  const segments = useCallback((): readonly Segment[] => {
    if (viewMode === 'wysiwyg') return editorHandle.current?.getFindSegments() ?? [];
    return [{ from: 0, text: sourceEditorHandle.current?.getDocText() ?? '' }];
  }, [viewMode]);
  const snapshot = useCallback(() => JSON.stringify(segments()), [segments]);
  const showScope = useCallback(
    (scope: Range | null) => {
      if (viewMode === 'wysiwyg') editorHandle.current?.showFindScope(scope);
      else sourceEditorHandle.current?.showFindScope(scope);
    },
    [viewMode],
  );
  const clear = useCallback(() => {
    editorHandle.current?.showTextMatches([], -1);
    sourceEditorHandle.current?.showFindMatches([], -1);
  }, []);
  const select = useCallback(
    (match: TextMatch, all: readonly TextMatch[], index: number) => {
      if (viewMode === 'wysiwyg') {
        editorHandle.current?.showTextMatches(all, index);
      } else {
        clear();
        sourceEditorHandle.current?.showFindMatches(all, index);
        sourceEditorHandle.current?.setSelection(match.from, match.to);
        requestAnimationFrame(() => queryInputRef.current?.focus({ preventScroll: true }));
      }
    },
    [clear, viewMode],
  );

  const compute = useCallback(() => {
    const options = { caseSensitive: matchCase, wholeWord, regex: useRegex };
    const validation = findTextMatches('', query, options);
    if (validation.invalidPattern) return { matches: [], invalidPattern: true };
    if (
      inSelection &&
      (scopeInvalid.current || !selectedScope.current || snapshot() !== scopeSnapshot.current)
    ) {
      scopeInvalid.current = true;
      return { matches: [], invalidPattern: false };
    }
    const found: TextMatch[] = [];
    for (const segment of segments()) {
      const result = findTextMatches(segment.text, query, options);
      for (const match of result.matches) {
        const mapped = { ...match, from: match.from + segment.from, to: match.to + segment.from };
        const scope = selectedScope.current;
        if (!inSelection || (scope && mapped.from >= scope.from && mapped.to <= scope.to))
          found.push(mapped);
      }
    }
    return { matches: found, invalidPattern: false };
  }, [inSelection, matchCase, query, segments, snapshot, useRegex, wholeWord]);

  const refresh = useCallback(() => {
    const result = compute();
    if (scopeInvalid.current && inSelection) {
      setCanSearchInSelection(false);
      showScope(null);
    }
    const index = result.matches.length
      ? findMatchAtOrAfter(result.matches, activeMatch.current?.from ?? 0)
      : -1;
    matchesRef.current = result.matches;
    indexRef.current = index;
    activeMatch.current = index < 0 ? null : result.matches[index];
    setRegexError(result.invalidPattern);
    setMatches(result.matches);
    setActiveIndex(index);
    if (index >= 0) select(result.matches[index], result.matches, index);
    else clear();
  }, [clear, compute, inSelection, select, showScope]);

  useEffect(() => {
    const context = `${activeTabId}:${viewMode}`;
    if (contextRef.current !== context) {
      contextRef.current = context;
      selectedScope.current = null;
      scopeInvalid.current = false;
      activeMatch.current = null;
      setSelectionMode(false);
      setCanSearchInSelection(false);
      showScope(null);
    }
    if (!isOpen) return;
    const frame = requestAnimationFrame(refresh);
    return () => cancelAnimationFrame(frame);
  }, [activeTabId, contentRevision, isOpen, refresh, showScope, viewMode]);

  const open = useCallback(
    (withReplace: boolean) => {
      if (!openRef.current) {
        const selection =
          viewMode === 'wysiwyg'
            ? editorHandle.current?.getSelection()
            : sourceEditorHandle.current?.getSelection();
        selectedScope.current = selection && selection.from < selection.to ? selection : null;
        scopeSnapshot.current = snapshot();
        scopeInvalid.current = false;
        setCanSearchInSelection(!!selectedScope.current);
        setSelectionMode(false);
      }
      openRef.current = true;
      setIsOpen(true);
      setShowReplace(withReplace);
      requestAnimationFrame(() => {
        queryInputRef.current?.focus({ preventScroll: true });
        queryInputRef.current?.select();
      });
    },
    [snapshot, viewMode],
  );

  const close = useCallback(() => {
    openRef.current = false;
    setIsOpen(false);
    setSelectionMode(false);
    setCanSearchInSelection(false);
    selectedScope.current = null;
    scopeInvalid.current = false;
    matchesRef.current = [];
    indexRef.current = -1;
    activeMatch.current = null;
    setMatches([]);
    setActiveIndex(-1);
    showScope(null);
    clear();
    if (viewMode === 'wysiwyg') editorHandle.current?.focus();
    else sourceEditorHandle.current?.focus();
  }, [clear, showScope, viewMode]);

  const setInSelection = useCallback(
    (value: boolean) => {
      if (value && (!selectedScope.current || snapshot() !== scopeSnapshot.current)) {
        setCanSearchInSelection(false);
        return;
      }
      scopeInvalid.current = false;
      activeMatch.current = null;
      setSelectionMode(value);
      showScope(value ? selectedScope.current : null);
    },
    [showScope, snapshot],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      const index = stepMatchIndex(matchesRef.current.length, indexRef.current, direction);
      if (index < 0) return;
      indexRef.current = index;
      activeMatch.current = matchesRef.current[index];
      setActiveIndex(index);
      select(matchesRef.current[index], matchesRef.current, index);
    },
    [select],
  );

  const replace = useCallback(
    (all: boolean) => {
      const result = compute();
      if (result.invalidPattern || scopeInvalid.current) return;
      const current = activeMatch.current;
      const targets = all
        ? result.matches
        : result.matches.filter(
            (match) => current && match.from === current.from && match.to === current.to,
          );
      if (!targets.length) return;
      const edits = targets.map((match) => ({
        from: match.from,
        to: match.to,
        text: expandReplacement(match, replacement),
      }));
      const replaced =
        viewMode === 'wysiwyg'
          ? editorHandle.current?.replaceTextMatches(edits)
          : sourceEditorHandle.current?.replaceTextMatches(edits);
      if (replaced !== edits.length) return;
      if (inSelection && selectedScope.current) {
        selectedScope.current = {
          ...selectedScope.current,
          to:
            selectedScope.current.to +
            edits.reduce((sum, edit) => sum + edit.text.length - (edit.to - edit.from), 0),
        };
        scopeSnapshot.current = snapshot();
        showScope(selectedScope.current);
      }
      activeMatch.current = all
        ? null
        : {
            from:
              edits[0].from +
              edits[0].text.length +
              (edits[0].from === edits[0].to && !edits[0].text ? 1 : 0),
            to:
              edits[0].from +
              edits[0].text.length +
              (edits[0].from === edits[0].to && !edits[0].text ? 1 : 0),
          };
      requestAnimationFrame(refresh);
      requestAnimationFrame(() => queryInputRef.current?.focus({ preventScroll: true }));
    },
    [compute, inSelection, refresh, replacement, showScope, snapshot, viewMode],
  );

  const notifyContentChanged = useCallback(() => {
    if (openRef.current) setContentRevision((revision) => revision + 1);
  }, []);

  return {
    activeIndex,
    canSearchInSelection,
    close,
    inSelection,
    isOpen,
    matchCase,
    matchCount: matches.length,
    next: () => step(1),
    notifyContentChanged,
    open,
    previous: () => step(-1),
    query,
    queryInputRef,
    regexError,
    replaceAll: () => replace(true),
    replaceCurrent: () => replace(false),
    replacement,
    setInSelection,
    setMatchCase,
    setQuery,
    setReplacement,
    setUseRegex,
    setWholeWord,
    showReplace,
    useRegex,
    wholeWord,
  };
}
