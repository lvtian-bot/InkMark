export interface LargeReaderHandle {
  getScrollTop: () => number;
  setScrollTop: (top: number) => void;
  getScrollContainer: () => HTMLElement | null;
  scrollToPos: (pos: number) => void;
  getSelectedText: () => string;
}

export const largeReaderHandle: { current: LargeReaderHandle | null } = { current: null };

const lastScrollTopByTab = new Map<string, number>();

export function recordLargeReaderScrollTop(tabId: string, scrollTop: number): void {
  if (!tabId) return;
  lastScrollTopByTab.set(tabId, Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0);
}

export function readLargeReaderScrollTop(tabId: string): number | undefined {
  return lastScrollTopByTab.get(tabId);
}

export function clearLargeReaderScrollTop(tabId: string): void {
  lastScrollTopByTab.delete(tabId);
}
