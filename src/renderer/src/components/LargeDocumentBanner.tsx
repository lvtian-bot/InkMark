import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import '../styles/large-document-banner.css';

interface LargeDocumentBannerProps {
  onSwitchToSource: () => void;
  highlightNonce?: number;
}

// 大 Markdown 文档在所见即所得阅读模式顶部显示提示条；尝试编辑时高亮提醒切到源码模式。
export function LargeDocumentBanner({
  onSwitchToSource,
  highlightNonce = 0,
}: LargeDocumentBannerProps) {
  const { t } = useI18n();
  const bannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = bannerRef.current;
    if (highlightNonce <= 0 || !el) return;
    el.classList.add('is-highlighted');
    const timer = window.setTimeout(() => {
      el.classList.remove('is-highlighted');
    }, 700);
    return () => window.clearTimeout(timer);
  }, [highlightNonce]);

  return (
    <div ref={bannerRef} className="large-document-banner" role="status">
      <span className="large-document-banner-dot" aria-hidden="true" />
      <span className="large-document-banner-text">{t('largeDoc.banner')}</span>
      <span className="large-document-banner-actions">
        <button type="button" className="large-document-banner-btn" onClick={onSwitchToSource}>
          {t('largeDoc.switchToSource')}
        </button>
      </span>
    </div>
  );
}
