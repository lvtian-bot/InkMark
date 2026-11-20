// 草稿恢复用标签最近确认的磁盘正文核对原文件，避免恢复到已变化的文件上。
const diskBaselines = new Map<string, string>();

export function setDiskBaseline(tabId: string, content: string): void {
  diskBaselines.set(tabId, content);
}

export function getDiskBaseline(tabId: string): string | undefined {
  return diskBaselines.get(tabId);
}

export function clearDiskBaseline(tabId: string): void {
  diskBaselines.delete(tabId);
}
