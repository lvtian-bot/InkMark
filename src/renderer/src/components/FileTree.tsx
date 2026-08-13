import { ChevronRight, FileText, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import type { WorkspaceEntry } from '../types';
import type { useFileTree } from '../hooks/useFileTree';
import { useI18n } from '../i18n';
import '../styles/file-tree.css';

interface FileTreeProps {
  state: ReturnType<typeof useFileTree>;
  side: 'left' | 'right';
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
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
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree({ state, side, activeFilePath, onOpenFile }: FileTreeProps) {
  const { rootPath, dirCache, expanded, loadingDirs, toggleExpand, openFolderDialog } = state;
  const { t } = useI18n();
  const rootEntries = rootPath ? dirCache.get(rootPath) : undefined;

  const handleOpenFolder = () => void openFolderDialog();

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
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
