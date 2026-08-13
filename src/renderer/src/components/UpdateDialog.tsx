import { useEffect, useRef, useState } from 'react';
import type { UpdateState } from '../../../shared/update-state';
import { requestUpdateInstall } from '../update-install';
import { useI18n } from '../i18n';
import '../styles/update-dialog.css';

interface UpdateDialogProps {
  onClose: () => void;
  prepareToClose: () => Promise<boolean>;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateDialog({ onClose, prepareToClose }: UpdateDialogProps) {
  const { t } = useI18n();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    let active = true;
    const removeListener = window.inkmark.onUpdateState((nextState) => {
      if (active) setState(nextState);
    });
    void window.inkmark.getUpdateState().then((currentState) => {
      if (!active) return;
      setState(currentState);
      if (
        currentState.status === 'idle' ||
        currentState.status === 'latest' ||
        currentState.status === 'error'
      ) {
        void window.inkmark.checkForUpdates().then((nextState) => {
          if (active) setState(nextState);
        });
      }
    });
    return () => {
      active = false;
      removeListener();
    };
  }, []);

  const title =
    state?.status === 'available'
      ? t('update.availableTitle', { version: state.latestVersion })
      : state?.status === 'downloading'
        ? t('update.downloadingTitle', { version: state.latestVersion })
        : state?.status === 'downloaded'
          ? t('update.downloadedTitle', { version: state.latestVersion })
          : state?.status === 'latest'
            ? t('update.latestTitle')
            : state?.status === 'error'
              ? t('update.errorTitle')
              : state?.status === 'unsupported'
                ? t('update.unsupportedTitle')
                : t('update.checking');

  const startDownload = (): void => {
    void window.inkmark.downloadUpdate().then(setState);
  };

  const install = (): void => {
    void requestUpdateInstall({
      prepareToClose,
      install: () => window.inkmark.installUpdate(),
    });
  };

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
            {(!state || state.status === 'idle' || state.status === 'checking') &&
              t('update.connecting')}
            {state?.status === 'latest' &&
              t('update.latestDescription', {
                currentVersion: state.currentVersion,
                latestVersion: state.latestVersion,
              })}
            {state?.status === 'available' &&
              t('update.availableDescription', {
                releaseName: state.releaseName,
                currentVersion: state.currentVersion,
              })}
            {state?.status === 'downloading' &&
              (state.total > 0
                ? t('update.downloadProgress', {
                    transferred: formatBytes(state.transferred),
                    total: formatBytes(state.total),
                  })
                : t('update.downloadPreparing'))}
            {state?.status === 'downloaded' && t('update.downloadedDescription')}
            {state?.status === 'error' && t('update.errorDescription', { message: state.message })}
            {state?.status === 'unsupported' && state.message}
          </p>
          {state?.status === 'downloading' && (
            <div
              className="update-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(state.percent)}
            >
              <div className="update-progress-value" style={{ width: `${state.percent}%` }} />
            </div>
          )}
          <div className="update-divider" />
          <div className="update-actions">
            {(state?.status === 'error' || state?.status === 'unsupported') && (
              <button
                className="update-secondary-btn"
                onClick={() => void window.inkmark.openReleases()}
              >
                {t('update.viewReleases')}
              </button>
            )}
            {state?.status === 'error' && (
              <button
                className="update-secondary-btn"
                onClick={() => void window.inkmark.checkForUpdates().then(setState)}
              >
                {t('update.checkAgain')}
              </button>
            )}
            {state?.status === 'available' && (
              <button className="update-close-btn" onClick={startDownload}>
                {t('update.downloadUpdate')}
              </button>
            )}
            {state?.status === 'downloaded' && (
              <button className="update-close-btn" onClick={install}>
                {t('update.restartInstall')}
              </button>
            )}
            <button ref={closeButtonRef} className="update-secondary-btn" onClick={onClose}>
              {state?.status === 'downloaded' ? t('update.later') : t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
