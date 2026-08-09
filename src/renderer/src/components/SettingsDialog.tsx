import { useEffect, useId, useRef, useState } from 'react';
import {
  OUTLINE_WIDTH_MAX,
  OUTLINE_WIDTH_MIN,
  type AppSettings,
  type ToolbarWidth,
} from '../settings';
import { useStore } from '../stores/useStore';
import { isThemeId } from '../types';
import '../styles/settings-dialog.css';

interface SettingsDialogProps {
  onClose: () => void;
}

function currentSettings(): AppSettings {
  const state = useStore.getState();
  return {
    themeId: state.themeId,
    outlineWidth: state.outlineWidth,
    outlineVisible: state.outlineVisible,
    toolbarWidth: state.toolbarWidth,
    startPageOnLaunch: state.startPageOnLaunch,
  };
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstControlRef = useRef<HTMLSelectElement>(null);
  const [draft, setDraft] = useState<AppSettings>(currentSettings);
  const applySettings = useStore((state) => state.applySettings);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    firstControlRef.current?.focus();

    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);
    if (!firstElement || !lastElement) return;

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    applySettings(draft);
    onClose();
  };

  return (
    <div className="settings-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id={titleId} className="settings-title">
              设置
            </h2>
            <p id={descriptionId} className="settings-description">
              调整 InkMark 的外观、大纲与启动页面。
            </p>
          </div>
          <button
            className="settings-icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
          >
            ×
          </button>
        </header>

        <form className="settings-form" onSubmit={handleSubmit}>
          <fieldset className="settings-group">
            <legend>外观</legend>
            <label className="settings-field">
              <span className="settings-field-copy">
                <span className="settings-field-label">主题</span>
                <span className="settings-field-hint">
                  控制整体明暗与正文排版风格，与主题菜单一致。
                </span>
              </span>
              <select
                ref={firstControlRef}
                value={draft.themeId}
                onChange={(event) => {
                  const themeId = event.target.value;
                  if (isThemeId(themeId)) {
                    setDraft((settings) => ({ ...settings, themeId }));
                  }
                }}
              >
                <option value="inkmark-light">InkMark 亮色</option>
                <option value="inkmark-dark">InkMark 暗色</option>
                <option value="github-light">GitHub 亮色</option>
                <option value="github-dark">GitHub 暗色</option>
              </select>
            </label>

            <label className="settings-field">
              <span className="settings-field-copy">
                <span className="settings-field-label">工具栏宽度</span>
                <span className="settings-field-hint">调整工具栏外框宽度，不影响正文宽度。</span>
              </span>
              <select
                value={draft.toolbarWidth}
                onChange={(event) =>
                  setDraft((settings) => ({
                    ...settings,
                    toolbarWidth: event.target.value as ToolbarWidth,
                  }))
                }
              >
                <option value="wide">宽</option>
                <option value="medium">适中</option>
                <option value="narrow">窄</option>
              </select>
            </label>
          </fieldset>

          <fieldset className="settings-group">
            <legend>启动</legend>
            <label className="settings-field">
              <span className="settings-field-copy">
                <span className="settings-field-label">启动初始页</span>
                <span className="settings-field-hint">
                  应用启动时显示开始页还是空白编辑器；新建标签页始终显示开始页。
                </span>
              </span>
              <select
                value={draft.startPageOnLaunch ? 'start' : 'blank'}
                onChange={(event) =>
                  setDraft((settings) => ({
                    ...settings,
                    startPageOnLaunch: event.target.value === 'start',
                  }))
                }
              >
                <option value="start">开始页</option>
                <option value="blank">空白页</option>
              </select>
            </label>
          </fieldset>

          <fieldset className="settings-group">
            <legend>大纲</legend>
            <label className="settings-field settings-field-checkbox">
              <span className="settings-field-copy">
                <span className="settings-field-label">显示大纲</span>
                <span className="settings-field-hint">启动时在编辑区左侧显示文档结构。</span>
              </span>
              <input
                type="checkbox"
                checked={draft.outlineVisible}
                onChange={(event) =>
                  setDraft((settings) => ({
                    ...settings,
                    outlineVisible: event.target.checked,
                  }))
                }
              />
            </label>

            <label className="settings-field">
              <span className="settings-field-copy">
                <span className="settings-field-label">大纲宽度</span>
                <span className="settings-field-hint">
                  可设置 {OUTLINE_WIDTH_MIN}–{OUTLINE_WIDTH_MAX} 像素，也可在主界面拖动调整。
                </span>
              </span>
              <span className="settings-number-control">
                <input
                  type="number"
                  min={OUTLINE_WIDTH_MIN}
                  max={OUTLINE_WIDTH_MAX}
                  step="1"
                  value={draft.outlineWidth}
                  onChange={(event) => {
                    const outlineWidth = event.target.valueAsNumber;
                    if (!Number.isNaN(outlineWidth)) {
                      setDraft((settings) => ({ ...settings, outlineWidth }));
                    }
                  }}
                />
                <span aria-hidden="true">px</span>
              </span>
            </label>
          </fieldset>

          <footer className="settings-actions">
            <button
              className="settings-button settings-button-secondary"
              type="button"
              onClick={onClose}
            >
              取消
            </button>
            <button className="settings-button settings-button-primary" type="submit">
              确定
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
