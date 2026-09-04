import { useI18n } from '../i18n';
import '../styles/review.css';

interface ReviewToolbarProps {
  count: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onExit: () => void;
}

// 编辑区顶部的审阅工具条（change-review.md 审阅模式）。仅在有待决块时
// 显示；最后一块处理完成后，会话随自动写回流程结束，工具条立即消失。
export function ReviewToolbar({ count, onAcceptAll, onRejectAll, onExit }: ReviewToolbarProps) {
  const { t } = useI18n();
  const title = t('review.toolbarTitle', { count });
  return (
    <div className="review-toolbar" role="region" aria-label={title}>
      <span className="review-toolbar-dot" aria-hidden="true" />
      <span className="review-toolbar-text">{title}</span>
      <span className="review-toolbar-hint">{t('review.toolbarHint')}</span>
      <span className="review-toolbar-actions">
        <button type="button" className="review-toolbar-btn is-accept" onClick={onAcceptAll}>
          {t('review.acceptAll')}
        </button>
        <button type="button" className="review-toolbar-btn is-reject" onClick={onRejectAll}>
          {t('review.rejectAll')}
        </button>
        <button type="button" className="review-toolbar-btn is-exit" onClick={onExit}>
          {t('review.exit')}
        </button>
      </span>
    </div>
  );
}
