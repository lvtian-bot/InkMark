import { useState } from 'react';
import { useI18n } from '../i18n';
import '../styles/external-update-banner.css';

interface ExternalUpdateBannerProps {
  onReload: () => Promise<void>;
}

// 编辑区顶部的「文件已被外部更新」提示条。文件仍需由用户明确点击重新加载。
export function ExternalUpdateBanner({ onReload }: ExternalUpdateBannerProps) {
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
          {t('externalUpdate.reload')}
        </button>
      </span>
    </div>
  );
}
