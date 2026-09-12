import { useEffect } from 'react';
import { computeEditorMaxWidth, resolveEditorWidthPreset } from '../editor-width-presets';
import { useStore } from '../stores/useStore';

// 把「正文宽度」档位按内容区实际宽度换算成像素，注入 --editor-max-width。
// 不直接用 CSS 百分比：工具栏与查找条按 calc(正文宽度 - 内边距) 对齐，
// 百分比在各自容器中解析基准不一致；由这里统一以 .editor-main 宽度计算，
// 所有跟随元素保持严格对齐。窗口或侧栏宽度变化时经 ResizeObserver 重算。
export function useEditorWidth() {
  const editorWidthPreset = useStore((s) => s.editorWidthPreset);

  useEffect(() => {
    const main = document.querySelector('.editor-main');
    if (!(main instanceof HTMLElement)) return;

    const apply = () => {
      const preset = resolveEditorWidthPreset(editorWidthPreset);
      const width = computeEditorMaxWidth(preset, main.clientWidth);
      document.documentElement.style.setProperty('--editor-max-width', `${width}px`);
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(main);
    return () => observer.disconnect();
  }, [editorWidthPreset]);
}
