import { useState } from 'react';
import { formatComboForDisplay, toDisplayPlatform } from '../../../shared/shortcuts';
import { useI18n } from '../i18n';
import { useStore } from '../stores/useStore';
import { tabDisplayName } from '../tab-name';
import '../styles/tabbar.css';

interface TabBarProps {
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
}

interface DropTarget {
  id: string;
  position: 'before' | 'after';
}

export function TabBar({ onSelectTab, onCloseTab, onNewTab }: TabBarProps) {
  const { t } = useI18n();
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const moveTab = useStore((s) => s.moveTab);
  const newFileShortcut = useStore((s) => s.shortcuts.newFile);
  const displayPlatform = toDisplayPlatform(navigator.platform);
  const newTabTitle = t('tabBar.newTab', {
    shortcut: formatComboForDisplay(newFileShortcut, displayPlatform),
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

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

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const position: 'before' | 'after' =
      e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    setDropTarget((prev) =>
      prev && prev.id === id && prev.position === position ? prev : { id, position },
    );
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  const handleDrop = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggingId && draggingId !== id && dropTarget) {
      moveTab(draggingId, dropTarget.id, dropTarget.position);
    }
    setDraggingId(null);
    setDropTarget(null);
  };

  const tabClassName = (tab: { id: string }): string => {
    const classes = ['tab'];
    if (tab.id === activeTabId) classes.push('active');
    if (tab.id === draggingId) classes.push('dragging');
    if (dropTarget && dropTarget.id === tab.id) {
      classes.push(dropTarget.position === 'before' ? 'drop-before' : 'drop-after');
    }
    return classes.join(' ');
  };

  return (
    <div className="tab-bar">
      <button
        className="tab-menu"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          window.inkmark.popupMenu({
            x: Math.round(rect.left),
            y: Math.round(rect.bottom),
          });
        }}
        title={t('tabBar.menu')}
      >
        {'\u2630'}
      </button>
      <div className="tab-list">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={tabClassName(tab)}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(e) => handleMouseDown(e, tab.id)}
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={(e) => handleDragOver(e, tab.id)}
            onDrop={(e) => handleDrop(e, tab.id)}
            onDragEnd={handleDragEnd}
            draggable
            title={tab.filePath ?? tabDisplayName(tab, t)}
          >
            <div className="tab-body">
              <span className="tab-title">
                {tab.isDirty ? '\u2022 ' : ''}
                {tabDisplayName(tab, t)}
              </span>
              <button
                className="tab-close"
                onClick={(e) => handleClose(e, tab.id)}
                title={t('tabBar.closeTab')}
              >
                {'\u00d7'}
              </button>
            </div>
          </div>
        ))}
        <button className="tab-new" onClick={onNewTab} title={newTabTitle}>
          {'\u002b'}
        </button>
      </div>
    </div>
  );
}
