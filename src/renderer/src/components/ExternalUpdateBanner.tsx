import { useI18n } from '../i18n';
import '../styles/external-update-banner.css';

interface ExternalUpdateBannerProps {
  onReload: () => void;
}

// 编辑区顶部的「文件已被外部更新」提示条（change-review.md 场景 B）：
// 干净标签页被外部修改后不静默刷新，整条可点击，点击后加载磁盘上的最新版本。
export function ExternalUpdateBanner({ onReload }: ExternalUpdateBannerProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="external-update-banner"
      onClick={onReload}
      aria-label={t('externalUpdate.aria')}
    >
      <span className="external-update-banner-dot" aria-hidden="true" />
      <span className="external-update-banner-text">{t('externalUpdate.banner')}</span>
      <span className="external-update-banner-action">{t('externalUpdate.clickToReload')}</span>
    </button>
  );
}
