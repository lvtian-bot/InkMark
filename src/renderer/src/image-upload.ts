import { Fragment, type Node } from '@milkdown/kit/prose/model';
import type { Uploader } from '@milkdown/plugin-upload';
import { confirmDialog } from './confirm-dialog';
import { t } from './i18n';
import { useStore } from './stores/useStore';

let activeImageUploads = 0;
const idleWaiters = new Set<() => void>();

export function isImageUploadInProgress(): boolean {
  return activeImageUploads > 0;
}

export function waitForImageUploads(): Promise<void> {
  if (activeImageUploads === 0) return Promise.resolve();
  return new Promise<void>((resolve) => idleWaiters.add(resolve));
}

async function showImageError(message: string): Promise<void> {
  await confirmDialog(t('confirm.imageNotInserted'), message, [t('common.ok')]);
}

export const storeLocalImages: Uploader = async (files, schema) => {
  activeImageUploads += 1;
  try {
    const state = useStore.getState();
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    const documentPath = activeTab?.filePath ?? null;
    const tabId = activeTab?.id ?? null;

    if (!documentPath) {
      await showImageError(t('confirm.imageNotInsertedHint'));
      return Fragment.empty;
    }

    const nodes: Node[] = [];
    const storedPaths: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files.item(index);
      if (!file) continue;

      try {
        const result = await window.inkmark.storeImage({
          documentPath,
          data: new Uint8Array(await file.arrayBuffer()),
          fileName: file.name || 'image',
        });
        if (result.status === 'error') {
          await showImageError(result.message);
          continue;
        }

        const imageNode = schema.nodes.image.createAndFill({
          src: result.relativePath,
          alt: file.name || t('image.alt'),
        });
        if (imageNode) {
          nodes.push(imageNode);
          storedPaths.push(result.relativePath);
        } else {
          await window.inkmark.discardStoredImage({
            documentPath,
            relativePath: result.relativePath,
          });
        }
      } catch {
        await showImageError(t('image.readFailed'));
      }
    }

    const currentState = useStore.getState();
    const currentTab = currentState.tabs.find((tab) => tab.id === currentState.activeTabId);
    if (currentTab?.id !== tabId || currentTab.filePath !== documentPath) {
      await Promise.all(
        storedPaths.map((relativePath) =>
          window.inkmark.discardStoredImage({ documentPath, relativePath }),
        ),
      );
      await showImageError(t('image.switchedDuringUpload'));
      return Fragment.empty;
    }

    return Fragment.from(nodes);
  } finally {
    activeImageUploads -= 1;
    if (activeImageUploads === 0) {
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    }
  }
};
