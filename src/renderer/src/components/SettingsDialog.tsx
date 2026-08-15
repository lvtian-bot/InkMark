import { useEffect, useId, useRef, useState } from 'react';
import {
  isPanelLayout,
  isRecentListWidth,
  isToolbarWidth,
  selectSettings,
  type AppSettings,
} from '../settings';
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
import { useI18n } from '../i18n';
import { isThemeId } from '../types';
import {
  DEFAULT_SHORTCUT_MAP,
  SHORTCUT_ACTIONS,
  SHORTCUT_ACTION_META,
  SHORTCUT_GROUPS,
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

type SettingsSection = 'general' | 'appearance' | 'font' | 'editor' | 'shortcuts';

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<AppSettings>(() => selectSettings(useStore.getState()));
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const applySettings = useStore((state) => state.applySettings);
  const displayPlatform = toDisplayPlatform(window.inkmark.platform);

  const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string }> = [
    { id: 'general', label: t('settings.section.general') },
    { id: 'appearance', label: t('settings.section.appearance') },
    { id: 'font', label: t('settings.section.font') },
    { id: 'editor', label: t('settings.section.editor') },
    { id: 'shortcuts', label: t('settings.section.shortcuts') },
  ];
  const listSeparator = locale === 'zh-CN' ? '、' : ', ';

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
      if (!combo || (!combo.mod && !combo.alt)) return;
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
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2 id={titleId} className="settings-title">
            {t('settings.title')}
          </h2>
          <button
            className="settings-icon-button"
            type="button"
            onClick={onClose}
            aria-label={t('settings.closeAria')}
          >
            ×
          </button>
        </header>

        <form className="settings-form" onSubmit={handleSubmit}>
          <div className="settings-body">
            <nav className="settings-nav" aria-label={t('settings.navAria')}>
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
              {activeSection === 'general' && (
                <fieldset className="settings-group">
                  <legend>{t('settings.section.general')}</legend>
                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">
                        {t('settings.appearance.languageLabel')}
                      </span>
                      <span className="settings-field-hint">
                        {t('settings.appearance.languageHint')}
                      </span>
                    </span>
                    <select
                      value={draft.language}
                      onChange={(event) => {
                        const language = event.target.value;
                        if (language === 'system' || language === 'zh-CN' || language === 'en') {
                          setDraft((settings) => ({ ...settings, language }));
                        }
                      }}
                    >
                      <option value="system">{t('settings.appearance.languageSystem')}</option>
                      <option value="zh-CN">{t('settings.appearance.languageZh')}</option>
                      <option value="en">{t('settings.appearance.languageEn')}</option>
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">
                        {t('settings.startup.pageLabel')}
                      </span>
                      <span className="settings-field-hint">{t('settings.startup.pageHint')}</span>
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
                      <option value="start">{t('settings.startup.pageStart')}</option>
                      <option value="blank">{t('settings.startup.pageBlank')}</option>
                    </select>
                  </label>
                </fieldset>
              )}

              {activeSection === 'appearance' && (
                <fieldset className="settings-group">
                  <legend>{t('settings.section.appearance')}</legend>
                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">
                        {t('settings.appearance.themeLabel')}
                      </span>
                      <span className="settings-field-hint">
                        {t('settings.appearance.themeHint')}
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
                      <option value="inkmark-light">{t('theme.inkmarkLight')}</option>
                      <option value="inkmark-dark">{t('theme.inkmarkDark')}</option>
                      <option value="github-light">{t('theme.githubLight')}</option>
                      <option value="github-dark">{t('theme.githubDark')}</option>
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">
                        {t('settings.appearance.toolbarWidthLabel')}
                      </span>
                      <span className="settings-field-hint">
                        {t('settings.appearance.toolbarWidthHint')}
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
                      <option value="wide">{t('settings.appearance.toolbarWide')}</option>
                      <option value="medium">{t('settings.appearance.toolbarMedium')}</option>
                      <option value="narrow">{t('settings.appearance.toolbarNarrow')}</option>
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">
                        {t('settings.appearance.recentWidthLabel')}
                      </span>
                      <span className="settings-field-hint">
                        {t('settings.appearance.recentWidthHint')}
                      </span>
                    </span>
                    <select
                      value={draft.recentListWidth}
                      onChange={(event) => {
                        const recentListWidth = event.target.value;
                        if (isRecentListWidth(recentListWidth)) {
                          setDraft((settings) => ({ ...settings, recentListWidth }));
                        }
                      }}
                    >
                      <option value="wide">{t('settings.appearance.recentWidthWide')}</option>
                      <option value="medium">{t('settings.appearance.recentWidthMedium')}</option>
                      <option value="narrow">{t('settings.appearance.recentWidthNarrow')}</option>
                    </select>
                  </label>
                </fieldset>
              )}

              {activeSection === 'font' && (
                <fieldset className="settings-group">
                  <legend>{t('settings.section.font')}</legend>
                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">{t('settings.font.fontLabel')}</span>
                      <span className="settings-field-hint">{t('settings.font.fontHint')}</span>
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
                          {t(preset.labelKey)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">{t('settings.font.sizeLabel')}</span>
                      <span className="settings-field-hint">{t('settings.font.sizeHint')}</span>
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
                          {t(preset.labelKey)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">
                        {t('settings.font.lineHeightLabel')}
                      </span>
                      <span className="settings-field-hint">
                        {t('settings.font.lineHeightHint')}
                      </span>
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
                          {t(preset.labelKey)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">
                        {t('settings.font.letterSpacingLabel')}
                      </span>
                      <span className="settings-field-hint">
                        {t('settings.font.letterSpacingHint')}
                      </span>
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
                          {t(preset.labelKey)}
                        </option>
                      ))}
                    </select>
                  </label>
                </fieldset>
              )}

              {activeSection === 'editor' && (
                <fieldset className="settings-group">
                  <legend>{t('settings.section.editor')}</legend>
                  <div className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">
                        {t('settings.editor.strictLineBreaksLabel')}
                      </span>
                      <span className="settings-field-hint">
                        {t('settings.editor.strictLineBreaksHint')}
                      </span>
                    </span>
                    <label
                      className="settings-switch"
                      aria-label={t('settings.editor.strictLineBreaksLabel')}
                    >
                      <input
                        type="checkbox"
                        checked={draft.strictLineBreaks}
                        onChange={(event) =>
                          setDraft((settings) => ({
                            ...settings,
                            strictLineBreaks: event.target.checked,
                          }))
                        }
                      />
                      <span className="settings-switch-slider" />
                    </label>
                  </div>

                  <label className="settings-field">
                    <span className="settings-field-copy">
                      <span className="settings-field-label">
                        {t('settings.editor.panelLayoutLabel')}
                      </span>
                      <span className="settings-field-hint">
                        {t('settings.editor.panelLayoutHint')}
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
                      <option value="outline-left">
                        {t('settings.editor.panelLayoutOutlineLeft')}
                      </option>
                      <option value="outline-right">
                        {t('settings.editor.panelLayoutOutlineRight')}
                      </option>
                    </select>
                  </label>
                </fieldset>
              )}

              {activeSection === 'shortcuts' && (
                <fieldset className="settings-group">
                  <legend>{t('settings.section.shortcuts')}</legend>
                  <div className="settings-shortcuts-toolbar">
                    <span className="settings-field-hint">{t('settings.shortcuts.hint')}</span>
                    <button
                      type="button"
                      className="settings-link-button"
                      onClick={resetAllShortcuts}
                    >
                      {t('settings.shortcuts.resetAll')}
                    </button>
                  </div>
                  {SHORTCUT_GROUPS.map((group) => (
                    <div key={group.id} className="settings-shortcut-group">
                      <h3 className="settings-shortcut-group-title">{t(group.labelKey)}</h3>
                      <ul className="settings-shortcut-list">
                        {group.actions.map((action) => {
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
                                <span className="settings-shortcut-label">{t(meta.labelKey)}</span>
                                {meta.hintKey && (
                                  <span className="settings-shortcut-hint">{t(meta.hintKey)}</span>
                                )}
                              </div>
                              <div className="settings-shortcut-control">
                                {isRecording ? (
                                  <span className="settings-shortcut-recording">
                                    {t('settings.shortcuts.recording')}
                                  </span>
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
                                  {isRecording
                                    ? t('common.cancel')
                                    : t('settings.shortcuts.record')}
                                </button>
                                <button
                                  type="button"
                                  className="settings-shortcut-btn"
                                  onClick={() => resetShortcut(action)}
                                  disabled={unchanged}
                                >
                                  {t('settings.shortcuts.reset')}
                                </button>
                              </div>
                              {conflictWith.length > 0 && (
                                <span className="settings-shortcut-conflict">
                                  {t('settings.shortcuts.conflict', {
                                    names: conflictWith
                                      .map((a) => t(SHORTCUT_ACTION_META[a].labelKey))
                                      .join(listSeparator),
                                  })}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
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
              {t('common.cancel')}
            </button>
            <button
              className="settings-button settings-button-primary"
              type="submit"
              disabled={hasShortcutConflict}
              title={hasShortcutConflict ? t('settings.shortcuts.conflictTitle') : undefined}
            >
              {t('common.ok')}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
