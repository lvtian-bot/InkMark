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
import {
  DEFAULT_SHORTCUT_MAP,
  SHORTCUT_ACTIONS,
  SHORTCUT_ACTION_META,
  comboEquals,
  findShortcutConflicts,
  formatComboForDisplay,
  normalizeShortcutMap,
  toDisplayPlatform,
  type ShortcutAction,
} from '../../../shared/shortcuts';
import { comboFromKeyboardEvent } from '../shortcut-recorder';
import '../styles/settings-dialog.css';

interface SettingsDialogProps {
  onClose: () => void;
}

type SettingsSection = 'appearance' | 'font' | 'editor' | 'startup' | 'shortcuts';

const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string }> = [
  { id: 'appearance', label: '外观' },
  { id: 'font', label: '字体' },
  { id: 'editor', label: '编辑器' },
  { id: 'startup', label: '启动' },
  { id: 'shortcuts', label: '快捷键' },
];

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<AppSettings>(() => selectSettings(useStore.getState()));
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance');
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const applySettings = useStore((state) => state.applySettings);
  const displayPlatform = toDisplayPlatform(window.inkmark.platform);

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

  const shortcutConflicts = findShortcutConflicts(draft.shortcuts);
  const hasShortcutConflict = SHORTCUT_ACTIONS.some(
    (action) => (shortcutConflicts.get(action)?.length ?? 0) > 0,
  );

  // 录制：捕获阶段挂到 window，抢在编辑器/对话框自身处理之前消费按键。
  // Esc 取消录制（不关闭对话框）；纯修饰键或不支持的键继续等待；必须含 Ctrl/Cmd 才接受。
  useEffect(() => {
    if (!recordingAction) return;
    const handleRecording = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecordingAction(null);
        return;
      }
      const combo = comboFromKeyboardEvent(event, window.inkmark.platform);
      if (!combo || !combo.mod) return;
      setDraft((settings) => ({
        ...settings,
        shortcuts: { ...settings.shortcuts, [recordingAction]: combo },
      }));
      setRecordingAction(null);
    };
    window.addEventListener('keydown', handleRecording, true);
    return () => window.removeEventListener('keydown', handleRecording, true);
  }, [recordingAction]);

  const resetShortcut = (action: ShortcutAction): void => {
    setDraft((settings) => ({
      ...settings,
      shortcuts: { ...settings.shortcuts, [action]: { ...DEFAULT_SHORTCUT_MAP[action] } },
    }));
  };

  const resetAllShortcuts = (): void => {
    setDraft((settings) => ({
      ...settings,
      shortcuts: normalizeShortcutMap(DEFAULT_SHORTCUT_MAP),
    }));
    setRecordingAction(null);
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

                  <div className="settings-group-divider" role="separator" />

                  <label className="settings-field settings-field-checkbox">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">标记浮现（实验性）</span>
                      <span className="settings-field-hint">
                        光标进入标题、引用或列表时，行首浮现 Markdown 标记符号（#、&gt;、-
                        等）并可编辑。仍在完善中，可能有不稳定的体验。
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.blockMarkerReveal}
                      onChange={(event) =>
                        setDraft((settings) => ({
                          ...settings,
                          blockMarkerReveal: event.target.checked,
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

              {activeSection === 'shortcuts' && (
                <fieldset className="settings-group">
                  <legend>快捷键</legend>
                  <div className="settings-shortcuts-toolbar">
                    <span className="settings-field-hint">
                      点击「录入」后按下组合键（需含 Ctrl 或 Cmd），Esc
                      取消。加粗、斜体等格式键沿用编辑器默认，不在此配置。
                    </span>
                    <button
                      type="button"
                      className="settings-link-button"
                      onClick={resetAllShortcuts}
                    >
                      全部重置
                    </button>
                  </div>
                  <ul className="settings-shortcut-list">
                    {SHORTCUT_ACTIONS.map((action) => {
                      const meta = SHORTCUT_ACTION_META[action];
                      const combo = draft.shortcuts[action];
                      const conflictWith = shortcutConflicts.get(action) ?? [];
                      const isRecording = recordingAction === action;
                      const unchanged = comboEquals(combo, DEFAULT_SHORTCUT_MAP[action]);
                      return (
                        <li
                          key={action}
                          className={`settings-shortcut-row${conflictWith.length > 0 ? ' is-conflict' : ''}${isRecording ? ' is-recording' : ''}`}
                        >
                          <div className="settings-shortcut-info">
                            <span className="settings-shortcut-label">{meta.label}</span>
                            {meta.hint && (
                              <span className="settings-shortcut-hint">{meta.hint}</span>
                            )}
                          </div>
                          <div className="settings-shortcut-control">
                            {isRecording ? (
                              <span className="settings-shortcut-recording">按下组合键…</span>
                            ) : (
                              <kbd className="settings-shortcut-keys">
                                {formatComboForDisplay(combo, displayPlatform)}
                              </kbd>
                            )}
                            <button
                              type="button"
                              className="settings-shortcut-btn"
                              onClick={() => setRecordingAction(isRecording ? null : action)}
                            >
                              {isRecording ? '取消' : '录入'}
                            </button>
                            <button
                              type="button"
                              className="settings-shortcut-btn"
                              onClick={() => resetShortcut(action)}
                              disabled={unchanged}
                            >
                              重置
                            </button>
                          </div>
                          {conflictWith.length > 0 && (
                            <span className="settings-shortcut-conflict">
                              {`与「${conflictWith
                                .map((a) => SHORTCUT_ACTION_META[a].label)
                                .join('、')}」冲突`}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
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
            <button
              className="settings-button settings-button-primary"
              type="submit"
              disabled={hasShortcutConflict}
              title={hasShortcutConflict ? '存在快捷键冲突，请先解决' : undefined}
            >
              确定
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
