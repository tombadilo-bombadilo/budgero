/* eslint-disable react-refresh/only-export-components */
import { createContext, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useRequiredContext } from '@shared/lib/useRequiredContext';
import {
  APP_THEMES,
  AppThemeId,
  DEFAULT_APP_THEME_ID,
  THEME_STORAGE_KEY,
  normalizeAppThemeId,
} from '@shared/lib/theme/presets';
import { persistUserPreferencesPatch } from '@shared/lib/user-preferences-sync';
import { useTheme } from 'next-themes';

type ThemePresetContextValue = {
  themeId: AppThemeId;
  setThemeId: (themeId: AppThemeId) => void;
  availableThemes: typeof APP_THEMES;
};

const ThemePresetContext = createContext<ThemePresetContextValue | undefined>(undefined);

function applyThemeAttribute(themeId: AppThemeId) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (themeId === DEFAULT_APP_THEME_ID) {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', themeId);
  }

  // Eagerly sync the class attribute for single-mode themes so the correct
  // CSS variables win before React/next-themes hydrate.
  const preset = APP_THEMES.find((t) => t.id === themeId);
  if (preset && preset.colorMode !== 'dual') {
    if (preset.colorMode === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }
  }
}

export function ThemePresetProvider({ children }: { children: ReactNode }) {
  const { setTheme } = useTheme();
  const [themeId, setThemeIdState] = useState<AppThemeId>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_APP_THEME_ID;
    }
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      const resolved = normalizeAppThemeId(stored);
      applyThemeAttribute(resolved);
      return resolved;
    } catch {
      applyThemeAttribute(DEFAULT_APP_THEME_ID);
      return DEFAULT_APP_THEME_ID;
    }
  });

  // Force next-themes color mode to match single-mode presets on mount and
  // whenever the preset changes. Without this, a light-only theme like Paper
  // gets the wrong CSS variables when the system preference is dark.
  useEffect(() => {
    const preset = APP_THEMES.find((t) => t.id === themeId);
    if (preset && preset.colorMode !== 'dual') {
      setTheme(preset.colorMode);
    }
  }, [themeId, setTheme]);

  useEffect(() => {
    applyThemeAttribute(themeId);
    if (typeof window === 'undefined') return;
    try {
      if (themeId === DEFAULT_APP_THEME_ID) {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
      }
    } catch {
      // no-op if storage is not available
    }
  }, [themeId]);

  const setThemeId = useCallback((nextThemeId: AppThemeId) => {
    const resolvedThemeId = normalizeAppThemeId(nextThemeId);
    setThemeIdState(resolvedThemeId);
    persistUserPreferencesPatch({ theme_preset: resolvedThemeId });
  }, []);

  const value = useMemo<ThemePresetContextValue>(
    () => ({ themeId, setThemeId, availableThemes: APP_THEMES }),
    [themeId, setThemeId]
  );

  return <ThemePresetContext.Provider value={value}>{children}</ThemePresetContext.Provider>;
}

export function useThemePreset() {
  return useRequiredContext(ThemePresetContext, 'ThemePreset');
}
