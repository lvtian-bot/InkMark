import { classifyDocumentLinkHref } from '../../shared/document-link';
import type { DocumentLinkResolution } from '../../shared/document-link';

export interface FollowLinkDeps {
  resolveDocumentLink: (request: {
    sourcePath: string;
    href: string;
  }) => Promise<DocumentLinkResolution>;
  openFilePath: (path: string) => Promise<unknown>;
  openExternalUrl: (url: string) => void;
}

/**
 * 文档内链接点击的统一出口：外链交给系统，文档链接经主进程解析成绝对路径后
 * 走既有的「打开文件」流程（同文件去重激活标签、丢失时弹窗提示）。
 * 目标不是文档类文件时静默不动，维持点击前的行为。
 */
export async function followDocumentLinkHref(
  href: string,
  sourceFilePath: string | null,
  deps: FollowLinkDeps,
): Promise<void> {
  const classified = classifyDocumentLinkHref(href);
  if (classified.kind === 'external') {
    deps.openExternalUrl(classified.url);
    return;
  }
  if (classified.kind !== 'document') return;
  // 未落盘的新文档没有基准目录，相对链接无从解析，保持不动。
  if (!sourceFilePath) return;
  let resolution: DocumentLinkResolution;
  try {
    resolution = await deps.resolveDocumentLink({ sourcePath: sourceFilePath, href });
  } catch {
    return;
  }
  if (resolution.status !== 'ok') return;
  await deps.openFilePath(resolution.path);
}

export interface ClickModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * 是否按下了「跟随链接」的组合键：Ctrl（macOS 上是 Cmd），且不带 Shift/Alt。
 * 两种编辑模式共用同一判定，保证跳转手势全应用一致。
 */
export function isFollowLinkCombo(modifiers: ClickModifiers, platform: string): boolean {
  const mod = platform === 'darwin' ? modifiers.metaKey : modifiers.ctrlKey;
  return mod && !modifiers.shiftKey && !modifiers.altKey;
}

/**
 * 从点击目标上找最近的链接并返回其原始 href（相对路径不能读 DOM 的
 * `a.href`——它会被浏览器解析成应用自身地址，必须取 attribute）。
 * 是否跟随由 isFollowLinkCombo 另行判定，普通点击留给编辑器放置光标。
 */
export function pickLinkHrefFromClick(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest('a');
  if (!anchor) return null;
  return anchor.getAttribute('href') || null;
}

/**
 * 悬停光标提示：指针落在链接上且正按着跳转组合键时返回 true，
 * 编辑器据此让链接显示手指，与「此时点击会跳转」的可用状态一致；
 * 平时保持文本竖线，提示普通点击只移动光标。
 */
export function shouldHintFollowLink(
  target: EventTarget | null,
  modifiers: ClickModifiers,
  platform: string,
): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('a') != null && isFollowLinkCombo(modifiers, platform);
}
