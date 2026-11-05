import { useEffect, useState, useRef, useMemo } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { useStore, selectViewMode } from '../stores/useStore';
import { useI18n } from '../i18n';
import { editorHandle } from '../editor-ref';
import { sourceEditorHandle } from '../source-editor-ref';
import {
  computeCollapsibleIds,
  computeVisibleHeadings,
  resolveActiveId,
} from '../outline-visibility';
import { canDropOutlineSection, canMoveOutlineSection, moveOutlineSection } from '../outline-move';
import { isSectionAncestor, resolveDropAnchor, type DropAnchor } from '../outline-sections';
import '../styles/outline.css';

const EMPTY_IDS: Set<string> = new Set();

export function Outline({ side }: { side?: 'left' | 'right' }) {
  const { t } = useI18n();
  const outline = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.outline ?? []);
  const activeTabId = useStore((s) => s.activeTabId);
  const viewMode = useStore(selectViewMode);
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
  // 标题 id → 大纲序号：拖动落点以整份大纲的序号表示，折叠状态下序号仍然稳定。
  const headingIndex = useMemo(
    () => new Map(outline.map((heading, index) => [heading.id, index])),
    [outline],
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; kind: DropAnchor['kind'] } | null>(
    null,
  );
  // 拖动结束后浏览器会补发一次 click，用它拦下该次误触发的跳转。
  const suppressNextClickRef = useRef(false);
  const dropSafetyRef = useRef(new Map<string, boolean>());

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
    // 拖动结束后的补发 click 不触发跳转，否则会跳到已被搬走的标题位置。
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
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

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, index: number): void => {
    dropSafetyRef.current.clear();
    // 文档结构无法安全搬移时（如存在未闭合代码围栏）不允许发起拖动。
    if (!canMoveOutlineSection()) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    // 部分平台在未设置数据时不触发拖动，放入纯文本兜底。
    event.dataTransfer.setData('text/plain', outline[index]?.text ?? '');
    setDragIndex(index);
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>, index: number): void => {
    if (dragIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    // 与 Word 导航窗格一致：标题行上半区插到该章节之前，下半区插到该章节之后。
    const anchor = resolveDropAnchor(index, (event.clientY - rect.top) / rect.height);
    // 拖进自身或其子章节属于无效放置，直接给出禁止光标。
    const key = `${index}:${anchor.kind}`;
    let valid = dropSafetyRef.current.get(key);
    if (valid === undefined) {
      valid = canDropOutlineSection(dragIndex, anchor);
      dropSafetyRef.current.set(key, valid);
    }
    event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    setDropTarget(valid ? { index, kind: anchor.kind } : null);
  };

  const handleDragLeave = (index: number): void => {
    setDropTarget((prev) => (prev && prev.index === index ? null : prev));
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>, index: number): void => {
    // 没有大纲内部拖动时不拦截事件：外部文件拖放需继续冒泡到窗口级打开处理。
    if (dragIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    const from = dragIndex;
    suppressNextClickRef.current = true;
    setDragIndex(null);
    setDropTarget(null);
    if (isSectionAncestor(outline, from, index)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    moveOutlineSection(from, resolveDropAnchor(index, (event.clientY - rect.top) / rect.height));
  };

  const handleDragEnd = (): void => {
    // 拖动结束后浏览器会补发一次 click，若不拦下会跳到刚拖走的旧标题位置。
    // 标记只保留到本次事件序列结束：Esc 取消拖动时没有补发 click，
    // 若长期保留会吞掉用户下一次正常的点击跳转。
    suppressNextClickRef.current = true;
    dropSafetyRef.current.clear();
    setDragIndex(null);
    setDropTarget(null);
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
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
        {visibleHeadings.map((heading) => {
          const index = headingIndex.get(heading.id) ?? -1;
          const isDragging = dragIndex === index;
          const marker = dropTarget && dropTarget.index === index ? ` drop-${dropTarget.kind}` : '';
          return (
            <button
              key={heading.id}
              className={`outline-item level-${heading.level} ${
                displayedActiveId === heading.id ? 'active' : ''
              }${isDragging ? ' dragging' : ''}${marker}`}
              onClick={() => handleClick(heading.pos)}
              title={heading.text}
              draggable
              onDragStart={(event) => handleDragStart(event, index)}
              onDragOver={(event) => handleDragOver(event, index)}
              onDragLeave={() => handleDragLeave(index)}
              onDrop={(event) => handleDrop(event, index)}
              onDragEnd={handleDragEnd}
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
          );
        })}
      </nav>
    </aside>
  );
}
