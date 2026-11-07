import { $view } from '@milkdown/kit/utils';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { t as translate } from '../i18n';
import { tabDocumentPath, useStore } from '../stores/useStore';

interface ImageAttributes {
  src?: string;
  alt?: string;
  title?: string;
}

function getActiveDocumentPath(): string | null {
  const state = useStore.getState();
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  return tab ? tabDocumentPath(tab) : null;
}

let currentDocumentPath = getActiveDocumentPath();
const documentPathListeners = new Set<(documentPath: string | null) => void>();

useStore.subscribe((state) => {
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  const nextDocumentPath = tab ? tabDocumentPath(tab) : null;
  if (nextDocumentPath === currentDocumentPath) return;
  currentDocumentPath = nextDocumentPath;
  for (const listener of documentPathListeners) listener(nextDocumentPath);
});

export interface PreviewImage {
  src: string;
  alt: string;
}

export const imageView = (onPreview: (image: PreviewImage) => void) =>
  $view(imageSchema.node, () => (node) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'editor-image';
    const dom = document.createElement('img');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'editor-image-zoom';
    button.contentEditable = 'false';
    button.hidden = true;
    button.setAttribute('aria-label', translate('imagePreview.open'));
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!button.hidden) onPreview({ src: dom.src, alt: dom.alt });
    });
    wrapper.append(dom, button);
    let attributes = node.attrs as ImageAttributes;
    let documentPath = currentDocumentPath;
    let resolveVersion = 0;
    let resolved = false;

    const updatePreviewButton = (): void => {
      button.hidden = !resolved || !dom.complete || dom.naturalWidth === 0;
    };

    const applyAttributes = async (): Promise<void> => {
      const currentVersion = ++resolveVersion;
      resolved = false;
      updatePreviewButton();
      const source = attributes.src ?? '';
      dom.alt = attributes.alt ?? '';
      if (attributes.title) dom.title = attributes.title;
      else dom.removeAttribute('title');

      const result = await window.inkmark.resolveImageSource({ documentPath, source });
      if (currentVersion !== resolveVersion) return;
      if (result.status === 'ok') {
        resolved = true;
        dom.src = result.url;
        dom.removeAttribute('data-image-error');
      } else {
        dom.removeAttribute('src');
        dom.dataset.imageError = result.message;
        dom.title = attributes.title || result.message;
      }
      updatePreviewButton();
    };

    dom.addEventListener('load', updatePreviewButton);
    dom.addEventListener('error', updatePreviewButton);

    void applyAttributes();
    const handleDocumentPathChange = (nextDocumentPath: string | null): void => {
      documentPath = nextDocumentPath;
      void applyAttributes();
    };
    documentPathListeners.add(handleDocumentPathChange);

    return {
      dom: wrapper,
      stopEvent: (event) => event.target === button,
      ignoreMutation: (mutation) => mutation.type !== 'selection',
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
