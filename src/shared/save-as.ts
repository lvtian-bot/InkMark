/** 另存成功时返回实际落盘正文；本地图片路径可能因附件复制而改变。 */
export interface SaveAsResult {
  path: string;
  content: string;
  mtime: number;
}

export interface SaveAsFailure {
  status: 'error';
  code: 'image-copy-failed';
  message: string;
}

export type SaveAsResponse = SaveAsResult | SaveAsFailure | null;
