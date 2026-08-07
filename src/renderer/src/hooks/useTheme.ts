import { useEffect } from 'react';
import { useStore } from '../stores/useStore';

export function useTheme() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const contentTheme = useStore((s) => s.contentTheme);
  const setContentTheme = useStore((s) => s.setContentTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return { theme, setTheme, contentTheme, setContentTheme };
}
