import { describe, expect, it } from 'vitest';
import { readScrollTop, writeScrollTop } from './editor-scroll';

describe('editor scroll helpers', () => {
  it('读取容器位置，空容器返回零', () => {
    expect(readScrollTop({ scrollTop: 24 })).toBe(24);
    expect(readScrollTop(null)).toBe(0);
  });

  it('写入位置时把负数和非有限数归零', () => {
    const container = { scrollTop: 24 };

    writeScrollTop(container, 180);
    expect(container.scrollTop).toBe(180);

    writeScrollTop(container, -4);
    expect(container.scrollTop).toBe(0);

    writeScrollTop(container, Number.NaN);
    expect(container.scrollTop).toBe(0);
  });
});
