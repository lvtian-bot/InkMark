// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  followDocumentLinkHref,
  isFollowLinkCombo,
  pickLinkHrefFromClick,
  shouldHintFollowLink,
  type FollowLinkDeps,
} from './document-link';

function createDeps(): FollowLinkDeps & {
  opened: string[];
  externals: string[];
  resolveRequests: { sourcePath: string; href: string }[];
} {
  const opened: string[] = [];
  const externals: string[] = [];
  const resolveRequests: { sourcePath: string; href: string }[] = [];
  return {
    opened,
    externals,
    resolveRequests,
    resolveDocumentLink: vi.fn(async (request) => {
      resolveRequests.push(request);
      return { status: 'ok' as const, path: `RESOLVED(${request.href})` };
    }),
    openFilePath: vi.fn(async (path: string) => {
      opened.push(path);
    }),
    openExternalUrl: vi.fn((url: string) => {
      externals.push(url);
    }),
  };
}

describe('followDocumentLinkHref', () => {
  it('外链直接交给系统打开，不做路径解析', async () => {
    const deps = createDeps();
    await followDocumentLinkHref('https://example.com/a', 'C:\\docs\\a.md', deps);
    expect(deps.externals).toEqual(['https://example.com/a']);
    expect(deps.resolveRequests).toHaveLength(0);
    expect(deps.opened).toHaveLength(0);
  });

  it('文档链接经主进程解析后走打开流程', async () => {
    const deps = createDeps();
    await followDocumentLinkHref('./b.md', 'C:\\docs\\a.md', deps);
    expect(deps.resolveRequests).toEqual([{ sourcePath: 'C:\\docs\\a.md', href: './b.md' }]);
    expect(deps.opened).toEqual(['RESOLVED(./b.md)']);
    expect(deps.externals).toHaveLength(0);
  });

  it('未落盘的新文档没有基准目录，静默不动', async () => {
    const deps = createDeps();
    await followDocumentLinkHref('./b.md', null, deps);
    expect(deps.resolveRequests).toHaveLength(0);
    expect(deps.opened).toHaveLength(0);
  });

  it('目标不是文档类文件时保持现状', async () => {
    const deps = createDeps();
    await followDocumentLinkHref('./image.png', 'C:\\docs\\a.md', deps);
    expect(deps.resolveRequests).toHaveLength(0);
    expect(deps.opened).toHaveLength(0);
  });

  it('解析请求失败时静默不动，不向上抛错', async () => {
    const deps = createDeps();
    vi.mocked(deps.resolveDocumentLink).mockRejectedValueOnce(new Error('ipc broken'));
    await expect(followDocumentLinkHref('./b.md', 'C:\\docs\\a.md', deps)).resolves.toBeUndefined();
    expect(deps.opened).toHaveLength(0);
  });

  it('纯页内锚点不做处理', async () => {
    const deps = createDeps();
    await followDocumentLinkHref('#section', 'C:\\docs\\a.md', deps);
    expect(deps.externals).toHaveLength(0);
    expect(deps.resolveRequests).toHaveLength(0);
    expect(deps.opened).toHaveLength(0);
  });
});

describe('pickLinkHrefFromClick', () => {
  it('点击链接取原始 href 属性', () => {
    const anchor = document.createElement('a');
    anchor.setAttribute('href', './release.md');
    expect(pickLinkHrefFromClick(anchor)).toBe('./release.md');
  });

  it('点击链接内部的子元素也能命中外层链接', () => {
    const anchor = document.createElement('a');
    anchor.setAttribute('href', './release.md');
    const span = document.createElement('span');
    span.textContent = '发布说明';
    anchor.appendChild(span);
    expect(pickLinkHrefFromClick(span)).toBe('./release.md');
  });

  it('没有链接、空 href 或非元素目标都返回 null', () => {
    const div = document.createElement('div');
    expect(pickLinkHrefFromClick(div)).toBeNull();
    const anchor = document.createElement('a');
    anchor.setAttribute('href', '');
    expect(pickLinkHrefFromClick(anchor)).toBeNull();
    expect(pickLinkHrefFromClick(null)).toBeNull();
  });
});

describe('isFollowLinkCombo', () => {
  const none = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it('Windows/Linux 上按 Ctrl 触发，macOS 上按 Cmd 触发', () => {
    expect(isFollowLinkCombo({ ...none, ctrlKey: true }, 'win32')).toBe(true);
    expect(isFollowLinkCombo({ ...none, ctrlKey: true }, 'linux')).toBe(true);
    expect(isFollowLinkCombo({ ...none, metaKey: true }, 'darwin')).toBe(true);
  });

  it('非本平台修饰键不触发', () => {
    expect(isFollowLinkCombo({ ...none, metaKey: true }, 'win32')).toBe(false);
    expect(isFollowLinkCombo({ ...none, ctrlKey: true }, 'darwin')).toBe(false);
    expect(isFollowLinkCombo(none, 'win32')).toBe(false);
  });

  it('同时按住 Shift/Alt 按编辑意图处理，不触发跳转', () => {
    expect(isFollowLinkCombo({ ...none, ctrlKey: true, shiftKey: true }, 'win32')).toBe(false);
    expect(isFollowLinkCombo({ ...none, ctrlKey: true, altKey: true }, 'win32')).toBe(false);
    expect(isFollowLinkCombo({ ...none, metaKey: true, shiftKey: true }, 'darwin')).toBe(false);
  });
});

describe('shouldHintFollowLink', () => {
  const none = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  function makeAnchor(): HTMLAnchorElement {
    const anchor = document.createElement('a');
    anchor.setAttribute('href', './release.md');
    return anchor;
  }

  it('按住跳转键悬停在链接上时提示手指', () => {
    expect(shouldHintFollowLink(makeAnchor(), { ...none, ctrlKey: true }, 'win32')).toBe(true);
    expect(shouldHintFollowLink(makeAnchor(), { ...none, metaKey: true }, 'darwin')).toBe(true);
  });

  it('普通悬停不提示，保持文本竖线', () => {
    expect(shouldHintFollowLink(makeAnchor(), none, 'win32')).toBe(false);
  });

  it('悬停位置不在链接上时永不提示', () => {
    const div = document.createElement('div');
    expect(shouldHintFollowLink(div, { ...none, ctrlKey: true }, 'win32')).toBe(false);
    expect(shouldHintFollowLink(null, { ...none, ctrlKey: true }, 'win32')).toBe(false);
  });
});
