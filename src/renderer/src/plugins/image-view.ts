import { $view } from '@milkdown/kit/utils';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { useStore } from '../stores/useStore';

interface ImageAttributes {
  src?: string;
  alt?: string;
  title?: string;
}

function getActiveDocumentPath(): string | null {
  const state = useStore.getState();
  return state.tabs.find((tab) => tab.id === state.activeTabId)?.filePath ?? null;
}

let currentDocumentPath = getActiveDocumentPath();
const documentPathListeners = new Set<(documentPath: string | null) => void>();

useStore.subscribe((state) => {
  const nextDocumentPath = state.tabs.find((tab) => tab.id === state.activeTabId)?.filePath ?? null;
  if (nextDocumentPath === currentDocumentPath) return;
  currentDocumentPath = nextDocumentPath;
  for (const listener of documentPathListeners) listener(nextDocumentPath);
});

export const imageView = $view(imageSchema.node, () => (node) => {
  const dom = document.createElement('img');
  let attributes = node.attrs as ImageAttributes;
  let documentPath = currentDocumentPath;
  let resolveVersion = 0;

  const applyAttributes = async (): Promise<void> => {
    const currentVersion = ++resolveVersion;
    const source = attributes.src ?? '';
    dom.alt = attributes.alt ?? '';
    if (attributes.title) dom.title = attributes.title;
    else dom.removeAttribute('title');

    const result = await window.inkmark.resolveImageSource({ documentPath, source });
    if (currentVersion !== resolveVersion) return;
    if (result.status === 'ok') {
      dom.src = result.url;
      dom.removeAttribute('data-image-error');
    } else {
      dom.removeAttribute('src');
      dom.dataset.imageError = result.message;
      dom.title = attributes.title || result.message;
    }
  };

  void applyAttributes();
  const handleDocumentPathChange = (nextDocumentPath: string | null): void => {
    documentPath = nextDocumentPath;
    void applyAttributes();
  };
  documentPathListeners.add(handleDocumentPathChange);

  return {
    dom,
    update: (newNode) => {
      if (newNode.type !== node.type) return false;
      attributes = newNode.attrs as ImageAttributes;
      void applyAttributes();
      return true;
    },
    destroy: () => {
      resolveVersion += 1;
      documentPathListeners.delete(handleDocumentPathChange);
    },
  };
});
