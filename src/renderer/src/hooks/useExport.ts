import { useCallback } from 'react';
import { useStore } from '../stores/useStore';
import { confirmDialog } from '../confirm-dialog';
import { showExportProgress, hideExportProgress } from '../export-progress';
import { t } from '../i18n';
import { tabDisplayName } from '../tab-name';
import type { ExportKind, ExportDocumentResult } from '../../../shared/export-document';

// 模块级并发防护：导出期间再次触发（如点击原生菜单）直接忽略。
let exportInFlight = false;

// 进度提示延迟：快速完成的导出（HTML 通常亚秒级）不显示提示层，避免闪屏；
// 慢导出（主要是 PDF 排版）超过阈值后出现转圈提示，让用户知道没有卡死。
const PROGRESS_DELAY_MS = 400;

/**
 * 菜单「导出」入口：把活动标签的 sourceContent（单一真源）提交主进程渲染落盘。
 * 审阅未决时与保存一致地拦下——导出半审阅状态的内容会让用户拿到未定稿的文档。
 */
export function useExport() {
  const exportDocument = useCallback(async (kind: ExportKind): Promise<void> => {
    if (exportInFlight) return;
    const state = useStore.getState();
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    if (!tab || tab.isStartPage) return;

    if (tab.pendingReviewCount > 0) {
      await confirmDialog(
        t('review.saveBlockedTitle'),
        t('review.saveBlockedBody', { count: tab.pendingReviewCount }),
        [t('common.ok')],
      );
      return;
    }

    exportInFlight = true;
    const progressTimer = setTimeout(() => showExportProgress(kind), PROGRESS_DELAY_MS);
    let result: ExportDocumentResult;
    try {
      result = await window.inkmark.exportDocument({
        kind,
        markdown: tab.sourceContent,
        title: tabDisplayName(tab, t),
        sourcePath: tab.filePath,
      });
    } catch {
      result = { status: 'error', message: '' };
    } finally {
      clearTimeout(progressTimer);
      hideExportProgress();
      exportInFlight = false;
    }

    if (result.status === 'canceled') return;
    if (result.status === 'error') {
      const detail = result.message ? `\n${result.message}` : '';
      await confirmDialog(t('export.failedTitle'), `${t('export.failedBody')}${detail}`, [
        t('common.ok'),
      ]);
      return;
    }

    const choice = await confirmDialog(
      t('export.successTitle'),
      t('export.successBody', { path: result.path }),
      [t('export.openFolder'), t('common.close')],
      { defaultId: 0, cancelId: 1 },
    );
    if (choice === 0) {
      void window.inkmark.revealInFolder(result.path);
    }
  }, []);

  return { exportDocument };
}
