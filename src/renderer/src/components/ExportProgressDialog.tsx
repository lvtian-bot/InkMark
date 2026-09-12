import { useExportProgressState } from '../export-progress';
import { t } from '../i18n';
import '../styles/export-progress.css';

// 导出进行中的提示层：只有转圈与文案，不可关闭（导出由 30 秒超时兜底，
// 结束后自动消失）。role=status 让读屏器在出现时播报。
export function ExportProgressDialog() {
  const state = useExportProgressState();
  if (!state.visible || state.kind === null) return null;
  return (
    <div className="export-progress-overlay">
      <div className="export-progress-card" role="status" aria-live="polite">
        <span className="export-progress-spinner" aria-hidden="true" />
        <span className="export-progress-text">
          {state.kind === 'html' ? t('export.inProgressHtml') : t('export.inProgressPdf')}
        </span>
      </div>
    </div>
  );
}
