import { useEffect, useState } from 'react';
import { FilePlus, FileText, Folder, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { useStore } from '../stores/useStore';
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

export function StartPage({ onCreateBlank, onOpenFile, onOpenPath, onOpenFolder }: StartPageProps) {
  const { t } = useI18n();
  const recentListWidth = useStore((s) => s.recentListWidth);
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
    <div className={`start-page recent-width-${recentListWidth}`}>
      <div className="start-content">
        <div className="start-cols">
          <section className="start-col">
            <h1 className="start-brand">{appName}</h1>
            <div className="start-col-head">
              <h2 className="start-col-title">{t('startPage.new')}</h2>
            </div>
            <ul className="start-list">
              <li className="start-row start-row--primary" onClick={onCreateBlank}>
                <span className="start-row-icon" aria-hidden="true">
                  <FilePlus size={18} />
                </span>
                <span className="start-row-text">
                  <span className="start-row-name">{t('startPage.newBlankDoc')}</span>
                </span>
              </li>
              <li className="start-row" onClick={onOpenFile}>
                <span className="start-row-icon" aria-hidden="true">
                  <FileText size={18} />
                </span>
                <span className="start-row-text">
                  <span className="start-row-name">{t('startPage.openFile')}</span>
                </span>
              </li>
              {onOpenFolder && (
                <li className="start-row" onClick={() => onOpenFolder()}>
                  <span className="start-row-icon" aria-hidden="true">
                    <Folder size={18} />
                  </span>
                  <span className="start-row-text">
                    <span className="start-row-name">{t('startPage.openFolder')}</span>
                  </span>
                </li>
              )}
            </ul>
          </section>

          <section className="start-col start-col--recent">
            <div className="start-brand-placeholder" aria-hidden="true">
              InkMark
            </div>
            <div className="start-col-head">
              <h2 className="start-col-title">{t('startPage.recent')}</h2>
              {recent.length > 0 && (
                <button className="start-clear" onClick={handleClearAll}>
                  {t('startPage.clearAll')}
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
                        {isFolder ? <Folder size={18} /> : <FileText size={18} />}
                      </span>
                      <span className="start-row-text start-row-text--inline">
                        <span className="start-row-name">{item.name}</span>
                        <span className="start-row-dir">{item.dir || '-'}</span>
                      </span>
                      <button
                        type="button"
                        className="start-row-remove"
                        title={t('startPage.removeRecent')}
                        aria-label={t('startPage.removeRecent')}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRemove(item.path);
                        }}
                      >
                        <X size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="start-empty-hint">{t('startPage.recentEmpty')}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
