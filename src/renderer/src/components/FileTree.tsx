import { useEffect, useState } from 'react';
import {
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  PenLine,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { WorkspaceEntry } from '../types';
import type { useFileTree } from '../hooks/useFileTree';
import { useI18n } from '../i18n';
import '../styles/file-tree.css';

interface FileTreeProps {
  state: ReturnType<typeof useFileTree>;
  side: 'left' | 'right';
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
  onCreateDocument: (dirPath: string) => void;
  onRenameFile: (entry: WorkspaceEntry) => void;
  onDeleteEntry: (entry: WorkspaceEntry) => void;
}

interface RowProps {
  entry: WorkspaceEntry;
  depth: number;
  expanded: Set<string>;
  loadingDirs: Set<string>;
  entriesByDir: Map<string, WorkspaceEntry[]>;
  activeFilePath: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onEntryContextMenu: (entry: WorkspaceEntry, position: { x: number; y: number }) => void;
}

interface ContextMenuState {
  entry: WorkspaceEntry;
  position: { x: number; y: number };
}

function FileTreeRow({
  entry,
  depth,
  expanded,
  loadingDirs,
  entriesByDir,
  activeFilePath,
  onToggle,
  onOpenFile,
  onEntryContextMenu,
}: RowProps) {
  const isOpen = expanded.has(entry.absolutePath);
  const isActive = activeFilePath === entry.absolutePath;
  const isLoading = loadingDirs.has(entry.absolutePath);
  const childEntries = entriesByDir.get(entry.absolutePath);

  return (
    <li className="file-tree-node">
      <button
        type="button"
        className={`file-tree-row ${isActive ? 'active' : ''}`}
        style={{
          paddingLeft: `calc(var(--panel-root-indent) + ${depth} * var(--panel-indent-base))`,
        }}
        onClick={() =>
          entry.isDirectory ? onToggle(entry.absolutePath) : onOpenFile(entry.absolutePath)
        }
        onContextMenu={(event) => {
          event.preventDefault();
          onEntryContextMenu(entry, { x: event.clientX, y: event.clientY });
        }}
        title={entry.name}
      >
        {entry.isDirectory ? (
          <>
            <ChevronRight size={14} className={`file-tree-chevron ${isOpen ? 'open' : ''}`} />
            {isOpen ? (
              <FolderOpen size={15} className="file-tree-icon" />
            ) : (
              <Folder size={15} className="file-tree-icon" />
            )}
          </>
        ) : (
          <FileText size={15} className="file-tree-icon file-tree-icon--file" />
        )}
        <span className="file-tree-name">{entry.name}</span>
        {isLoading && <RefreshCw size={12} className="file-tree-spinner" />}
      </button>
      {entry.isDirectory && isOpen && childEntries && childEntries.length > 0 && (
        <ul className="file-tree-children">
          {childEntries.map((child) => (
            <FileTreeRow
              key={child.absolutePath}
              entry={child}
              depth={depth + 1}
              expanded={expanded}
              loadingDirs={loadingDirs}
              entriesByDir={entriesByDir}
              activeFilePath={activeFilePath}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onEntryContextMenu={onEntryContextMenu}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree({
  state,
  side,
  activeFilePath,
  onOpenFile,
  onCreateDocument,
  onRenameFile,
  onDeleteEntry,
}: FileTreeProps) {
  const { rootPath, dirCache, expanded, loadingDirs, toggleExpand, openFolderDialog } = state;
  const { t } = useI18n();
  const rootEntries = rootPath ? dirCache.get(rootPath) : undefined;
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleOpenFolder = () => void openFolderDialog();

  // 菜单在按下外部任意处或按 Esc 时关闭;用 mousedown 保证先于菜单项的
  // click 生效顺序之外(菜单内部按下不关闭,点击条目才能触发动作)。
  useEffect(() => {
    if (!contextMenu) return;
    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (target?.closest('.file-tree-context-menu')) return;
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const runMenuAction = (action: () => void): void => {
    setContextMenu(null);
    action();
  };

  return (
    <aside className={`file-tree side-${side}`}>
      <header className="file-tree-header">
        <span className="file-tree-title">
          {rootPath ? rootPath.split(/[/\\]/).pop() : t('fileTree.title')}
        </span>
        <button
          type="button"
          className="file-tree-action"
          onClick={handleOpenFolder}
          title={t('fileTree.openFolder')}
        >
          <Folder size={14} />
        </button>
      </header>
      <div className="file-tree-body">
        {!rootPath ? (
          <div className="file-tree-empty">
            <Folder size={28} className="file-tree-empty-icon" />
            <p className="file-tree-empty-text">{t('fileTree.empty')}</p>
            <button type="button" className="file-tree-empty-btn" onClick={handleOpenFolder}>
              {t('fileTree.openFolder')}
            </button>
          </div>
        ) : !rootEntries ? (
          <div className="file-tree-empty">
            <RefreshCw size={20} className="file-tree-spinner" />
            <p className="file-tree-empty-text">{t('fileTree.loading')}</p>
          </div>
        ) : rootEntries.length === 0 ? (
          <div className="file-tree-empty">
            <p className="file-tree-empty-text">{t('fileTree.folderEmpty')}</p>
          </div>
        ) : (
          <ul className="file-tree-list">
            {rootEntries.map((entry) => (
              <FileTreeRow
                key={entry.absolutePath}
                entry={entry}
                depth={0}
                expanded={expanded}
                loadingDirs={loadingDirs}
                entriesByDir={dirCache}
                activeFilePath={activeFilePath}
                onToggle={toggleExpand}
                onOpenFile={onOpenFile}
                onEntryContextMenu={(entry, position) => setContextMenu({ entry, position })}
              />
            ))}
          </ul>
        )}
      </div>
      {contextMenu && (
        <FileTreeContextMenu
          menu={contextMenu}
          labels={{
            newDocument: t('fileTree.menu.newDocument'),
            rename: t('fileTree.menu.rename'),
            remove: t('fileTree.menu.remove'),
          }}
          onCreateDocument={() =>
            runMenuAction(() => onCreateDocument(contextMenu.entry.absolutePath))
          }
          onRename={() => runMenuAction(() => onRenameFile(contextMenu.entry))}
          onDelete={() => runMenuAction(() => onDeleteEntry(contextMenu.entry))}
        />
      )}
    </aside>
  );
}

interface ContextMenuProps {
  menu: ContextMenuState;
  labels: { newDocument: string; rename: string; remove: string };
  onCreateDocument: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function FileTreeContextMenu({
  menu,
  labels,
  onCreateDocument,
  onRename,
  onDelete,
}: ContextMenuProps) {
  // 靠近视口右/下边缘时向内收,避免菜单被裁剪
  const MENU_WIDTH = 168;
  const MENU_HEIGHT_ESTIMATE = 108;
  const x = Math.min(menu.position.x, window.innerWidth - MENU_WIDTH - 8);
  const y = Math.min(menu.position.y, window.innerHeight - MENU_HEIGHT_ESTIMATE - 8);

  const items = menu.entry.isDirectory
    ? [
        {
          key: 'new-document',
          icon: FilePlus,
          label: labels.newDocument,
          action: onCreateDocument,
        },
        { key: 'remove', icon: Trash2, label: labels.remove, action: onDelete },
      ]
    : [
        { key: 'rename', icon: PenLine, label: labels.rename, action: onRename },
        { key: 'remove', icon: Trash2, label: labels.remove, action: onDelete },
      ];

  return (
    <div
      className="file-tree-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map(({ key, icon: Icon, label, action }) => (
        <button
          key={key}
          type="button"
          role="menuitem"
          className="file-tree-context-item"
          onClick={action}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
