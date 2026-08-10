import { useEffect, useId, useRef, useState } from 'react';
import { isPanelLayout, isToolbarWidth, selectSettings, type AppSettings } from '../settings';
import {
  FONT_PRESETS,
  FONT_SIZE_PRESETS,
  LETTER_SPACING_PRESETS,
  LINE_HEIGHT_PRESETS,
  isFontPresetId,
  isFontSizePresetId,
  isLetterSpacingPresetId,
  isLineHeightPresetId,
} from '../font-presets';
import { useStore } from '../stores/useStore';
import { isThemeId } from '../types';
import '../styles/settings-dialog.css';

interface SettingsDialogProps {
  onClose: () => void;
}

type SettingsSection = 'appearance' | 'font' | 'editor' | 'startup';

const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string }> = [
  { id: 'appearance', label: '外观' },
  { id: 'font', label: '字体' },
  { id: 'editor', label: '编辑器' },
  { id: 'startup', label: '启动' },
];

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<AppSettings>(() => selectSettings(useStore.getState()));
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance');
  const applySettings = useStore((state) => state.applySettings);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    contentRef.current?.querySelector<HTMLElement>('select, input')?.focus();

    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  const handleSectionChange = (section: SettingsSection): void => {
    setActiveSection(section);
    // 切换分类后把焦点送到右侧首个控件，避免焦点滞留在导航。
    requestAnimationFrame(() => {
      contentRef.current?.querySelector<HTMLElement>('select, input')?.focus();
    });
  };

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
              调整 InkMark 的外观、字体、编辑器与启动行为。
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
          <div className="settings-body">
            <nav className="settings-nav" aria-label="设置分类">
              {SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={`settings-nav-item ${section.id === activeSection ? 'active' : ''}`}
                  onClick={() => handleSectionChange(section.id)}
                >
                  {section.label}
                </button>
              ))}
            </nav>

            <div ref={contentRef} className="settings-content">
              {activeSection === 'appearance' && (
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
                      <span className="settings-field-hint">
                        调整工具栏外框宽度，不影响正文宽度。
                      </span>
                    </span>
                    <select
                      value={draft.toolbarWidth}
                      onChange={(event) => {
                        const toolbarWidth = event.target.value;
                        if (isToolbarWidth(toolbarWidth)) {
                          setDraft((settings) => ({ ...settings, toolbarWidth }));
                        }
                      }}
                    >
                      <option value="wide">宽</option>
                      <option value="medium">适中</option>
                      <option value="narrow">窄</option>
                    </select>
                  </label>
                </fieldset>
              )}

              {activeSection === 'font' && (
                <fieldset className="settings-group">
                  <legend>字体</legend>
                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">正文字体</span>
                      <span className="settings-field-hint">
                        编辑区的中文字体；所选字体需系统已安装，未安装时会自动回落到系统默认。
                      </span>
                    </span>
                    <select
                      value={draft.fontPreset}
                      onChange={(event) => {
                        const fontPreset = event.target.value;
                        if (isFontPresetId(fontPreset)) {
                          setDraft((settings) => ({ ...settings, fontPreset }));
                        }
                      }}
                    >
                      {FONT_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">字号</span>
                      <span className="settings-field-hint">编辑区正文与标题会同步缩放。</span>
                    </span>
                    <select
                      value={draft.fontSizePreset}
                      onChange={(event) => {
                        const fontSizePreset = event.target.value;
                        if (isFontSizePresetId(fontSizePreset)) {
                          setDraft((settings) => ({ ...settings, fontSizePreset }));
                        }
                      }}
                    >
                      {FONT_SIZE_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">行距</span>
                      <span className="settings-field-hint">调整正文行与行之间的距离。</span>
                    </span>
                    <select
                      value={draft.lineHeightPreset}
                      onChange={(event) => {
                        const lineHeightPreset = event.target.value;
                        if (isLineHeightPresetId(lineHeightPreset)) {
                          setDraft((settings) => ({ ...settings, lineHeightPreset }));
                        }
                      }}
                    >
                      {LINE_HEIGHT_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">字间距</span>
                      <span className="settings-field-hint">调整正文字符之间的松紧程度。</span>
                    </span>
                    <select
                      value={draft.letterSpacingPreset}
                      onChange={(event) => {
                        const letterSpacingPreset = event.target.value;
                        if (isLetterSpacingPresetId(letterSpacingPreset)) {
                          setDraft((settings) => ({ ...settings, letterSpacingPreset }));
                        }
                      }}
                    >
                      {LETTER_SPACING_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </fieldset>
              )}

              {activeSection === 'editor' && (
                <fieldset className="settings-group">
                  <legend>编辑器</legend>
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

                  <div className="settings-group-divider" role="separator" />

                  <label className="settings-field settings-field-checkbox">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">显示文件树</span>
                      <span className="settings-field-hint">
                        打开后可浏览文件夹内的 Markdown 文档，默认从状态栏或视图菜单切换。
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.fileTreeVisible}
                      onChange={(event) =>
                        setDraft((settings) => ({
                          ...settings,
                          fileTreeVisible: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">面板布局</span>
                      <span className="settings-field-hint">
                        选择大纲靠左还是靠右，文件树自动放在另一侧。是否显示由上面的开关单独控制。
                      </span>
                    </span>
                    <select
                      value={draft.panelLayout}
                      onChange={(event) => {
                        const panelLayout = event.target.value;
                        if (isPanelLayout(panelLayout)) {
                          setDraft((settings) => ({ ...settings, panelLayout }));
                        }
                      }}
                    >
                      <option value="outline-left">大纲左 / 文件树右</option>
                      <option value="outline-right">大纲右 / 文件树左</option>
                    </select>
                  </label>
                </fieldset>
              )}

              {activeSection === 'startup' && (
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
              )}
            </div>
          </div>

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
