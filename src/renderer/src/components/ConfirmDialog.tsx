import { useEffect, useRef } from 'react';
import {
  resolveConfirmDialog,
  resolvePromptDialog,
  useConfirmDialogState,
  usePromptDialogState,
} from '../confirm-dialog';
import '../styles/confirm-dialog.css';

export function ConfirmDialog() {
  const request = useConfirmDialogState();
  const promptRequest = usePromptDialogState();
  const dialogRef = useRef<HTMLDivElement>(null);
  const defaultButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (request) {
      defaultButtonRef.current?.focus();
    } else if (promptRequest && inputRef.current) {
      inputRef.current.value = promptRequest.defaultValue ?? '';
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [request, promptRequest]);

  if (request) {
    const { title, message, buttons, defaultId, cancelId, diff } = request;

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
          className={`confirm-dialog ${diff ? 'confirm-dialog-wide' : ''}`}
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
          {diff && (
            <div className="confirm-diff" aria-label="磁盘版本与当前编辑版本的差异">
              <div className="confirm-diff-legend">
                <span className="confirm-diff-removed">− 磁盘版本</span>
                <span className="confirm-diff-added">+ 当前编辑版本</span>
              </div>
              <pre className="confirm-diff-content">
                {diff.map((part, index) => {
                  const prefix =
                    part.kind === 'added' ? '+ ' : part.kind === 'removed' ? '- ' : '  ';
                  const lines = part.value.split('\n');
                  const display = lines
                    .map((line, lineIndex) => {
                      if (lineIndex === lines.length - 1 && line === '') return '';
                      return `${prefix}${line}\n`;
                    })
                    .join('');
                  return (
                    <span key={index} className={`confirm-diff-${part.kind}`}>
                      {display}
                    </span>
                  );
                })}
              </pre>
            </div>
          )}
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

  if (promptRequest) {
    const handleConfirm = (): void => {
      const value = inputRef.current?.value.trim() ?? '';
      resolvePromptDialog(value || null);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        resolvePromptDialog(null);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        handleConfirm();
      }
    };

    return (
      <div className="confirm-overlay">
        <div
          ref={dialogRef}
          className="confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
          onKeyDown={handleKeyDown}
        >
          <div id="confirm-dialog-title" className="confirm-title">
            {promptRequest.title}
          </div>
          <div id="confirm-dialog-message" className="confirm-message">
            {promptRequest.message}
          </div>
          <input
            ref={inputRef}
            className="prompt-input"
            type="text"
            placeholder={promptRequest.placeholder}
          />
          <div className="confirm-actions">
            <button className="confirm-btn" onClick={() => resolvePromptDialog(null)}>
              {promptRequest.cancelLabel}
            </button>
            <button
              ref={defaultButtonRef}
              className="confirm-btn confirm-btn-default"
              onClick={handleConfirm}
            >
              {promptRequest.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
