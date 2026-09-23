import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime } from './datetime-format';

// new Date(年, 月, 日, 时, 分) 按本地时区构造，get 系列取回同值，测试与运行时区无关。
describe('formatDate', () => {
  it('按本地时间补零输出 YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 8, 23))).toBe('2026-09-23');
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('formatDateTime', () => {
  it('按本地时间补零输出 YYYY-MM-DD HH:mm', () => {
    expect(formatDateTime(new Date(2026, 8, 23, 9, 5))).toBe('2026-09-23 09:05');
    expect(formatDateTime(new Date(2026, 8, 23, 23, 59))).toBe('2026-09-23 23:59');
  });

  it('不携带秒数', () => {
    expect(formatDateTime(new Date(2026, 8, 23, 9, 5, 42))).toBe('2026-09-23 09:05');
  });
});
