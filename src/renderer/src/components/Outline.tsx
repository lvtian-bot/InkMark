import { useEffect, useState, useRef, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useI18n } from '../i18n';
import { editorHandle } from '../editor-ref';
import { sourceEditorHandle } from '../source-editor-ref';
import {
  computeCollapsibleIds,
  computeVisibleHeadings,
  resolveActiveId,
} from '../outline-visibility';
import '../styles/outline.css';

const EMPTY_IDS: Set<string> = new Set();

export function Outline({ side }: { side?: 'left' | 'right' }) {
  const { t } = useI18n();
  const outline = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.outline ?? []);
  const activeTabId = useStore((s) => s.activeTabId);
  const viewMode = useStore((s) => s.viewMode);
  const [activeId, setActiveId] = useState<string | null>(null);
  // 折叠集合与所属标签成对保存:标题 id 按文本生成,不同标签页可能出现同名 id,
  // 读取时若所属标签不是当前标签则视为空集合,避免状态串页
  const [collapsed, setCollapsed] = useState<{ tabId: string | null; ids: Set<string> }>({
    tabId: null,
    ids: EMPTY_IDS,
  });
  const collapsedIds = collapsed.tabId === activeTabId ? collapsed.ids : EMPTY_IDS;
  const tickingRef = useRef(false);

  const visibleHeadings = useMemo(
    () => computeVisibleHeadings(outline, collapsedIds),
    [outline, collapsedIds],
  );
  const collapsibleIds = useMemo(() => computeCollapsibleIds(outline), [outline]);
  const visibleIds = useMemo(() => new Set(visibleHeadings.map((h) => h.id)), [visibleHeadings]);
  const displayedActiveId = useMemo(
    () => resolveActiveId(outline, visibleIds, activeId),
    [outline, visibleIds, activeId],
  );

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

  const handleToggle = (id: string, event: MouseEvent): void => {
    event.stopPropagation();
    setCollapsed((prev) => {
      const base = prev.tabId === activeTabId ? prev.ids : EMPTY_IDS;
      const next = new Set(base);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { tabId: activeTabId, ids: next };
    });
  };

  if (outline.length === 0) {
    return (
      <aside className={`outline${side === 'right' ? ' side-right' : ''}`}>
        <div className="outline-header">
          <span className="outline-title">{t('outline.title')}</span>
        </div>
        <div className="outline-empty">{t('outline.empty')}</div>
      </aside>
    );
  }

  return (
    <aside className={`outline${side === 'right' ? ' side-right' : ''}`}>
      <div className="outline-header">
        <span className="outline-title">{t('outline.title')}</span>
      </div>
      <nav className="outline-list">
        {visibleHeadings.map((heading) => (
          <button
            key={heading.id}
            className={`outline-item level-${heading.level} ${
              displayedActiveId === heading.id ? 'active' : ''
            }`}
            onClick={() => handleClick(heading.pos)}
            title={heading.text}
          >
            {collapsibleIds.has(heading.id) ? (
              <ChevronRight
                size={12}
                className={`outline-chevron${collapsedIds.has(heading.id) ? '' : ' open'}`}
                onClick={(event) => handleToggle(heading.id, event)}
              />
            ) : (
              <span className="outline-chevron-placeholder" />
            )}
            <span className="outline-text">{heading.text}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
