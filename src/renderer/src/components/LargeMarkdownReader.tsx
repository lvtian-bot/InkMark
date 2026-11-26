import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { isFollowLinkCombo, pickLinkHrefFromClick, shouldHintFollowLink } from '../document-link';
import {
  renderMarkdownChunkToHtml,
  splitMarkdownForReader,
  type LargeMarkdownChunk,
  type LargeMarkdownDocument,
} from '../large-markdown-chunks';
import {
  notifyLargeReaderLayoutChange,
  recordLargeReaderScrollTop,
  setLargeReaderHandle,
} from '../large-reader-ref';
import type { PreviewImage } from '../plugins/image-view';
import { selectContentTheme, useStore } from '../stores/useStore';
import { useI18n } from '../i18n';
import type { Heading } from '../types';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { ImagePreview } from './ImagePreview';
import '../styles/large-markdown-reader.css';

interface LargeMarkdownReaderProps {
  tabId: string;
  content: string;
  filePath: string | null;
  initialScrollTop?: number;
  onDocInit: (headings: Heading[], content: string) => void;
  onFollowLink: (href: string) => void;
  onEditAttempt: () => void;
}

interface ReaderMenuSnapshot {
  left: number;
  top: number;
  items: ContextMenuItem[];
}

interface ReaderWindowState {
  doc: LargeMarkdownDocument;
  mounted: Set<number>;
  heights: ReadonlyMap<number, number>;
}

const VIEWPORT_BUFFER_PX = 900;
const INITIAL_CHUNK_COUNT = 3;
const HEADING_SCROLL_OFFSET_PX = 76;
const EMPTY_HEIGHTS: ReadonlyMap<number, number> = new Map();

const docHtmlCache = new WeakMap<LargeMarkdownDocument, Map<number, string>>();

function getCachedChunkHtml(doc: LargeMarkdownDocument, chunk: LargeMarkdownChunk): string {
  let cache = docHtmlCache.get(doc);
  if (!cache) {
    cache = new Map();
    docHtmlCache.set(doc, cache);
  }
  const hit = cache.get(chunk.id);
  if (hit !== undefined) return hit;
  const html = renderMarkdownChunkToHtml(chunk, doc.referenceDefs);
  cache.set(chunk.id, html);
  return html;
}

function computeWindowChunkIds(
  chunks: readonly LargeMarkdownChunk[],
  measuredHeights: ReadonlyMap<number, number>,
  scrollTop: number,
  viewportHeight: number,
  pinned: { from: number; to: number } | null,
): Set<number> {
  const result = new Set<number>();
  const minY = Math.max(0, scrollTop - VIEWPORT_BUFFER_PX);
  const effectiveViewport = viewportHeight > 0 ? viewportHeight : 900;
  const maxY = scrollTop + effectiveViewport + VIEWPORT_BUFFER_PX;

  let y = 0;
  for (const chunk of chunks) {
    const height = measuredHeights.get(chunk.id) ?? chunk.estimatedHeight;
    const bottom = y + height;
    if (bottom >= minY && y <= maxY) {
      result.add(chunk.id);
    }
    y = bottom;
  }

  if (result.size === 0 && chunks.length > 0) {
    const limit = Math.min(INITIAL_CHUNK_COUNT, chunks.length);
    for (let i = 0; i < limit; i++) result.add(chunks[i].id);
  }

  if (pinned) {
    for (let id = pinned.from; id <= pinned.to; id++) {
      if (id >= 0 && id < chunks.length) result.add(id);
    }
  }

  return result;
}

function setsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export function LargeMarkdownReader({
  tabId,
  content,
  filePath,
  initialScrollTop = 0,
  onDocInit,
  onFollowLink,
  onEditAttempt,
}: LargeMarkdownReaderProps) {
  const { t } = useI18n();
  const contentTheme = useStore(selectContentTheme);

  const doc = useMemo(() => splitMarkdownForReader(content), [content]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const onDocInitRef = useRef(onDocInit);
  const onFollowLinkRef = useRef(onFollowLink);
  const onEditAttemptRef = useRef(onEditAttempt);
  const docRef = useRef(doc);
  const filePathRef = useRef(filePath);
  const tabIdRef = useRef(tabId);
  const contentRef = useRef(content);
  const isAllSelectedRef = useRef(false);
  const selectingAllRef = useRef(false);
  const measuredHeightsRef = useRef<Map<number, number>>(new Map());
  const pinnedRangeRef = useRef<{ from: number; to: number } | null>(null);
  const pendingScrollPosRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  const [windowState, setWindowState] = useState<ReaderWindowState>(() => ({
    doc,
    mounted: computeWindowChunkIds(doc.chunks, EMPTY_HEIGHTS, initialScrollTop, 900, null),
    heights: EMPTY_HEIGHTS,
  }));

  const isCurrentDoc = windowState.doc === doc;
  const mountedIds = useMemo(
    () =>
      isCurrentDoc
        ? windowState.mounted
        : computeWindowChunkIds(doc.chunks, EMPTY_HEIGHTS, initialScrollTop, 900, null),
    [doc, initialScrollTop, isCurrentDoc, windowState.mounted],
  );
  const activeHeights = isCurrentDoc ? windowState.heights : EMPTY_HEIGHTS;
  const mountedIdsRef = useRef(mountedIds);

  useEffect(() => {
    onDocInitRef.current = onDocInit;
    onFollowLinkRef.current = onFollowLink;
    onEditAttemptRef.current = onEditAttempt;
    docRef.current = doc;
    filePathRef.current = filePath;
    tabIdRef.current = tabId;
    contentRef.current = content;
    mountedIdsRef.current = mountedIds;
  }, [content, doc, filePath, mountedIds, onDocInit, onEditAttempt, onFollowLink, tabId]);

  useEffect(() => {
    const handleSelectionChange = (): void => {
      if (selectingAllRef.current) return;
      isAllSelectedRef.current = false;
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  const [contextMenu, setContextMenu] = useState<{
    doc: LargeMarkdownDocument;
    tabId: string;
    snapshot: ReaderMenuSnapshot;
  } | null>(null);
  const [previewImage, setPreviewImage] = useState<{
    doc: LargeMarkdownDocument;
    tabId: string;
    image: PreviewImage;
  } | null>(null);

  const visibleContextMenu =
    contextMenu && contextMenu.doc === doc && contextMenu.tabId === tabId
      ? contextMenu.snapshot
      : null;
  const visiblePreviewImage =
    previewImage && previewImage.doc === doc && previewImage.tabId === tabId
      ? previewImage.image
      : null;

  const isFullDocumentSelection = useCallback((): boolean => {
    if (isAllSelectedRef.current) return true;
    const body = bodyRef.current;
    const selection = window.getSelection();
    if (!body || !selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    const firstChunk = body.firstElementChild as HTMLElement | null;
    const lastChunk = body.lastElementChild as HTMLElement | null;
    if (!firstChunk || !lastChunk) return false;

    let startsAtDocStart = false;
    if (range.startContainer === body) {
      startsAtDocStart = range.startOffset === 0;
    } else if (firstChunk.dataset.mounted === '1' && firstChunk.contains(range.startContainer)) {
      const prefix = document.createRange();
      prefix.setStart(firstChunk, 0);
      prefix.setEnd(range.startContainer, range.startOffset);
      startsAtDocStart = prefix.toString().length === 0;
    }

    if (!startsAtDocStart) return false;

    if (range.endContainer === body) {
      return range.endOffset >= body.childNodes.length;
    }
    if (lastChunk.dataset.mounted === '1' && lastChunk.contains(range.endContainer)) {
      const suffix = document.createRange();
      suffix.setStart(range.endContainer, range.endOffset);
      suffix.setEnd(lastChunk, lastChunk.childNodes.length);
      return suffix.toString().length === 0;
    }
    return false;
  }, []);

  const syncWindowToScroll = useCallback(() => {
    const container = containerRef.current;
    const currentDoc = docRef.current;
    const scrollTop = container?.scrollTop ?? 0;
    const viewportHeight = container?.clientHeight ?? 900;
    const nextMounted = computeWindowChunkIds(
      currentDoc.chunks,
      measuredHeightsRef.current,
      scrollTop,
      viewportHeight,
      pinnedRangeRef.current,
    );
    setWindowState((prev) => {
      if (prev.doc === currentDoc && setsEqual(prev.mounted, nextMounted)) {
        return prev;
      }
      return {
        doc: currentDoc,
        mounted: nextMounted,
        heights: new Map(measuredHeightsRef.current),
      };
    });
  }, []);

  // 文档或标签变化时重置可变的高度/滚动锚点，恢复该标签的阅读滚动位置；
  // 在清理函数里先落盘旧标签的滚动偏移，早于父级切换和 DOM 卸载。
  useLayoutEffect(() => {
    docRef.current = doc;
    filePathRef.current = filePath;
    tabIdRef.current = tabId;
    contentRef.current = content;
    isAllSelectedRef.current = false;
    measuredHeightsRef.current = new Map();
    pinnedRangeRef.current = null;
    pendingScrollPosRef.current = null;

    const targetTop = Number.isFinite(initialScrollTop) ? Math.max(0, initialScrollTop) : 0;
    const container = containerRef.current;
    if (container) {
      container.scrollTop = targetTop;
    }
    recordLargeReaderScrollTop(tabId, targetTop);
    mountedIdsRef.current = computeWindowChunkIds(
      doc.chunks,
      EMPTY_HEIGHTS,
      targetTop,
      container?.clientHeight ?? 900,
      null,
    );

    return () => {
      if (container) {
        recordLargeReaderScrollTop(tabId, container.scrollTop);
      }
    };
  }, [content, doc, filePath, tabId, initialScrollTop]);

  // 文档切分完成后立即同步大纲与字数统计。
  useEffect(() => {
    onDocInitRef.current(doc.headings, content);
  }, [content, doc, tabId]);

  // 测量已挂载片段真实高度，用于卸载后占位与向上滚动时的视口稳定；
  // 先于大纲跳转定位执行，且在存在待执行大纲跳转时仅记录高度不做滚动补偿，避免把目标标题顶出视口。
  useLayoutEffect(() => {
    const container = containerRef.current;
    const body = bodyRef.current;
    if (!container || !body) return;

    const measureAndAnchor = (commitState: boolean, suppressAnchor = false): void => {
      const elements = body.querySelectorAll<HTMLElement>('.large-reader-chunk[data-mounted="1"]');
      const heights = measuredHeightsRef.current;
      let scrollDelta = 0;
      let changed = false;

      for (const el of elements) {
        const idAttr = el.dataset.chunkId;
        if (!idAttr) continue;
        const id = Number(idAttr);
        const chunk = doc.chunks[id];
        if (!chunk) continue;
        const measured = el.offsetHeight;
        if (measured <= 0) continue;

        const prev = heights.get(id) ?? chunk.estimatedHeight;
        if (measured !== prev) {
          heights.set(id, measured);
          changed = true;
          // 仅当变化发生在当前可视顶部之上且非主动大纲跳转时补偿滚动位置，防止回滚跳动。
          if (!suppressAnchor && el.offsetTop + prev <= container.scrollTop + 4) {
            scrollDelta += measured - prev;
          }
        }
      }

      if (scrollDelta !== 0) {
        const nextTop = Math.max(0, container.scrollTop + scrollDelta);
        container.scrollTop = nextTop;
        recordLargeReaderScrollTop(tabIdRef.current, nextTop);
      }
      if (commitState && changed) {
        const snapshot = new Map(heights);
        setWindowState((prev) => ({
          doc,
          mounted: prev.doc === doc ? prev.mounted : mountedIdsRef.current,
          heights: snapshot,
        }));
      }
    };

    measureAndAnchor(false, pendingScrollPosRef.current !== null);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measureAndAnchor(true, pendingScrollPosRef.current !== null);
    });
    const elements = body.querySelectorAll<HTMLElement>('.large-reader-chunk[data-mounted="1"]');
    for (const el of elements) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [doc, mountedIds]);

  // 处理大纲点击后的精确定位滚动（在目标 chunk 完成挂载渲染与高度记录后执行）。
  useLayoutEffect(() => {
    const pos = pendingScrollPosRef.current;
    if (pos === null) return;
    const container = containerRef.current;
    const body = bodyRef.current;
    if (!container || !body) return;

    const chunkId = doc.headingToChunk.get(pos);
    if (chunkId !== undefined && !mountedIds.has(chunkId)) return;

    pendingScrollPosRef.current = null;
    const headingEl = body.querySelector<HTMLElement>(`[data-heading-pos="${pos}"]`);
    const fallbackEl =
      chunkId !== undefined
        ? body.querySelector<HTMLElement>(`[data-chunk-id="${chunkId}"]`)
        : null;
    const targetEl = headingEl ?? fallbackEl;
    if (!targetEl) return;

    const delta =
      targetEl.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      HEADING_SCROLL_OFFSET_PX;
    const nextTop = Math.max(0, container.scrollTop + delta);
    container.scrollTop = nextTop;
    recordLargeReaderScrollTop(tabIdRef.current, nextTop);
    notifyLargeReaderLayoutChange();
  }, [doc, mountedIds]);

  // IntersectionObserver 作为补充窗口驱动，快速拖动滚动条或内容高度变化时同步可见片段。
  useEffect(() => {
    const container = containerRef.current;
    const body = bodyRef.current;
    if (!container || !body || typeof IntersectionObserver === 'undefined') return;

    const io = new IntersectionObserver(
      (entries) => {
        const next = new Set(mountedIdsRef.current);
        let changed = false;
        for (const entry of entries) {
          const idAttr = (entry.target as HTMLElement).dataset.chunkId;
          if (!idAttr) continue;
          const id = Number(idAttr);
          if (entry.isIntersecting && !next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
        if (changed) {
          setWindowState({
            doc,
            mounted: next,
            heights: new Map(measuredHeightsRef.current),
          });
        }
      },
      {
        root: container,
        rootMargin: `${VIEWPORT_BUFFER_PX}px 0px`,
      },
    );

    const nodes = body.querySelectorAll<HTMLElement>('.large-reader-chunk[data-chunk-id]');
    for (const node of nodes) {
      io.observe(node);
    }
    return () => io.disconnect();
  }, [doc]);

  // 解析已挂载片段内的图片地址（本地相对路径通过主进程 IPC 转安全 URL）。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let cancelled = false;
    const docPath = filePath ?? null;
    const docKey = docPath ?? '';
    const images = body.querySelectorAll<HTMLImageElement>('img[data-inkmark-src]');

    for (const img of images) {
      if (img.dataset.inkmarkResolvedFor === docKey) continue;
      const rawSrc = img.dataset.inkmarkSrc ?? '';
      if (!rawSrc) continue;

      if (/^(https?:|data:|blob:)/i.test(rawSrc)) {
        img.dataset.inkmarkResolvedFor = docKey;
        img.src = rawSrc;
        img.removeAttribute('data-image-error');
        continue;
      }

      void window.inkmark
        .resolveImageSource({ documentPath: docPath, source: rawSrc })
        .then((result) => {
          if (
            cancelled ||
            !img.isConnected ||
            docRef.current !== doc ||
            filePathRef.current !== filePath
          ) {
            return;
          }
          img.dataset.inkmarkResolvedFor = docKey;
          if (result.status === 'ok') {
            img.src = result.url;
            img.removeAttribute('data-image-error');
          } else {
            img.removeAttribute('src');
            img.dataset.imageError = result.message;
            if (!img.title) img.title = result.message;
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [doc, filePath, mountedIds]);

  // 暴露与 Editor 对齐的句柄，供滚动恢复、大纲跳转、全选复制与源码切换使用。
  // 使用 useLayoutEffect 确保位于 JSX 前方的左侧 Outline 挂载时即可拿到容器句柄。
  useLayoutEffect(() => {
    setLargeReaderHandle({
      getScrollTop: () => containerRef.current?.scrollTop ?? 0,
      setScrollTop: (top: number) => {
        const container = containerRef.current;
        if (!container) return;
        const safeTop = Number.isFinite(top) ? Math.max(0, top) : 0;
        container.scrollTop = safeTop;
        recordLargeReaderScrollTop(tabIdRef.current, safeTop);
        syncWindowToScroll();
        notifyLargeReaderLayoutChange();
      },
      getScrollContainer: () => containerRef.current,
      getAnchorOffsetAtClientY: (lineClientY: number) => {
        const body = bodyRef.current;
        const currentDoc = docRef.current;
        if (!body || currentDoc.chunks.length === 0) return null;
        const children = body.children;
        if (children.length === 0) return null;
        let lo = 0;
        let hi = children.length - 1;
        let found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (children[mid].getBoundingClientRect().top <= lineClientY) {
            found = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        if (found === -1) return -1;
        const el = children[found] as HTMLElement;
        const idAttr = el.dataset.chunkId;
        const chunkId = idAttr !== undefined ? Number(idAttr) : found;
        const chunk = currentDoc.chunks[chunkId];
        if (!chunk) return null;
        if (el.dataset.mounted === '1') {
          return chunk.startOffset - 1;
        }
        const rect = el.getBoundingClientRect();
        const span = Math.max(0, chunk.endOffset - chunk.startOffset - 1);
        const ratio =
          rect.height > 0 ? Math.min(1, Math.max(0, (lineClientY - rect.top) / rect.height)) : 0;
        return chunk.startOffset + Math.floor(ratio * span);
      },
      getSelectedText: () =>
        isFullDocumentSelection() ? contentRef.current : (window.getSelection()?.toString() ?? ''),
      scrollToPos: (pos: number) => {
        const currentDoc = docRef.current;
        let chunkId = currentDoc.headingToChunk.get(pos);
        if (chunkId === undefined && currentDoc.chunks.length > 0) {
          const found = currentDoc.chunks.find(
            (chunk) => pos >= chunk.startOffset && pos < chunk.endOffset,
          );
          chunkId = found ? found.id : currentDoc.chunks.length - 1;
        }
        if (chunkId === undefined) return;

        const pinned = {
          from: Math.max(0, chunkId - 1),
          to: Math.min(currentDoc.chunks.length - 1, chunkId + 1),
        };
        pinnedRangeRef.current = pinned;
        pendingScrollPosRef.current = pos;

        setWindowState((prev) => {
          const base = prev.doc === currentDoc ? prev.mounted : mountedIdsRef.current;
          const next = new Set(base);
          for (let id = pinned.from; id <= pinned.to; id++) {
            next.add(id);
          }
          if (prev.doc === currentDoc && setsEqual(prev.mounted, next)) {
            return prev;
          }
          return {
            doc: currentDoc,
            mounted: next,
            heights: new Map(measuredHeightsRef.current),
          };
        });

        const container = containerRef.current;
        const body = bodyRef.current;
        if (container && body && mountedIdsRef.current.has(chunkId)) {
          const headingEl = body.querySelector<HTMLElement>(`[data-heading-pos="${pos}"]`);
          const targetEl =
            headingEl ?? body.querySelector<HTMLElement>(`[data-chunk-id="${chunkId}"]`);
          if (targetEl) {
            pendingScrollPosRef.current = null;
            const delta =
              targetEl.getBoundingClientRect().top -
              container.getBoundingClientRect().top -
              HEADING_SCROLL_OFFSET_PX;
            const nextTop = Math.max(0, container.scrollTop + delta);
            container.scrollTop = nextTop;
            recordLargeReaderScrollTop(tabIdRef.current, nextTop);
            notifyLargeReaderLayoutChange();
          }
        }
      },
    });

    return () => {
      setLargeReaderHandle(null);
    };
  }, [isFullDocumentSelection, syncWindowToScroll]);

  // 片段窗口完成挂载切换后通知大纲重新校对当前高亮标题。
  useEffect(() => {
    notifyLargeReaderLayoutChange();
  }, [doc, mountedIds]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  const handleScroll = (): void => {
    pinnedRangeRef.current = null;
    if (containerRef.current) {
      recordLargeReaderScrollTop(tabIdRef.current, containerRef.current.scrollTop);
    }
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      syncWindowToScroll();
    });
  };

  const selectAllReaderContent = (): void => {
    const body = bodyRef.current;
    if (!body) return;
    const selection = window.getSelection();
    if (!selection) return;
    selectingAllRef.current = true;
    const range = document.createRange();
    range.selectNodeContents(body);
    selection.removeAllRanges();
    selection.addRange(range);
    isAllSelectedRef.current = true;
    queueMicrotask(() => {
      selectingAllRef.current = false;
    });
  };

  const handleCopy = (event: ReactClipboardEvent<HTMLDivElement>): void => {
    if (!isFullDocumentSelection()) return;
    event.preventDefault();
    const fullText = contentRef.current;
    if (event.clipboardData) {
      event.clipboardData.setData('text/plain', fullText);
    } else {
      void window.inkmark.copyText(fullText);
    }
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target;
    const href = pickLinkHrefFromClick(target);
    // 与常规编辑器对齐：按住跟随链接组合键点击带链接的图片（如徽章）时优先打开链接。
    if (href && isFollowLinkCombo(event, window.inkmark.platform)) {
      event.preventDefault();
      onFollowLinkRef.current(href);
      return;
    }

    if (target instanceof HTMLImageElement && target.src) {
      event.preventDefault();
      setPreviewImage({ doc, tabId, image: { src: target.src, alt: target.alt } });
      return;
    }

    if (!href) return;
    // 只读预览始终阻止默认 <a> 导航，避免 Electron 窗口离开当前页面。
    event.preventDefault();
  };

  const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.currentTarget.classList.toggle(
      'is-link-follow-hint',
      shouldHintFollowLink(event.target, event, window.inkmark.platform),
    );
  };

  const handleMouseLeave = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.currentTarget.classList.remove('is-link-follow-hint');
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.context-menu')) return;
    event.preventDefault();

    const href = pickLinkHrefFromClick(target);
    const fullDocSelected = isFullDocumentSelection();
    const selection = window.getSelection();
    const hasSelection =
      fullDocSelected ||
      (!!selection && !selection.isCollapsed && !!bodyRef.current?.contains(selection.anchorNode));

    const items: ContextMenuItem[] = [];
    if (href) {
      items.push(
        { label: t('contextMenu.openLink'), onSelect: () => onFollowLinkRef.current(href) },
        {
          label: t('contextMenu.copyLinkAddress'),
          onSelect: () => void window.inkmark.copyText(href),
        },
      );
    }
    items.push(
      {
        label: t('menu.copy'),
        disabled: !hasSelection,
        onSelect: () => {
          if (fullDocSelected) {
            void window.inkmark.copyText(contentRef.current);
          } else {
            void window.inkmark.execClipboardCommand('copy');
          }
        },
      },
      {
        label: t('menu.selectAll'),
        onSelect: () => selectAllReaderContent(),
      },
    );

    setContextMenu({
      doc,
      tabId,
      snapshot: {
        left: event.clientX,
        top: event.clientY,
        items,
      },
    });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const isMod = window.inkmark.platform === 'darwin' ? event.metaKey : event.ctrlKey;
    if (isMod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAllReaderContent();
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (
      event.key.length === 1 ||
      event.key === 'Backspace' ||
      event.key === 'Delete' ||
      event.key === 'Enter' ||
      event.key === 'Process'
    ) {
      event.preventDefault();
      onEditAttemptRef.current();
    }
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault();
    onEditAttemptRef.current();
  };

  return (
    <div
      ref={containerRef}
      className={`editor-container large-reader-container theme-${contentTheme}`}
      onScroll={handleScroll}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div
        ref={bodyRef}
        data-milkdown-root=""
        className={`ProseMirror large-reader-body${contentTheme === 'github' ? ' markdown-body' : ''}`}
        tabIndex={0}
        role="document"
        aria-readonly="true"
        onMouseDown={() => {
          isAllSelectedRef.current = false;
        }}
        onCopy={handleCopy}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      >
        {doc.chunks.map((chunk) => {
          const isMounted = mountedIds.has(chunk.id);
          if (isMounted) {
            return (
              <div
                key={chunk.id}
                className="large-reader-chunk"
                data-chunk-id={chunk.id}
                data-mounted="1"
                dangerouslySetInnerHTML={{ __html: getCachedChunkHtml(doc, chunk) }}
              />
            );
          }
          const height = activeHeights.get(chunk.id) ?? chunk.estimatedHeight;
          return (
            <div
              key={chunk.id}
              className="large-reader-chunk large-reader-chunk-placeholder"
              data-chunk-id={chunk.id}
              data-mounted="0"
              style={{ height: `${height}px` }}
            />
          );
        })}
      </div>
      {visiblePreviewImage && (
        <ImagePreview image={visiblePreviewImage} onClose={() => setPreviewImage(null)} />
      )}
      {visibleContextMenu && (
        <ContextMenu
          left={visibleContextMenu.left}
          top={visibleContextMenu.top}
          items={visibleContextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
