import { useEffect, useState, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { editorHandle } from '../editor-ref';
import { sourceEditorHandle } from '../source-editor-ref';
import '../styles/outline.css';

export function Outline() {
  const outline = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.outline ?? []);
  const viewMode = useStore((s) => s.viewMode);
  const [activeId, setActiveId] = useState<string | null>(null);
  const tickingRef = useRef(false);

  useEffect(() => {
    const handleScroll = (): void => {
      if (tickingRef.current) return;
      tickingRef.current = true;
      requestAnimationFrame(() => {
        const container = editorHandle.current?.getScrollContainer();
        if (!container) {
          tickingRef.current = false;
          return;
        }
        const domHeadings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
        let activeIndex = -1;
        // 判定线以编辑容器顶为基准，与 scrollToPos 的落点同一参照系，
        // 否则点击跳转后目标标题过不了判定线，高亮会落在上一个标题
        const line = container.getBoundingClientRect().top + 80;
        domHeadings.forEach((h, i) => {
          if (h.getBoundingClientRect().top <= line) {
            activeIndex = i;
          }
        });
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
          activeIndex = domHeadings.length - 1;
        }
        // 按索引匹配而非文本，避免同名标题只能高亮第一个
        if (activeIndex >= 0 && activeIndex < outline.length) {
          setActiveId(outline[activeIndex].id);
        }
        tickingRef.current = false;
      });
    };

    const container = editorHandle.current?.getScrollContainer();
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    } else {
      window.addEventListener('scroll', handleScroll);
      return () => window.removeEventListener('scroll', handleScroll);
    }
  }, [outline]);

  const handleClick = (pos: number): void => {
    if (viewMode === 'source') {
      sourceEditorHandle.current?.setSelection(pos, pos);
    } else {
      editorHandle.current?.scrollToPos(pos);
    }
  };

  if (outline.length === 0) {
    return (
      <aside className="outline">
        <div className="outline-header">
          <span className="outline-title">{'\u5927\u7eb2'}</span>
        </div>
        <div className="outline-empty">{'\u6682\u65e0\u5927\u7eb2'}</div>
      </aside>
    );
  }

  return (
    <aside className="outline">
      <div className="outline-header">
        <span className="outline-title">{'\u5927\u7eb2'}</span>
      </div>
      <nav className="outline-list">
        {outline.map((heading) => (
          <button
            key={heading.id}
            className={`outline-item ${activeId === heading.id ? 'active' : ''}`}
            style={{ paddingLeft: `${(heading.level - 1) * 14 + 16}px` }}
            onClick={() => handleClick(heading.pos)}
            title={heading.text}
          >
            <span className={`outline-level-marker level-${heading.level}`}>
              {'H' + heading.level}
            </span>
            <span className="outline-text">{heading.text}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
