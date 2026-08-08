import { useEffect, useState } from 'react';
import '../styles/start-page.css';

interface StartPageProps {
  onCreateBlank: () => void;
  onOpenFile: () => void;
  onOpenPath: (path: string) => void;
}

interface RecentItem {
  path: string;
  name: string;
  dir: string;
}

function splitPath(path: string): { name: string; dir: string } {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  const dir = idx > 0 ? path.slice(0, idx) : '';
  return { name, dir };
}

export function StartPage({ onCreateBlank, onOpenFile, onOpenPath }: StartPageProps) {
  const [recent, setRecent] = useState<RecentItem[]>([]);

  useEffect(() => {
    void window.inkmark.getRecentFiles().then((paths: string[]) => {
      setRecent(paths.map((path) => ({ path, ...splitPath(path) })));
    });
  }, []);

  return (
    <div className="start-page">
      <div className="start-content">
        <h1 className="start-title">开始</h1>
        <div className="start-actions">
          <button className="start-btn start-btn--primary" onClick={onCreateBlank}>
            新建空白文档
          </button>
          <button className="start-btn" onClick={onOpenFile}>
            打开文件…
          </button>
        </div>
        {recent.length > 0 && (
          <div className="start-recent">
            <h2 className="start-recent-title">最近打开</h2>
            <ul className="start-recent-list">
              {recent.map((item) => (
                <li
                  key={item.path}
                  className="start-recent-item"
                  onClick={() => onOpenPath(item.path)}
                >
                  <span className="start-recent-name">{item.name}</span>
                  <span className="start-recent-dir">{item.dir}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
