import { ChevronDown, ChevronUp, Replace, ReplaceAll, X } from 'lucide-react';
import type { FindReplaceController } from '../hooks/useFindReplace';
import { useI18n } from '../i18n';
import '../styles/find-replace.css';

interface FindReplaceBarProps {
  controller: FindReplaceController;
}

export function FindReplaceBar({ controller }: FindReplaceBarProps) {
  const {
    activeIndex,
    close,
    matchCount,
    next,
    previous,
    query,
    queryInputRef,
    replaceAll,
    replaceCurrent,
    replacement,
    setQuery,
    setReplacement,
    showReplace,
  } = controller;
  const { t } = useI18n();
  const hasMatch = matchCount > 0;
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
            {matchSummary}
          </span>
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
