import { useEffect, useRef, useState } from 'react';
import type { AppInfo } from '../types';
import '../styles/about-dialog.css';

interface AboutDialogProps {
  onClose: () => void;
}

export function AboutDialog({ onClose }: AboutDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    let active = true;
    void window.inkmark.getAppInfo().then((info) => {
      if (active) setAppInfo(info);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="about-overlay" onClick={onClose}>
      <div
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        aria-describedby="about-dialog-description"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="about-hero">
          <div className="about-logo" aria-hidden="true">
            IM
          </div>
          <div className="about-brand">
            <div id="about-dialog-title" className="about-name">
              {appInfo?.name ?? 'InkMark'}
            </div>
            <div className="about-tagline">专注写作的 Markdown 编辑器</div>
          </div>
        </div>
        <div className="about-content">
          <div className="about-version">
            <span className="about-version-label">版本</span>
            <span className="about-version-number">{appInfo?.version ?? '读取中…'}</span>
          </div>
          <p id="about-dialog-description" className="about-description">
            让写作回到内容本身，轻松完成每一篇 Markdown 文档。
          </p>
          <div className="about-divider" />
          <div className="about-actions">
            <button ref={closeButtonRef} className="about-close-btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
