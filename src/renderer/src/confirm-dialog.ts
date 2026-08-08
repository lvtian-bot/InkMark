import { useSyncExternalStore } from 'react';

export interface ConfirmRequest {
  title: string;
  message: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

export interface PromptRequest {
  title: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel: string;
  cancelLabel: string;
}

let current: ConfirmRequest | null = null;
let resolver: ((index: number) => void) | null = null;

let promptCurrent: PromptRequest | null = null;
let promptResolver: ((value: string | null) => void) | null = null;

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

export function promptDialog(
  title: string,
  message: string,
  options?: {
    placeholder?: string;
    defaultValue?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  },
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const previous = promptResolver;
    promptCurrent = {
      title,
      message,
      placeholder: options?.placeholder,
      defaultValue: options?.defaultValue,
      confirmLabel: options?.confirmLabel ?? '确定',
      cancelLabel: options?.cancelLabel ?? '取消',
    };
    promptResolver = resolve;
    emit();
    if (previous) previous(null);
  });
}

export function resolvePromptDialog(value: string | null): void {
  const done = promptResolver;
  promptResolver = null;
  promptCurrent = null;
  emit();
  if (done) done(value);
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

export function usePromptDialogState(): PromptRequest | null {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => promptCurrent,
  );
}