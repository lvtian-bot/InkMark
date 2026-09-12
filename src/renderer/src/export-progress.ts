import { useSyncExternalStore } from 'react';
import type { ExportKind } from '../../shared/export-document';

// 导出进行中的全局提示状态：由 useExport 在导出慢于阈值时点亮，
// 完成或失败后立即熄灭。快速导出（HTML 通常亚秒级）全程不显示，避免闪屏。

export interface ExportProgressState {
  visible: boolean;
  kind: ExportKind | null;
}

let current: ExportProgressState = { visible: false, kind: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function showExportProgress(kind: ExportKind): void {
  if (current.visible && current.kind === kind) return;
  current = { visible: true, kind };
  emit();
}

export function hideExportProgress(): void {
  if (!current.visible && current.kind === null) return;
  current = { visible: false, kind: null };
  emit();
}

export function useExportProgressState(): ExportProgressState {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => current,
  );
}
