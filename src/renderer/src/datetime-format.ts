// 当前日期/时间的文本格式化（纯函数，不依赖 DOM 或 Node 环境）。
// 输出固定为本地时间的 ISO 风格：YYYY-MM-DD / YYYY-MM-DD HH:mm，与界面语言无关。

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 本地日期，如 2026-09-23。 */
export function formatDate(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** 本地日期和时间，如 2026-09-23 09:05。 */
export function formatDateTime(now: Date): string {
  return `${formatDate(now)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}
