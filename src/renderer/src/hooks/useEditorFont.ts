import { useEffect } from 'react';
import { resolveFontSize, resolveFontStack } from '../font-presets';
import { useStore } from '../stores/useStore';

// 把用户选择的字体族与字号注入为 CSS 变量，供编辑区（所见即所得与源码模式）读取。
// 与 useTheme 并列：主题管明暗与排版风格，这里只管正文字体与字号。
export function useEditorFont() {
  const fontPreset = useStore((s) => s.fontPreset);
  const fontSizePreset = useStore((s) => s.fontSizePreset);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--editor-font-family',
      resolveFontStack(fontPreset),
    );
    document.documentElement.style.setProperty(
      '--editor-font-size',
      `${resolveFontSize(fontSizePreset)}px`,
    );
  }, [fontPreset, fontSizePreset]);
}
