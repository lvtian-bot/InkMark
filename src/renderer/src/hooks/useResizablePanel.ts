import { useCallback, useEffect, useRef, useState } from 'react';

const PANEL_WIDTH_MIN = 150;
const PANEL_WIDTH_MAX = 500;

function clampWidth(width: number): number {
  return Math.round(Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, width)));
}

interface UseResizablePanelOptions {
  /** 当前宽度(受控) */
  width: number;
  /** 宽度变更回调 */
  onWidthChange: (width: number) => void;
  /**
   * 面板贴边方向。左侧面板向右拖增大宽度(客户端坐标即新宽度);
   * 右侧面板向左拖增大宽度,需要用锚点起始坐标计算增量。
   */
  side: 'left' | 'right';
}

/**
 * 可拖拽调整宽度的面板控制。
 *
 * 原有实现把 e.clientX 直接当作宽度,这只在面板贴在窗口最左时成立。
 * 抽象为 side 参数后,右侧面板用"起始坐标 + 反向增量"计算,保证两个
 * 面板都能正确缩放;拖拽时全局禁用文本选择与指针事件由 .app.resizing
 * 统一接管。
 */
export function useResizablePanel({ width, onWidthChange, side }: UseResizablePanelOptions) {
  const [isResizing, setIsResizing] = useState(false);
  // 右侧面板拖拽锚点:记录起始 clientX 与起始宽度,用 ref 保证拖拽期间可变且不触发重渲染
  const anchorRef = useRef<{ clientX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      anchorRef.current = { clientX: e.clientX, startWidth: width };
      setIsResizing(true);
    },
    [width],
  );

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (side === 'left') {
        onWidthChange(clampWidth(e.clientX));
      } else {
        const anchor = anchorRef.current;
        if (!anchor) return;
        // 右侧:向左拖(负 clientX 增量)增大宽度
        const delta = anchor.clientX - e.clientX;
        onWidthChange(clampWidth(anchor.startWidth + delta));
      }
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      anchorRef.current = null;
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, side, onWidthChange]);

  return { isResizing, handleResizeStart };
}
