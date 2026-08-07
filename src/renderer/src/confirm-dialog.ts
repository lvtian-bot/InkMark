import { useSyncExternalStore } from 'react';

export interface ConfirmRequest {
  title: string;
  message: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

let current: ConfirmRequest | null = null;
let resolver: ((index: number) => void) | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function confirmDialog(
  title: string,
  message: string,
  buttons: string[],
  options?: { defaultId?: number; cancelId?: number },
): Promise<number> {
  return new Promise<number>((resolve) => {
    // 已有对话框打开时，先按取消处理旧的，避免 Promise 悬挂
    const previous = resolver;
    const previousCancelId = current?.cancelId;
    current = {
      title,
      message,
      buttons,
      defaultId: options?.defaultId ?? 0,
      cancelId: options?.cancelId ?? buttons.length - 1,
    };
    resolver = resolve;
    emit();
    if (previous && previousCancelId !== undefined) previous(previousCancelId);
  });
}

export function resolveConfirmDialog(index: number): void {
  const done = resolver;
  resolver = null;
  current = null;
  emit();
  if (done) done(index);
}

export function useConfirmDialogState(): ConfirmRequest | null {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => current,
  );
}
