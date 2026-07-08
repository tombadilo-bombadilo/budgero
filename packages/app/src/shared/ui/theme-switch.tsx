import { Moon, Palette, Sun } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { useThemePreset } from '@shared/contexts/ThemePresetContext';
import type { AppThemeId } from '@shared/lib/theme/presets';
import { persistUserPreferencesPatch } from '@shared/lib/user-preferences-sync';

export function ThemeSwitch() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { themeId, setThemeId, availableThemes } = useThemePreset();
  const [mounted, setMounted] = useState(false);
  const isMountedRef = useRef(false);

  // All hooks must be called before any early returns
  const selectedMode = theme ?? 'system';
  const currentDisplayMode = selectedMode === 'system' ? (resolvedTheme ?? 'system') : selectedMode;
  const selectedPreset = useMemo(
    () => availableThemes.find((preset) => preset.id === themeId) ?? availableThemes[0],
    [availableThemes, themeId]
  );

  const isDualMode = selectedPreset?.colorMode === 'dual';

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      queueMicrotask(() => {
        setMounted(true);
      });
    }
  }, []);

  // Early return after all hooks
  if (!mounted) {
    return null;
  }

  const handlePresetChange = (value: string) => {
    const nextId = value as AppThemeId;
    const nextPreset = availableThemes.find((p) => p.id === nextId);
    setThemeId(nextId);

    // Auto-force color mode for single-mode themes
    if (nextPreset && nextPreset.colorMode !== 'dual') {
      setTheme(nextPreset.colorMode);
      persistUserPreferencesPatch({ theme_mode: nextPreset.colorMode });
    }
  };

  const handleModeChange = (value: string) => {
    setTheme(value);
    persistUserPreferencesPatch({ theme_mode: value as 'light' | 'dark' | 'system' });
  };

  const handleToggleMode = () => {
    const next = currentDisplayMode === 'light' ? 'dark' : 'light';
    setTheme(next);
    persistUserPreferencesPatch({ theme_mode: next });
  };

  return (
    <div className="flex items-center gap-2">
      {isDualMode && (
        <Button variant="outline" size="icon" onClick={handleToggleMode}>
          {currentDisplayMode === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
          <span className="sr-only">Toggle color mode</span>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Palette className="h-4 w-4" />
            <span className="hidden sm:inline">{selectedPreset?.name ?? 'Theme preset'}</span>
            <span className="sr-only">Open theme preset menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Theme preset</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={themeId} onValueChange={handlePresetChange}>
            {availableThemes.map((preset) => (
              <DropdownMenuRadioItem key={preset.id} value={preset.id} className="gap-2">
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="text-sm font-medium">{preset.name}</span>
                  <div className="flex items-center gap-1">
                    {preset.previewColors.map((swatch, index) => (
                      <span
                        key={`${preset.id}-swatch-${index}`}
                        className="flex h-3 w-4 overflow-hidden rounded-full border border-border/60"
                      >
                        <span className="h-full w-1/2" style={{ backgroundColor: swatch.light }} />
                        <span className="h-full w-1/2" style={{ backgroundColor: swatch.dark }} />
                      </span>
                    ))}
                  </div>
                </div>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {isDualMode && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Color mode</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={selectedMode} onValueChange={handleModeChange}>
                <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
