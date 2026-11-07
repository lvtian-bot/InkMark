import { ChevronDown, ChevronUp, Replace, ReplaceAll, TextSelect, X } from 'lucide-react';
import type { FindReplaceController } from '../hooks/useFindReplace';
import { useI18n } from '../i18n';
import '../styles/find-replace.css';

interface FindReplaceBarProps {
  controller: FindReplaceController;
}

export function FindReplaceBar({ controller }: FindReplaceBarProps) {
  const {
    activeIndex,
    canSearchInSelection,
    close,
    inSelection,
    matchCase,
    matchCount,
    next,
    previous,
    query,
    queryInputRef,
    regexError,
    replaceAll,
    replaceCurrent,
    replacement,
    setQuery,
    setInSelection,
    setMatchCase,
    setReplacement,
    setUseRegex,
    setWholeWord,
    showReplace,
    useRegex,
    wholeWord,
  } = controller;
  const { t } = useI18n();
  const hasMatch = matchCount > 0 && !regexError;
  const matchSummary = query
    ? hasMatch
      ? `${activeIndex + 1} / ${matchCount}`
      : t('find.noResults')
    : '';

  return (
    <div className="find-replace-bar" role="search" aria-label={t('find.barAria')}>
      <div className="find-replace-row">
        <div className="find-replace-input-wrap">
          <input
            ref={queryInputRef}
            className="find-replace-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (event.shiftKey) previous();
                else next();
              }
            }}
            placeholder={t('find.findPlaceholder')}
            aria-label={t('find.findAria')}
            spellCheck={false}
          />
          <span className={`find-replace-count ${query && !hasMatch ? 'is-empty' : ''}`}>
            {regexError ? '' : matchSummary}
          </span>
        </div>
        <div className="find-replace-options">
          <button
            className="find-replace-option"
            type="button"
            aria-pressed={matchCase}
            title={t('find.matchCase')}
            aria-label={t('find.matchCase')}
            onClick={() => setMatchCase(!matchCase)}
          >
            Aa
          </button>
          <button
            className="find-replace-option find-replace-whole-word"
            type="button"
            aria-pressed={wholeWord}
            title={t('find.wholeWord')}
            aria-label={t('find.wholeWord')}
            onClick={() => setWholeWord(!wholeWord)}
          >
            ab
          </button>
          <button
            className="find-replace-option"
            type="button"
            aria-pressed={useRegex}
            title={t('find.useRegex')}
            aria-label={t('find.useRegex')}
            onClick={() => setUseRegex(!useRegex)}
          >
            .*
          </button>
          <button
            className="find-replace-option"
            type="button"
            aria-pressed={inSelection}
            disabled={!canSearchInSelection && !inSelection}
            title={t('find.inSelection')}
            aria-label={t('find.inSelection')}
            onClick={() => setInSelection(!inSelection)}
          >
            <TextSelect size={16} />
          </button>
        </div>
        <button
          className="find-replace-icon-button"
          type="button"
          onClick={previous}
          disabled={!hasMatch}
          title={t('find.prevTooltip')}
          aria-label={t('find.prevAria')}
        >
          <ChevronUp size={16} />
        </button>
        <button
          className="find-replace-icon-button"
          type="button"
          onClick={next}
          disabled={!hasMatch}
          title={t('find.nextTooltip')}
          aria-label={t('find.nextAria')}
        >
          <ChevronDown size={16} />
        </button>
        <button
          className="find-replace-icon-button"
          type="button"
          onClick={close}
          title={t('find.closeTooltip')}
          aria-label={t('find.closeAria')}
        >
          <X size={16} />
        </button>
      </div>
      {regexError && (
        <div className="find-replace-error" role="alert">
          {t('find.regexError')}
        </div>
      )}
      {showReplace && (
        <div className="find-replace-row">
          <input
            className="find-replace-input find-replace-replacement"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                replaceCurrent();
              }
            }}
            placeholder={t('find.replacePlaceholder')}
            aria-label={t('find.replaceAria')}
            spellCheck={false}
          />
          <button
            className="find-replace-icon-button"
            type="button"
            onClick={replaceCurrent}
            disabled={!hasMatch}
            title={t('find.replaceCurrent')}
            aria-label={t('find.replaceCurrent')}
          >
            <Replace size={16} />
          </button>
          <button
            className="find-replace-icon-button"
            type="button"
            onClick={replaceAll}
            disabled={!hasMatch}
            title={t('find.replaceAll')}
            aria-label={t('find.replaceAll')}
          >
            <ReplaceAll size={16} />
          </button>
          <span className="find-replace-spacer" />
        </div>
      )}
    </div>
  );
}
