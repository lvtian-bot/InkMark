import { useEffect } from 'react';
import { selectAppTheme, selectContentTheme, useStore } from '../stores/useStore';

export function useTheme() {
  const themeId = useStore((s) => s.themeId);
  const setThemeId = useStore((s) => s.setThemeId);
  const theme = useStore(selectAppTheme);
  const contentTheme = useStore(selectContentTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return { themeId, setThemeId, theme, contentTheme };
}
