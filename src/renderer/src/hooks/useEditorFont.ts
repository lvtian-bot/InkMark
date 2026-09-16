import { useEffect } from 'react';
import { resolveFontSize, resolveFontStack, resolveLetterSpacing } from '../font-presets';
import {
  LINE_HEIGHT_RANGE,
  LIST_SPACING_RANGE,
  PARAGRAPH_SPACING_RANGE,
  clampTypographyValue,
} from '../typography';
import { useStore } from '../stores/useStore';

// 把用户选择的字体族、字号与排版参数注入为 CSS 变量，供编辑区读取。
// 与 useTheme 并列：主题管明暗与排版风格，这里管正文的字体与基础排版；
// 正文宽度档位由 useEditorWidth 注入。排版数值经 clamp 夹回范围，兼容
// HMR 下旧 store 缺字段的情况。
export function useEditorFont() {
  const fontPreset = useStore((s) => s.fontPreset);
  const fontSizePreset = useStore((s) => s.fontSizePreset);
  const lineHeight = useStore((s) => s.lineHeight);
  const paragraphSpacing = useStore((s) => s.paragraphSpacing);
  const listSpacing = useStore((s) => s.listSpacing);
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
      `${clampTypographyValue(LINE_HEIGHT_RANGE, lineHeight)}`,
    );
    document.documentElement.style.setProperty(
      '--editor-paragraph-spacing',
      `${clampTypographyValue(PARAGRAPH_SPACING_RANGE, paragraphSpacing)}em`,
    );
    document.documentElement.style.setProperty(
      '--editor-list-spacing',
      `${clampTypographyValue(LIST_SPACING_RANGE, listSpacing)}em`,
    );
    document.documentElement.style.setProperty(
      '--editor-letter-spacing',
      resolveLetterSpacing(letterSpacingPreset),
    );
  }, [fontPreset, fontSizePreset, letterSpacingPreset, lineHeight, paragraphSpacing, listSpacing]);
}
