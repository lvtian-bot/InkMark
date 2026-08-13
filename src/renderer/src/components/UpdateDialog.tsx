import { useEffect, useRef, useState } from 'react';
import type { UpdateCheckResult } from '../../../shared/update-check';
import '../styles/update-dialog.css';

interface UpdateDialogProps {
  onClose: () => void;
}

export function UpdateDialog({ onClose }: UpdateDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    let active = true;
    void window.inkmark.checkForUpdates().then((nextResult) => {
      if (active) setResult(nextResult);
    });
    return () => {
      active = false;
    };
  }, []);

  const title =
    result?.status === 'available'
      ? `发现新版本 ${result.latestVersion}`
      : result?.status === 'latest'
        ? '当前已是最新版本'
        : result?.status === 'error'
          ? '检查更新失败'
          : '正在检查更新…';

  return (
    <div className="update-overlay" onClick={onClose}>
      <div
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="update-content">
          <div id="update-dialog-title" className="update-title">
            {title}
          </div>
          <p className="update-description">
            {!result && '正在连接 GitHub Releases，请稍候。'}
            {result?.status === 'latest' &&
              `当前版本 ${result.currentVersion}，GitHub 最新版本 ${result.latestVersion}。`}
            {result?.status === 'available' &&
              `${result.releaseName} 已发布，当前版本为 ${result.currentVersion}。`}
            {result?.status === 'error' && `${result.message} 你也可以直接前往发布页查看。`}
          </p>
          <div className="update-divider" />
          <div className="update-actions">
            <button
              className="update-secondary-btn"
              onClick={() => void window.inkmark.openReleases()}
            >
              查看发布页
            </button>
            <button ref={closeButtonRef} className="update-close-btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
