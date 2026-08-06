interface TitleBarProps {
  fileName: string
  isDirty: boolean
  theme: 'light' | 'dark'
  outlineVisible: boolean
  onToggleOutline: () => void
  onToggleTheme: () => void
  onNew: () => void
  onOpen: () => void
  onSave: () => void
}

export function TitleBar({
  fileName, isDirty, theme, outlineVisible,
  onToggleOutline, onToggleTheme, onNew, onOpen, onSave
}: TitleBarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <div className="titlebar-actions">
          <button
            className={`titlebar-action-btn ${outlineVisible ? 'active' : ''}`}
            onClick={onToggleOutline}
            title={'\u5927\u7eb2'}
          >
            {'\u2630'}
          </button>
          <button className="titlebar-action-btn" onClick={onNew} title={'\u65b0\u5efa (Ctrl+N)'}>
            {'\u65b0\u5efa'}
          </button>
          <button className="titlebar-action-btn" onClick={onOpen} title={'\u6253\u5f00 (Ctrl+O)'}>
            {'\u6253\u5f00'}
          </button>
          <button className="titlebar-action-btn" onClick={onSave} title={'\u4fdd\u5b58 (Ctrl+S)'}>
            {'\u4fdd\u5b58'}
          </button>
        </div>
      </div>
      <div className="titlebar-center">
        {isDirty && <span className="titlebar-dirty">{'\u2022'}</span>}
        <span className="titlebar-filename">{fileName}</span>
      </div>
      <div className="titlebar-right">
        <button
          className="titlebar-btn"
          onClick={onToggleTheme}
          title={theme === 'light' ? '\u5207\u6362\u5230\u6697\u8272' : '\u5207\u6362\u5230\u4eae\u8272'}
        >
          {theme === 'light' ? '\u{1F319}' : '\u2600'}
        </button>
      </div>
    </header>
  )
}
