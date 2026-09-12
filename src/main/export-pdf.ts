// PDF 导出的打印环节：把渲染好的 HTML 写入临时文件，交给隐藏窗口加载后
// printToPDF。图片在 print 目标下已改写为 file:// URL，本地窗口可直接加载。

import { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const PRINT_TIMEOUT_MS = 30_000;
const RESOURCE_POLL_INTERVAL_MS = 50;
const RESOURCE_SETTLE_DELAY_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * 在隐藏窗口中渲染 HTML 并输出 PDF（A4、打印背景、标题生成书签大纲）。
 * 加载失败或整体超过 PRINT_TIMEOUT_MS 时抛错，由导出主流程转成错误结果。
 */
export async function printHtmlToPdf(html: string): Promise<Buffer> {
  const tempPath = join(tmpdir(), `inkmark-export-${randomUUID()}.html`);
  writeFileSync(tempPath, html, 'utf-8');

  let win: BrowserWindow | null = null;
  const destroyWindow = (): void => {
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
  };

  // printToPDF 理论上可能挂起（异常页面资源），超时后强杀窗口让挂起的调用以
  // rejection 结束，而不是让导出永远转圈。
  const timeout = setTimeout(() => {
    destroyWindow();
  }, PRINT_TIMEOUT_MS);

  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    const contents = win.webContents;
    await win.loadFile(tempPath);
    // loadFile 只保证主文档加载完成；图片等子资源仍在途中时打印会缺图，
    // 轮询至全部加载结束，再留一帧余量。
    while (contents.isLoading()) {
      await sleep(RESOURCE_POLL_INTERVAL_MS);
    }
    await sleep(RESOURCE_SETTLE_DELAY_MS);
    const pdf = await contents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.55, bottom: 0.55, left: 0.5, right: 0.5 },
      generateDocumentOutline: true,
    });
    return Buffer.from(pdf);
  } finally {
    clearTimeout(timeout);
    destroyWindow();
    try {
      unlinkSync(tempPath);
    } catch {
      // 临时文件可能已不存在。
    }
  }
}
