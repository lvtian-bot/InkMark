import { ChevronDown, ChevronUp, Replace, ReplaceAll, X } from 'lucide-react';
import type { FindReplaceController } from '../hooks/useFindReplace';
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
  const hasMatch = matchCount > 0;
  const matchSummary = query ? (hasMatch ? `${activeIndex + 1} / ${matchCount}` : '无结果') : '';

  return (
    <div className="find-replace-bar" role="search" aria-label="查找与替换">
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
            placeholder="查找"
            aria-label="查找内容"
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
          title="上一处 (Shift+Enter)"
          aria-label="上一处"
        >
          <ChevronUp size={16} />
        </button>
        <button
          className="find-replace-icon-button"
          type="button"
          onClick={next}
          disabled={!hasMatch}
          title="下一处 (Enter)"
          aria-label="下一处"
        >
          <ChevronDown size={16} />
        </button>
        <button
          className="find-replace-icon-button"
          type="button"
          onClick={close}
          title="关闭 (Esc)"
          aria-label="关闭查找"
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
            placeholder="替换为"
            aria-label="替换内容"
            spellCheck={false}
          />
          <button
            className="find-replace-icon-button"
            type="button"
            onClick={replaceCurrent}
            disabled={!hasMatch}
            title="替换当前"
            aria-label="替换当前"
          >
            <Replace size={16} />
          </button>
          <button
            className="find-replace-icon-button"
            type="button"
            onClick={replaceAll}
            disabled={!hasMatch}
            title="全部替换"
            aria-label="全部替换"
          >
            <ReplaceAll size={16} />
          </button>
          <span className="find-replace-spacer" />
        </div>
      )}
    </div>
  );
}
