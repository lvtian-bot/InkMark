// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LARGE_MARKDOWN_THRESHOLD_BYTES } from '../../shared/openable-document';
import { LargeMarkdownReader } from './components/LargeMarkdownReader';
import { Outline } from './components/Outline';
import { I18nProvider } from './i18n';
import { splitMarkdownForReader } from './large-markdown-chunks';
import { clearLargeReaderScrollTop, largeReaderHandle } from './large-reader-ref';
import { useStore } from './stores/useStore';
import type { Heading, InkMarkAPI } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialStore = useStore.getState();
const mountedRoots = new Set<Root>();

async function settleReact(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (condition()) return;
    await settleReact();
  }
  throw new Error(message);
}

describe('大文档只读预览与大纲同步及引用图片解析', () => {
  const resolveImageSpy = vi.fn(
    async ({ documentPath, source }: { documentPath: string | null; source: string }) => ({
      status: 'ok' as const,
      url: `inkmark-local://${documentPath ?? ''}/${source}`,
    }),
  );

  beforeEach(() => {
    resolveImageSpy.mockClear();
    window.inkmark = new Proxy(
      {
        platform: 'win32',
        resolveImageSource: resolveImageSpy,
      } as Partial<InkMarkAPI>,
      {
        get(target, prop: string | symbol) {
          if (prop in target) return target[prop as keyof typeof target];
          if (typeof prop === 'string' && prop.startsWith('on')) return () => () => undefined;
          return async () => undefined;
        },
      },
    ) as InkMarkAPI;
  });

  afterEach(async () => {
    for (const root of mountedRoots) {
      await act(async () => root.unmount());
    }
    mountedRoots.clear();
    for (const tab of useStore.getState().tabs) {
      clearLargeReaderScrollTop(tab.id);
    }
    useStore.setState(initialStore, true);
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('左侧大纲在无挂载标题的长章节中部滚动时仍更新高亮，且引用式本地图片走 resolveImageSource', async () => {
    const sectionAPadding = Array.from(
      { length: 240 },
      (_, i) => `- Section A line ${i} ${'a'.repeat(1400)}`,
    ).join('\n');
    const sectionBPadding = Array.from(
      { length: 600 },
      (_, i) => `- Section B line ${i} ${'b'.repeat(1400)}`,
    ).join('\n');
    const content = [
      '# Section A',
      '',
      '![RefPhoto][local-photo]',
      '',
      sectionAPadding,
      '',
      '# Section B',
      '',
      sectionBPadding,
      '',
      '# Section C',
      '',
      'Tail text',
      '',
      '[local-photo]: ./assets/photo.png "Local Photo"',
    ].join('\n');
    expect(Buffer.byteLength(content, 'utf8')).toBeGreaterThan(LARGE_MARKDOWN_THRESHOLD_BYTES);
    const parsedDoc = splitMarkdownForReader(content);

    const tabId = 'tab-large-outline';
    useStore.setState({
      ...initialStore,
      viewMode: 'wysiwyg',
      language: 'zh-CN',
      activeTabId: tabId,
      tabs: [
        {
          ...initialStore.tabs[0],
          id: tabId,
          filePath: 'D:/docs/big.md',
          fileName: 'big.md',
          recoveryOriginPath: null,
          sourceContent: content,
          isDirty: false,
          isStartPage: false,
          fileMtime: 1,
          externalUpdatePending: false,
          outline: [],
          wysiwygScrollTop: 0,
          sourceScrollTop: 0,
        },
      ],
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mountedRoots.add(root);

    const handleDocInit = (headings: Heading[]): void => {
      useStore.getState().updateTab(tabId, { outline: headings });
    };

    // 刻意把 Outline 放在 LargeMarkdownReader 之前，模拟 App 中左侧大纲布局
    await act(async () => {
      root.render(
        React.createElement(
          I18nProvider,
          null,
          React.createElement(
            'div',
            null,
            React.createElement(Outline, { side: 'left' }),
            React.createElement(LargeMarkdownReader, {
              tabId,
              content,
              filePath: 'D:/docs/big.md',
              onDocInit: handleDocInit,
              onFollowLink: () => undefined,
              onEditAttempt: () => undefined,
            }),
          ),
        ),
      );
    });

    await waitFor(
      () => host.querySelectorAll('.outline-item').length === 3,
      '大纲未同步全部 3 个章节标题',
    );
    await waitFor(
      () =>
        resolveImageSpy.mock.calls.some(
          ([arg]) => arg.documentPath === 'D:/docs/big.md' && arg.source === './assets/photo.png',
        ),
      '引用式本地图片未走 resolveImageSource 管线',
    );
    const resolvedImg = host.querySelector<HTMLImageElement>('img[alt="RefPhoto"]');
    expect(resolvedImg?.getAttribute('src')).toBe(
      'inkmark-local://D:/docs/big.md/./assets/photo.png',
    );

    const container = host.querySelector<HTMLElement>('.large-reader-container')!;
    const chunks = Array.from(host.querySelectorAll<HTMLElement>('.large-reader-chunk'));
    expect(chunks.length).toBe(parsedDoc.chunks.length);

    // 使用与 LargeMarkdownReader 虚拟窗口一致的分块估算高度模拟真实文档坐标
    const chunkTops: number[] = [];
    let cursorY = 0;
    for (const chunk of parsedDoc.chunks) {
      chunkTops.push(cursorY);
      cursorY += chunk.estimatedHeight;
    }
    const totalHeight = cursorY;
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: totalHeight });
    vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({
      top: 0,
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    chunks.forEach((chunkEl, index) => {
      const h = parsedDoc.chunks[index].estimatedHeight;
      vi.spyOn(chunkEl, 'getBoundingClientRect').mockImplementation(() => {
        const top = chunkTops[index] - container.scrollTop;
        return {
          top,
          bottom: top + h,
          height: h,
          left: 0,
          right: 800,
          width: 800,
          x: 0,
          y: top,
          toJSON: () => ({}),
        };
      });
    });

    // 先处于 Section A 顶部，确认高亮为 Section A
    const headingA = host.querySelector<HTMLElement>('[data-heading-pos="0"]')!;
    vi.spyOn(headingA, 'getBoundingClientRect').mockReturnValue({
      top: 20,
      bottom: 50,
      height: 30,
      left: 0,
      right: 800,
      width: 800,
      x: 0,
      y: 20,
      toJSON: () => ({}),
    });
    await act(async () => {
      container.scrollTop = 0;
      container.dispatchEvent(new Event('scroll'));
    });
    await waitFor(
      () => host.querySelector('.outline-item.active')?.textContent === 'Section A',
      '位于文档顶部时大纲未高亮 Section A',
    );

    // 定位到 Section B 正中间的无标题分块（与 Section B/C 标题所在分块均保持安全距离）
    const headingBChunk = parsedDoc.headingToChunk.get(parsedDoc.headings[1].pos)!;
    const headingCChunk = parsedDoc.headingToChunk.get(parsedDoc.headings[2].pos)!;
    const midSectionBChunk = Math.floor((headingBChunk + headingCChunk) / 2);
    expect(parsedDoc.chunks[midSectionBChunk].headingPositions).toHaveLength(0);
    const midSectionBScrollTop =
      chunkTops[midSectionBChunk] +
      Math.floor(parsedDoc.chunks[midSectionBChunk].estimatedHeight / 2);

    await act(async () => {
      largeReaderHandle.current?.setScrollTop(midSectionBScrollTop);
      container.dispatchEvent(new Event('scroll'));
    });
    await waitFor(
      () =>
        host.querySelectorAll('[data-heading-pos]').length === 0 &&
        host.querySelector('.outline-item.active')?.textContent === 'Section B',
      '滚动至无已挂载标题的 Section B 中段时大纲未更新为 Section B',
    );
  });

  it('带链接的图片按住 Ctrl 点击优先打开外链，普通点击打开预览；大纲跳转不被前序高块高度差顶偏', async () => {
    const padding = Array.from({ length: 420 }, (_, i) => `- Row ${i} ${'p'.repeat(2600)}`).join(
      '\n',
    );
    const content = [
      '# Top',
      '',
      '[![CI](https://example.com/badge.svg)](https://example.com/actions)',
      '',
      padding,
      '',
      '# Target Heading',
      '',
      'End content',
    ].join('\n');
    expect(Buffer.byteLength(content, 'utf8')).toBeGreaterThan(LARGE_MARKDOWN_THRESHOLD_BYTES);
    const parsedDoc = splitMarkdownForReader(content);
    const targetHeading = parsedDoc.headings.find((h) => h.text === 'Target Heading')!;
    const targetChunkId = parsedDoc.headingToChunk.get(targetHeading.pos)!;
    expect(targetChunkId).toBeGreaterThanOrEqual(3);

    const followLinkSpy = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mountedRoots.add(root);

    await act(async () => {
      root.render(
        React.createElement(
          I18nProvider,
          null,
          React.createElement(LargeMarkdownReader, {
            tabId: 'tab-badge-jump',
            content,
            filePath: 'D:/docs/badge.md',
            onDocInit: () => undefined,
            onFollowLink: followLinkSpy,
            onEditAttempt: () => undefined,
          }),
        ),
      );
    });

    await waitFor(
      () => !!host.querySelector('a[href="https://example.com/actions"] img'),
      '未渲染带链接的徽章图片',
    );
    const badgeImg = host.querySelector<HTMLImageElement>(
      'a[href="https://example.com/actions"] img',
    )!;
    // Ctrl+点击徽章应打开链接，而非弹出图片预览
    await act(async () => {
      badgeImg.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
      );
    });
    expect(followLinkSpy).toHaveBeenCalledWith('https://example.com/actions');
    expect(document.body.querySelector('.image-preview-dialog')).toBeNull();

    // 普通点击徽章打开图片预览，不再触发链接打开
    followLinkSpy.mockClear();
    await act(async () => {
      badgeImg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(followLinkSpy).not.toHaveBeenCalled();
    expect(document.body.querySelector('.image-preview-dialog')).not.toBeNull();

    // 模拟前序分块实际高度（3800px）远大于估算高度，验证大纲跳转不发生二次补偿顶偏
    const container = host.querySelector<HTMLElement>('.large-reader-container')!;
    const predChunkEl = host.querySelector<HTMLElement>(
      `.large-reader-chunk[data-chunk-id="${targetChunkId - 1}"]`,
    )!;
    const targetChunkEl = host.querySelector<HTMLElement>(
      `.large-reader-chunk[data-chunk-id="${targetChunkId}"]`,
    )!;
    Object.defineProperty(predChunkEl, 'offsetHeight', { configurable: true, value: 3800 });
    Object.defineProperty(predChunkEl, 'offsetTop', { configurable: true, value: 5000 });
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(targetChunkEl, 'getBoundingClientRect').mockImplementation(() => ({
      top: 9000 - container.scrollTop,
      bottom: 9500 - container.scrollTop,
      height: 500,
      left: 0,
      right: 800,
      width: 800,
      x: 0,
      y: 9000 - container.scrollTop,
      toJSON: () => ({}),
    }));
    // 给目标标题定位回落到 9000（即使挂载后用 headingEl.getBoundingClientRect）
    const origGetBCR = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset?.headingPos === String(targetHeading.pos)) {
        const top = 9000 - container.scrollTop;
        return {
          top,
          bottom: top + 32,
          height: 32,
          left: 0,
          right: 800,
          width: 800,
          x: 0,
          y: top,
          toJSON: () => ({}),
        };
      }
      return origGetBCR.call(this);
    });

    await act(async () => {
      largeReaderHandle.current?.scrollToPos(targetHeading.pos);
    });
    await waitFor(
      () => host.querySelector(`[data-heading-pos="${targetHeading.pos}"]`) !== null,
      '目标章节分块未完成挂载',
    );

    // 应精准停在 9000 - 76 = 8924，而非被 predChunkEl 的 (3800 - estimatedHeight) 再次顶偏
    expect(container.scrollTop).toBe(8924);
  });
});
