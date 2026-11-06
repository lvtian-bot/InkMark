import { describe, expect, it, vi } from 'vitest';
import { rewriteMarkdownImageSources } from './markdown-image-references';

describe('rewriteMarkdownImageSources', () => {
  it('改写内联图片 URL，同时保持周围 Markdown 原样', () => {
    const markdown =
      '---\r\ntitle: demo\r\n---\r\n\r\n![first](old.assets/a%20b.png "title")\r\n\r\n```md\r\n![not-an-image](ignored.png)\r\n```\r\n';
    const replace = vi.fn((source: string) =>
      source === 'old.assets/a%20b.png' ? 'new.assets/a%20b.png' : source,
    );

    expect(rewriteMarkdownImageSources(markdown, replace)).toBe(
      '---\r\ntitle: demo\r\n---\r\n\r\n![first](new.assets/a%20b.png "title")\r\n\r\n```md\r\n![not-an-image](ignored.png)\r\n```\r\n',
    );
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('old.assets/a%20b.png');
  });

  it('支持尖括号路径和带括号的路径', () => {
    const replace = vi.fn((source: string) => `copied/${source.replaceAll('old/', '')}`);
    const markdown = '![one](<old/a b.png> "title")\n![two](old/(part).png)\n';

    expect(rewriteMarkdownImageSources(markdown, replace)).toBe(
      '![one](<copied/a b.png> "title")\n![two](copied/(part).png)\n',
    );
    expect(replace.mock.calls.map(([source]) => source)).toEqual(['old/a b.png', 'old/(part).png']);
  });

  it('只改写图片实际使用的引用定义，不把普通链接当成图片', () => {
    const markdown =
      '![first][asset]\n![second][]\n[regular][asset]\n\n[asset]: <old.assets/photo.png> "photo"\n';
    const replace = vi.fn(() => 'new.assets/photo.png');

    expect(rewriteMarkdownImageSources(markdown, replace)).toBe(
      '![first][asset]\n![second][]\n[regular][asset]\n\n[asset]: <new.assets/photo.png> "photo"\n',
    );
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('old.assets/photo.png');
  });

  it('使用首个定义，并保留找不到定义的图片引用', () => {
    const markdown =
      '![one][asset]\n\n[asset]: first.png\n[asset]: second.png\n\n![missing][unknown]\n';
    const replace = vi.fn((source: string) => `new-${source}`);

    expect(rewriteMarkdownImageSources(markdown, replace)).toBe(
      '![one][asset]\n\n[asset]: new-first.png\n[asset]: second.png\n\n![missing][unknown]\n',
    );
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('回调返回解析后原值时保留原始转义字节', () => {
    const markdown = '![image](old\\(part\\).png)\n';
    const replace = vi.fn((source: string) => source);

    expect(rewriteMarkdownImageSources(markdown, replace)).toBe(markdown);
    expect(replace).toHaveBeenCalledWith('old(part).png');
  });

  it('覆盖快捷引用、折叠引用、中文路径和包含代码片段的转义 alt', () => {
    const markdown =
      '![快捷图片]\n\n![折叠图片][]\n\n![中文 `x]` &amp;](old/中文.png)\n\n' +
      '[快捷图片]: shortcut.png\n[折叠图片]: collapsed.png\n';
    const replace = vi.fn((source: string) => `new/${source}`);

    expect(rewriteMarkdownImageSources(markdown, replace)).toBe(
      '![快捷图片]\n\n![折叠图片][]\n\n![中文 `x]` &amp;](new/old/中文.png)\n\n' +
        '[快捷图片]: new/shortcut.png\n[折叠图片]: new/collapsed.png\n',
    );
    expect(replace.mock.calls.map(([source]) => source)).toEqual([
      'old/中文.png',
      'shortcut.png',
      'collapsed.png',
    ]);
  });

  it('定位列表和引用块中换行后的引用定义 URL', () => {
    const markdown =
      '- ![列表图片][list]\n\n  [list]:\n    <old/list image.png>\n\n' +
      '> ![引用图片][quote]\n>\n> [quote]:\n>   old/quote.png\n';
    const replace = vi.fn((source: string) => `new/${source}`);

    expect(rewriteMarkdownImageSources(markdown, replace)).toBe(
      '- ![列表图片][list]\n\n  [list]:\n    <new/old/list image.png>\n\n' +
        '> ![引用图片][quote]\n>\n> [quote]:\n>   new/old/quote.png\n',
    );
    expect(replace.mock.calls.map(([source]) => source)).toEqual([
      'old/list image.png',
      'old/quote.png',
    ]);
  });

  it('定位嵌套引用块中的多行引用定义，不改写引用前缀', () => {
    const markdown = '> > ![嵌套图片][nested]\n> >\n> > [nested]:\n> >   old/nested.png\n';
    const replace = vi.fn(() => 'new/nested.png');

    expect(rewriteMarkdownImageSources(markdown, replace)).toBe(
      '> > ![嵌套图片][nested]\n> >\n> > [nested]:\n> >   new/nested.png\n',
    );
    expect(replace).toHaveBeenCalledWith('old/nested.png');
  });

  it('定位列表中的引用块定义，不改写列表和引用前缀', () => {
    const markdown = '- > ![组合图片][combined]\n  >\n  > [combined]:\n  >   old/combined.png\n';
    const replace = vi.fn(() => 'new/combined.png');

    expect(rewriteMarkdownImageSources(markdown, replace)).toBe(
      '- > ![组合图片][combined]\n  >\n  > [combined]:\n  >   new/combined.png\n',
    );
    expect(replace).toHaveBeenCalledWith('old/combined.png');
  });

  it('只把长度相同的反引号串当作代码片段边界', () => {
    const cases = ['![[`]``](img.png)\n', '![`[``]](img.png)\n'];

    for (const markdown of cases) {
      const replace = vi.fn(() => 'copied.png');
      expect(rewriteMarkdownImageSources(markdown, replace)).toBe(
        markdown.replace('img.png', 'copied.png'),
      );
      expect(replace).toHaveBeenCalledWith('img.png');
    }
  });

  it('支持引用块中换行并带引用前缀的内联图片目的地', () => {
    const cases = ['> ![图片](\n> old/one.png)\n', '> > ![图片](\n> > old/two.png)\n'];

    for (const markdown of cases) {
      const replace = vi.fn((source: string) => `new/${source}`);
      expect(rewriteMarkdownImageSources(markdown, replace)).toBe(
        markdown.replace(/old\/(one|two)\.png/, 'new/old/$1.png'),
      );
      expect(replace).toHaveBeenCalledTimes(1);
    }
  });
});
