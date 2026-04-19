import { ReactNode, useEffect, useState } from 'react';
import { DEFAULT_THEME_ID, THEMES } from '../themes';

const THEME_LINK_ID = 'tomedome-theme-stylesheet';

interface Props {
  themeId?: string;
  children: ReactNode;
}

export function ThemeProvider({ themeId = DEFAULT_THEME_ID, children }: Props) {
  const theme = THEMES[themeId] ?? THEMES[DEFAULT_THEME_ID]!;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    document.documentElement.dataset['theme'] = theme.id;
    setLoaded(false);

    document.getElementById(THEME_LINK_ID)?.remove();

    const link = document.createElement('link');
    link.id = THEME_LINK_ID;
    link.rel = 'stylesheet';
    link.href = theme.stylesheetUrl;

    const done = () => {
      if (!cancelled) setLoaded(true);
    };
    link.onload = done;
    link.onerror = done;
    document.head.appendChild(link);

    return () => {
      cancelled = true;
      link.onload = null;
      link.onerror = null;
      link.remove();
    };
  }, [theme.id, theme.stylesheetUrl]);

  if (!loaded) return null;

  const { Decor } = theme;
  return (
    <>
      <Decor />
      {children}
    </>
  );
}
