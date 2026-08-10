import type { ViewMode } from './types';
import type { Tab } from './stores/useStore';

export type ScrollPositionField = 'wysiwygScrollTop' | 'sourceScrollTop';

type TabScrollPositions = Pick<Tab, 'wysiwygScrollTop' | 'sourceScrollTop'>;

export function scrollPositionField(mode: ViewMode): ScrollPositionField {
  return mode === 'source' ? 'sourceScrollTop' : 'wysiwygScrollTop';
}

export function readTabScrollTop(tab: TabScrollPositions, mode: ViewMode): number {
  return tab[scrollPositionField(mode)];
}

export function scrollPositionUpdate(
  mode: ViewMode,
  top: number,
): Partial<Pick<Tab, 'wysiwygScrollTop' | 'sourceScrollTop'>> {
  const scrollTop = Number.isFinite(top) ? Math.max(0, top) : 0;
  return mode === 'source' ? { sourceScrollTop: scrollTop } : { wysiwygScrollTop: scrollTop };
}
