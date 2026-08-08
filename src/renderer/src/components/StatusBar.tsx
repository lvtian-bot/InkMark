import { useStore } from '../stores/useStore';
import '../styles/status-bar.css';

interface StatusBarProps {
  onOpenSettings: () => void;
}

export function StatusBar({ onOpenSettings }: StatusBarProps) {
  const wordCount = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.wordCount ?? 0);
  const charCount = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.charCount ?? 0);
  const outlineVisible = useStore((s) => s.outlineVisible);
  const setOutlineVisible = useStore((s) => s.setOutlineVisible);
  const viewMode = useStore((s) => s.viewMode);
  const toggleViewMode = useStore((s) => s.toggleViewMode);

  return (
    <footer className="status-bar">
      <div className="status-left">
        <button
          className={`status-toggle-btn ${outlineVisible ? 'active' : ''}`}
          onClick={() => setOutlineVisible(!outlineVisible)}
          title={outlineVisible ? '\u9690\u85cf\u5927\u7eb2' : '\u663e\u793a\u5927\u7eb2'}
        >
          {'\u2630'}
        </button>
        <button
          className={`status-mode-btn ${viewMode === 'source' ? 'active' : ''}`}
          onClick={toggleViewMode}
          title={'\u6e90\u7801\u6a21\u5f0f (Ctrl+/)'}
        >
          {'\u6e90\u7801'}
        </button>
        <button
          className="status-toggle-btn"
          type="button"
          onClick={onOpenSettings}
          title={'\u8bbe\u7f6e'}
          aria-label={'\u8bbe\u7f6e'}
        >
          {'\u2699'}
        </button>
      </div>
      <div className="status-counts">
        <span className="status-item">
          {wordCount} {'\u5b57'}
        </span>
        <span className="status-item">
          {charCount} {'\u5b57\u7b26'}
        </span>
      </div>
    </footer>
  );
}