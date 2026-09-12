import { useI18n } from '../i18n';
import '../styles/review.css';

interface ReviewToolbarProps {
  count: number;
  externalChanged: boolean;
  onSave: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onExit: () => void;
}

// 处理完仍保留工具条；取消保存后可在当前标签重试，不让自动保存接管。
export function ReviewToolbar({
  count,
  externalChanged,
  onSave,
  onAcceptAll,
  onRejectAll,
  onExit,
}: ReviewToolbarProps) {
  const { t } = useI18n();
  const title = count > 0 ? t('review.toolbarTitle', { count }) : t('review.readyTitle');
  return (
    <>
      <div className="review-reminder" role="note">
        {t('review.concurrentWarning')}
        {externalChanged && <strong> {t('review.externalChangedHint')}</strong>}
      </div>
      <div className="review-toolbar" role="region" aria-label={title}>
        <span className="review-toolbar-dot" aria-hidden="true" />
        <span className="review-toolbar-text">{title}</span>
        <span className="review-toolbar-hint">{t('review.toolbarHint')}</span>
        <span className="review-toolbar-actions">
          {count === 0 ? (
            <button type="button" className="review-toolbar-btn is-accept" onClick={onSave}>
              {t('review.saveResultTitle')}
            </button>
          ) : (
            <>
              <button type="button" className="review-toolbar-btn is-accept" onClick={onAcceptAll}>
                {t('review.acceptAll')}
              </button>
              <button type="button" className="review-toolbar-btn is-reject" onClick={onRejectAll}>
                {t('review.rejectAll')}
              </button>
              <button type="button" className="review-toolbar-btn is-exit" onClick={onExit}>
                {t('review.exit')}
              </button>
            </>
          )}
        </span>
      </div>
    </>
  );
}
