import { $view } from '@milkdown/kit/utils';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { useStore } from '../stores/useStore';

const PROTOCOL = 'inkmark-local';

function toLocalUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return `${PROTOCOL}:///${normalized}`;
}

function resolveLocalSrc(src: string, mdFilePath: string | null): string {
  if (!src) return '';
  if (/^https?:\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) {
    return src;
  }
  if (src.startsWith(`${PROTOCOL}:`)) {
    return src;
  }

  let absPath: string;
  if (/^[A-Za-z]:[\\/]/.test(src) || src.startsWith('\\\\') || src.startsWith('/')) {
    absPath = src;
  } else if (mdFilePath) {
    absPath = window.inkmark.resolvePath(window.inkmark.dirnamePath(mdFilePath), src);
  } else {
    absPath = src;
  }

  return toLocalUrl(absPath);
}

export const imageView = $view(imageSchema, () => (node) => {
  const dom = document.createElement('img');

  const applyAttrs = (attrs: { src: string; alt: string; title: string }) => {
    const state = useStore.getState();
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
    const mdPath = activeTab?.filePath ?? null;
    dom.src = resolveLocalSrc(attrs.src, mdPath);
    dom.alt = attrs.alt || '';
    if (attrs.title) {
      dom.title = attrs.title;
    } else {
      dom.removeAttribute('title');
    }
  };

  applyAttrs(node.attrs);

  return {
    dom,
    update: (newNode) => {
      if (newNode.type !== node.type) return false;
      applyAttrs(newNode.attrs);
      return true;
    },
  };
});