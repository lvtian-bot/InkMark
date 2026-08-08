import { useStore } from '../stores/useStore';
import '../styles/tabbar.css';

interface TabBarProps {
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
}

export function TabBar({ onSelectTab, onCloseTab, onNewTab }: TabBarProps) {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);

  const handleClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onCloseTab(id);
  };

  const handleMouseDown = (e: React.MouseEvent, id: string) => {
    if (e.button === 1) {
      e.preventDefault();
      onCloseTab(id);
    }
  };

  return (
    <div className="tab-bar">
      <button
        className="tab-menu"
        onClick={() => window.inkmark.popupMenu()}
        title={'\u83dc\u5355'}
      >
        {'\u2630'}
      </button>
      <div className="tab-list">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(e) => handleMouseDown(e, tab.id)}
            title={tab.filePath ?? tab.fileName}
          >
            <div className="tab-body">
              <span className="tab-title">
                {tab.isDirty ? '\u2022 ' : ''}
                {tab.fileName}
              </span>
              <button
                className="tab-close"
                onClick={(e) => handleClose(e, tab.id)}
                title="关闭标签页"
              >
                {'\u00d7'}
              </button>
            </div>
          </div>
        ))}
        <button className="tab-new" onClick={onNewTab} title="新标签页 (Ctrl+T)">
          {'\u002b'}
        </button>
      </div>
    </div>
  );
}
