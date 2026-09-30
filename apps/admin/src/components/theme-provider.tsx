'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const MEDIA = '(prefers-color-scheme: dark)';
const THEMES = ['light', 'dark'] as const;

type ThemeContextValue = {
  theme: string | undefined;
  setTheme: (theme: string) => void;
  resolvedTheme: string | undefined;
  themes: string[];
  systemTheme: 'light' | 'dark' | undefined;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia(MEDIA).matches ? 'dark' : 'light';
}

function writeThemeCookie(theme: string) {
  document.cookie = `theme=${encodeURIComponent(theme)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function withoutTransitions(run: () => void) {
  const style = document.createElement('style');
  style.appendChild(document.createTextNode('*,*::before,*::after{transition:none!important}'));
  document.head.appendChild(style);
  run();
  window.getComputedStyle(document.body);
  setTimeout(() => style.remove(), 1);
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  enableSystem = true,
  disableTransitionOnChange = false,
  storageKey = 'theme',
}: {
  children: React.ReactNode;
  attribute?: string;
  defaultTheme?: string;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
  storageKey?: string;
}) {
  const [theme, setThemeState] = useState<string | undefined>(undefined);
  const [resolvedTheme, setResolvedTheme] = useState<string | undefined>(undefined);

  const apply = useCallback(
    (next: string) => {
      const resolved = next === 'system' && enableSystem ? systemTheme() : next;
      const root = document.documentElement;
      root.classList.remove(...THEMES);
      if (resolved === 'light' || resolved === 'dark') {
        root.classList.add(resolved);
        root.style.colorScheme = resolved;
      }
      setResolvedTheme(resolved);
    },
    [enableSystem],
  );

  useEffect(() => {
    let stored = defaultTheme;
    try {
      stored = localStorage.getItem(storageKey) || defaultTheme;
    } catch {
      stored = defaultTheme;
    }
    setThemeState(stored);
    writeThemeCookie(stored);
    apply(stored);
  }, [apply, defaultTheme, storageKey]);

  useEffect(() => {
    const media = window.matchMedia(MEDIA);
    const onChange = () => {
      if ((theme ?? defaultTheme) === 'system' && enableSystem) apply('system');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [apply, defaultTheme, enableSystem, theme]);

  const setTheme = useCallback(
    (next: string) => {
      const commit = () => {
        setThemeState(next);
        try {
          localStorage.setItem(storageKey, next);
        } catch {
          /* ignore private mode */
        }
        writeThemeCookie(next);
        apply(next);
      };
      if (disableTransitionOnChange) withoutTransitions(commit);
      else commit();
    },
    [apply, disableTransitionOnChange, storageKey],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      resolvedTheme,
      themes: enableSystem ? [...THEMES, 'system'] : [...THEMES],
      systemTheme: typeof window === 'undefined' ? undefined : systemTheme(),
    }),
    [enableSystem, resolvedTheme, setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return (
    useContext(ThemeContext) ?? {
      theme: undefined,
      setTheme: () => undefined,
      resolvedTheme: undefined,
      themes: [...THEMES],
      systemTheme: undefined,
    }
  );
}
