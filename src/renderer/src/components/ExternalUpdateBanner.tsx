import { useState } from 'react';
import { useI18n } from '../i18n';
import '../styles/external-update-banner.css';

interface ExternalUpdateBannerProps {
  mode: 'reload' | 'conflict';
  onReload: () => Promise<void>;
  onSaveAs: () => Promise<void>;
  onResolveConflict: () => Promise<void>;
}

// 编辑区顶部的外部更新提示条：
// - reload：干净文档检测到外部更新时提示手动重新加载（期间锁定编辑）。
// - conflict：有未保存修改的文档冲突暂不处理时，提供另存为新文件或查看差异入口。
export function ExternalUpdateBanner({
  mode,
  onReload,
  onSaveAs,
  onResolveConflict,
}: ExternalUpdateBannerProps) {
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
    <div
      className={`external-update-banner${mode === 'conflict' ? ' is-conflict' : ''}`}
      role="status"
    >
      <span className="external-update-banner-dot" aria-hidden="true" />
      <span className="external-update-banner-text">
        {mode === 'conflict' ? t('externalUpdate.conflictBanner') : t('externalUpdate.banner')}
      </span>
      <span className="external-update-banner-actions">
        {mode === 'conflict' ? (
          <>
            <button
              type="button"
              className="external-update-banner-btn is-primary"
              disabled={busy}
              onClick={() => void run(onSaveAs)}
            >
              {t('externalUpdate.saveAsNewFile')}
            </button>
            <button
              type="button"
              className="external-update-banner-btn"
              disabled={busy}
              onClick={() => void run(onResolveConflict)}
            >
              {t('externalUpdate.reviewConflict')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="external-update-banner-btn"
            disabled={busy}
            onClick={() => void run(onReload)}
          >
            {t('externalUpdate.reload')}
          </button>
        )}
      </span>
    </div>
  );
}
