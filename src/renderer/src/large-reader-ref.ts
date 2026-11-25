export interface LargeReaderHandle {
  getScrollTop: () => number;
  setScrollTop: (top: number) => void;
  getScrollContainer: () => HTMLElement | null;
  scrollToPos: (pos: number) => void;
}

export const largeReaderHandle: { current: LargeReaderHandle | null } = { current: null };
