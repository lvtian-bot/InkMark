import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { findLinkHrefAtPos } from './source-link';

function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdownLanguage] });
}

const DOC = [
  '见 [发布说明](./release.md) 与 [仓库](https://example.com)。',
  '',
  '自动链接：<https://example.com/auto>，以及裸地址 https://example.com/bare。',
  '',
  '![图片](./pic.png)',
  '',
  '引用式 [链接][ref] 不带内联地址。',
  '',
  '[ref]: ./target.md',
].join('\n');

describe('findLinkHrefAtPos', () => {
  const inlineStart = DOC.indexOf('[发布说明]');
  const inlineUrlStart = DOC.indexOf('(./release.md)');

  it('点击链接文字取到内联地址', () => {
    const state = makeState(DOC);
    const pos = inlineStart + 2; // 链接文字中间
    expect(findLinkHrefAtPos(state, pos)).toBe('./release.md');
  });

  it('点击地址部分同样取到内联地址', () => {
    const state = makeState(DOC);
    const pos = inlineUrlStart + 3;
    expect(findLinkHrefAtPos(state, pos)).toBe('./release.md');
  });

  it('点击方括号语法符号也能命中所在链接', () => {
    const state = makeState(DOC);
    expect(findLinkHrefAtPos(state, inlineStart)).toBe('./release.md');
  });

  it('http 内联链接取到完整地址', () => {
    const state = makeState(DOC);
    const pos = DOC.indexOf('[仓库]') + 2;
    expect(findLinkHrefAtPos(state, pos)).toBe('https://example.com');
  });

  it('尖括号自动链接按 URL 节点处理', () => {
    const state = makeState(DOC);
    const pos = DOC.indexOf('https://example.com/auto') + 5;
    const href = findLinkHrefAtPos(state, pos);
    expect(href === 'https://example.com/auto' || href === '<https://example.com/auto>').toBe(true);
  });

  it('图片地址作为 URL 节点返回，由上层按非文档目标自行过滤', () => {
    const state = makeState(DOC);
    const pos = DOC.indexOf('./pic.png') + 2;
    expect(findLinkHrefAtPos(state, pos)).toBe('./pic.png');
  });

  it('引用式链接没有内联地址，返回 null', () => {
    const state = makeState(DOC);
    const pos = DOC.indexOf('[链接][ref]') + 2;
    expect(findLinkHrefAtPos(state, pos)).toBeNull();
  });

  it('普通文本与非链接位置返回 null', () => {
    const state = makeState(DOC);
    const pos = DOC.indexOf('自动链接：') + 1;
    expect(findLinkHrefAtPos(state, pos)).toBeNull();
  });

  it('点击落在链接边界（紧贴结尾）也能命中', () => {
    const state = makeState(DOC);
    const inlineEnd = DOC.indexOf('(./release.md)') + '(./release.md)'.length;
    expect(findLinkHrefAtPos(state, inlineEnd)).toBe('./release.md');
  });
});
