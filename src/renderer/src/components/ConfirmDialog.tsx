import { useEffect, useRef } from 'react';
import { resolveConfirmDialog, useConfirmDialogState } from '../confirm-dialog';
import '../styles/confirm-dialog.css';

export function ConfirmDialog() {
  const request = useConfirmDialogState();
  const dialogRef = useRef<HTMLDivElement>(null);
  const defaultButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (request) defaultButtonRef.current?.focus();
  }, [request]);

  if (!request) return null;

  const { title, message, buttons, defaultId, cancelId } = request;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      resolveConfirmDialog(cancelId);
      return;
    }
    if (event.key === 'Tab') {
      const buttonEls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
      );
      if (buttonEls.length === 0) return;
      const activeIndex = buttonEls.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault();
      const next = event.shiftKey
        ? buttonEls[(activeIndex - 1 + buttonEls.length) % buttonEls.length]
        : buttonEls[(activeIndex + 1) % buttonEls.length];
      next.focus();
    }
  };

  return (
    <div className="confirm-overlay">
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onKeyDown={handleKeyDown}
      >
        <div id="confirm-dialog-title" className="confirm-title">
          {title}
        </div>
        <div id="confirm-dialog-message" className="confirm-message">
          {message}
        </div>
        <div className="confirm-actions">
          {buttons.map((label, index) => (
            <button
              key={label}
              ref={index === defaultId ? defaultButtonRef : undefined}
              className={index === defaultId ? 'confirm-btn confirm-btn-default' : 'confirm-btn'}
              onClick={() => resolveConfirmDialog(index)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
