import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useI18n } from '../i18n';
import type { PreviewImage } from '../plugins/image-view';
import { useStore } from '../stores/useStore';
import '../styles/image-preview.css';

interface ImagePreviewProps {
  image: PreviewImage;
  onClose: () => void;
}

export function ImagePreview({ image, onClose }: ImagePreviewProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const viewport = viewportRef.current;
    const picture = imageRef.current;
    if (!dialog || !viewport || !picture) return;

    dialog.showModal();
    let zoom = 1;
    const resizePicture = (): void => {
      if (!picture.naturalWidth || !picture.naturalHeight) return;
      const { width, height } = viewport.getBoundingClientRect();
      const fit = Math.min(1, width / picture.naturalWidth, height / picture.naturalHeight);
      picture.style.width = `${picture.naturalWidth * fit * zoom}px`;
      picture.style.height = `${picture.naturalHeight * fit * zoom}px`;
    };
    resizePicture();

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const nextZoom = Math.min(16, Math.max(1, zoom * 1.15 ** -Math.sign(event.deltaY)));
      if (!picture.naturalWidth || nextZoom === zoom) return;

      const before = picture.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - before.left) / before.width));
      const y = Math.max(0, Math.min(1, (event.clientY - before.top) / before.height));
      zoom = nextZoom;
      resizePicture();
      const after = picture.getBoundingClientRect();
      viewport.scrollLeft += after.left + x * after.width - event.clientX;
      viewport.scrollTop += after.top + y * after.height - event.clientY;
    };

    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.activeTabId !== previous.activeTabId || state.viewMode !== previous.viewMode) {
        dialog.close();
      }
    });
    picture.addEventListener('load', resizePicture);
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('resize', resizePicture);
    return () => {
      unsubscribe();
      picture.removeEventListener('load', resizePicture);
      viewport.removeEventListener('wheel', handleWheel);
      window.removeEventListener('resize', resizePicture);
      if (dialog.open) dialog.close();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="image-preview-dialog"
      aria-label={t('imagePreview.open')}
      onClose={() => {
        if (!dialogRef.current?.open) onClose();
      }}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="image-preview-close"
        aria-label={t('common.close')}
        onClick={() => dialogRef.current?.close()}
      >
        <X size={20} aria-hidden="true" />
      </button>
      <div ref={viewportRef} className="image-preview-viewport">
        <img ref={imageRef} src={image.src} alt={image.alt} draggable={false} />
      </div>
    </dialog>,
    document.body,
  );
}
