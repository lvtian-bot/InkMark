import { useEffect, useState } from 'react';
import type { RecentItem, RecentKind } from '../types';
import '../styles/start-page.css';

interface StartPageProps {
  onCreateBlank: () => void;
  onOpenFile: () => void;
  onOpenPath: (path: string) => void;
  /** 打开文件夹到文件树。不传路径时弹出选择框；传路径时直接打开该文件夹。 */
  onOpenFolder?: (path?: string) => void;
}

interface RecentRow {
  path: string;
  kind: RecentKind;
  name: string;
  dir: string;
}

function splitPath(path: string): { name: string; dir: string } {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  const dir = idx > 0 ? path.slice(0, idx) : '';
  return { name, dir };
}

const iconNew = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <line x1="12" y1="11" x2="12" y2="17" />
    <line x1="9" y1="14" x2="15" y2="14" />
  </svg>
);

const iconOpen = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 7a2 2 0 0 1 2-2h3.17a2 2 0 0 1 1.41.59l1.42 1.41A2 2 0 0 0 11.41 8H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const iconFolder = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const iconFile = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

const iconClose = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

export function StartPage({ onCreateBlank, onOpenFile, onOpenPath, onOpenFolder }: StartPageProps) {
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [appName, setAppName] = useState('InkMark');

  useEffect(() => {
    void window.inkmark.getRecentFiles().then((items: RecentItem[]) => {
      setRecent(items.map((item) => ({ ...item, ...splitPath(item.path) })));
    });
    void window.inkmark.getAppInfo().then((info) => {
      if (info.name) setAppName(info.name);
    });
  }, []);

  const handleRemove = async (path: string) => {
    await window.inkmark.removeRecentFile(path);
    setRecent((prev) => prev.filter((item) => item.path !== path));
  };

  const handleClearAll = async () => {
    await window.inkmark.clearRecentFiles();
    setRecent([]);
  };

  return (
    <div className="start-page">
      <div className="start-content">
        <h1 className="start-brand">{appName}</h1>
        <div className="start-cols">
          <section className="start-col">
            <div className="start-col-head">
              <h2 className="start-col-title">新建</h2>
            </div>
            <ul className="start-list">
              <li className="start-row start-row--primary" onClick={onCreateBlank}>
                <span className="start-row-icon" aria-hidden="true">
                  {iconNew}
                </span>
                <span className="start-row-text">
                  <span className="start-row-name">新建空白文档</span>
                </span>
              </li>
              <li className="start-row" onClick={onOpenFile}>
                <span className="start-row-icon" aria-hidden="true">
                  {iconOpen}
                </span>
                <span className="start-row-text">
                  <span className="start-row-name">打开文件…</span>
                </span>
              </li>
              {onOpenFolder && (
                <li className="start-row" onClick={() => onOpenFolder()}>
                  <span className="start-row-icon" aria-hidden="true">
                    {iconFolder}
                  </span>
                  <span className="start-row-text">
                    <span className="start-row-name">打开文件夹…</span>
                  </span>
                </li>
              )}
            </ul>
          </section>

          <section className="start-col start-col--recent">
            <div className="start-col-head">
              <h2 className="start-col-title">最近打开</h2>
              {recent.length > 0 && (
                <button className="start-clear" onClick={handleClearAll}>
                  清除全部
                </button>
              )}
            </div>
            {recent.length > 0 ? (
              <ul className="start-list">
                {recent.map((item) => {
                  const isFolder = item.kind === 'folder';
                  return (
                    <li
                      key={item.path}
                      className="start-row start-row--recent"
                      onClick={() => (isFolder ? onOpenFolder?.(item.path) : onOpenPath(item.path))}
                    >
                      <span className="start-row-icon" aria-hidden="true">
                        {isFolder ? iconFolder : iconFile}
                      </span>
                      <span className="start-row-text start-row-text--inline">
                        <span className="start-row-name">{item.name}</span>
                        <span className="start-row-dir">{item.dir || '—'}</span>
                      </span>
                      <button
                        type="button"
                        className="start-row-remove"
                        title="从最近列表中移除"
                        aria-label="从最近列表中移除"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRemove(item.path);
                        }}
                      >
                        {iconClose}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="start-empty-hint">暂无最近打开的文件或文件夹</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
