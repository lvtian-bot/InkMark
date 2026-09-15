import { useState } from 'react';
import { useI18n } from '../i18n';
import '../styles/external-update-banner.css';

interface ExternalUpdateBannerProps {
  onReload: () => Promise<void>;
  onReview: () => Promise<void>;
}

// 编辑区顶部的「文件已被外部更新」提示条（change-review.md 默认状态）：
// 干净标签页被外部修改后不静默刷新，由用户选择「重新加载」或「逐项审阅」。
export function ExternalUpdateBanner({ onReload, onReview }: ExternalUpdateBannerProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="external-update-banner" role="status">
      <span className="external-update-banner-dot" aria-hidden="true" />
      <span className="external-update-banner-text">{t('externalUpdate.banner')}</span>
      <span className="external-update-banner-actions">
        <button
          type="button"
          className="external-update-banner-btn"
          disabled={busy}
          onClick={() => void run(onReload)}
        >
          {t('review.replaceNow')}
        </button>
        <button
          type="button"
          className="external-update-banner-btn is-primary"
          disabled={busy}
          onClick={() => void run(onReview)}
        >
          {t('review.enterReview')}
        </button>
      </span>
    </div>
  );
}
