export interface ScrollContainer {
  scrollTop: number;
}

export function readScrollTop(container: ScrollContainer | null | undefined): number {
  return container?.scrollTop ?? 0;
}

export function writeScrollTop(container: ScrollContainer | null | undefined, top: number): void {
  if (!container) return;
  container.scrollTop = Number.isFinite(top) ? Math.max(0, top) : 0;
}
