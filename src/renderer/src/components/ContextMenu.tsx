import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  left: number;
  top: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * 编辑区通用右键菜单：按传入条目就地平铺渲染（不分组、不画分隔线），
 * 自动处理点击外部/Escape 关闭、视口越界收拢。按钮按下时不抢焦点
 * （mousedown preventDefault），保证剪切、粘贴等原生编辑命令仍作用于
 * 打开菜单前所在的编辑器。
 */
export function ContextMenu({ left, top, items, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [adjusted, setAdjusted] = useState<{ left: number; top: number }>({ left, top });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.context-menu')) onCloseRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // 首帧按锚点渲染，绘制前量实际尺寸一次性收拢到视口内，避免菜单底部溢出。
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 8;
    const maxTop = window.innerHeight - rect.height - 8;
    setAdjusted({
      left: Math.max(8, Math.min(left, maxLeft)),
      top: Math.max(8, Math.min(top, maxTop)),
    });
  }, [left, top]);

  return (
    <div
      ref={rootRef}
      className="context-menu"
      role="menu"
      style={{ left: adjusted.left, top: adjusted.top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
