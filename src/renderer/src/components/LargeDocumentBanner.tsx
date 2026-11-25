import { useI18n } from '../i18n';
import '../styles/large-document-banner.css';

interface LargeDocumentBannerProps {
  onSwitchToWysiwyg: () => void;
}

// 大 Markdown 文档自动以源码模式打开时在编辑区顶部显示温和提示，并提供确认切回所见即所得的入口。
export function LargeDocumentBanner({ onSwitchToWysiwyg }: LargeDocumentBannerProps) {
  const { t } = useI18n();

  return (
    <div className="large-document-banner" role="status">
      <span className="large-document-banner-dot" aria-hidden="true" />
      <span className="large-document-banner-text">{t('largeDoc.banner')}</span>
      <span className="large-document-banner-actions">
        <button type="button" className="large-document-banner-btn" onClick={onSwitchToWysiwyg}>
          {t('largeDoc.switchToWysiwyg')}
        </button>
      </span>
    </div>
  );
}
