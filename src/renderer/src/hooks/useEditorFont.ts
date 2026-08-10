import { useEffect } from 'react';
import {
  resolveFontSize,
  resolveFontStack,
  resolveLetterSpacing,
  resolveLineHeight,
} from '../font-presets';
import { useStore } from '../stores/useStore';

// 把用户选择的字体族、字号与排版参数注入为 CSS 变量，供编辑区读取。
// 与 useTheme 并列：主题管明暗与排版风格，这里管正文的字体与基础排版。
export function useEditorFont() {
  const fontPreset = useStore((s) => s.fontPreset);
  const fontSizePreset = useStore((s) => s.fontSizePreset);
  const lineHeightPreset = useStore((s) => s.lineHeightPreset);
  const letterSpacingPreset = useStore((s) => s.letterSpacingPreset);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--editor-font-family',
      resolveFontStack(fontPreset),
    );
    document.documentElement.style.setProperty(
      '--editor-font-size',
      `${resolveFontSize(fontSizePreset)}px`,
    );
    document.documentElement.style.setProperty(
      '--editor-line-height',
      `${resolveLineHeight(lineHeightPreset)}`,
    );
    document.documentElement.style.setProperty(
      '--editor-letter-spacing',
      resolveLetterSpacing(letterSpacingPreset),
    );
  }, [fontPreset, fontSizePreset, letterSpacingPreset, lineHeightPreset]);
}
