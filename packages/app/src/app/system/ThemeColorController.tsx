import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useThemePreset } from '@shared/contexts/ThemePresetContext';

const FALLBACK_LIGHT = '#ffffff';
const FALLBACK_DARK = '#0b0d11';
const DARK_LUMINANCE_THRESHOLD = 0.45;

type RGB = { r: number; g: number; b: number };

const parseRgbColor = (value: string | null | undefined): RGB | null => {
  if (!value) return null;
  const match = value.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s]+[\d.]+)?\s*\)/i
  );
  if (!match) return null;
  const [, r, g, b] = match;
  return {
    r: Number.parseFloat(r),
    g: Number.parseFloat(g),
    b: Number.parseFloat(b),
  };
};

const relativeLuminance = ({ r, g, b }: RGB) => {
  const normalize = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const R = normalize(r);
  const G = normalize(g);
  const B = normalize(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};

const resolveSurfaceColor = (fallback: string) => {
  const nav =
    document.querySelector<HTMLElement>('[data-mobile-top-bar]') ??
    document.querySelector<HTMLElement>('[data-desktop-top-bar]');
  if (nav) {
    const bg = getComputedStyle(nav).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)') {
      return bg;
    }
  }

  if (document.body) {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.position = 'fixed';
    probe.style.pointerEvents = 'none';
    probe.style.opacity = '0';
    probe.style.width = '1px';
    probe.style.height = '1px';
    probe.style.background = 'var(--card)';
    document.body.appendChild(probe);
    const bg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    if (bg && bg !== 'rgba(0, 0, 0, 0)') {
      return bg;
    }
  }

  return fallback;
};

export function ThemeColorController() {
  const { resolvedTheme } = useTheme();
  const { themeId } = useThemePreset();

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
    const fallbackColor = theme === 'dark' ? FALLBACK_DARK : FALLBACK_LIGHT;
    const surfaceColor = resolveSurfaceColor(fallbackColor);
    const rgb = parseRgbColor(surfaceColor);
    const isDark = rgb ? relativeLuminance(rgb) < DARK_LUMINANCE_THRESHOLD : theme === 'dark';
    const statusBarStyle = isDark ? 'black' : 'default';

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', surfaceColor);
    }

    const appleStatusMeta = document.querySelector(
      'meta[name="apple-mobile-web-app-status-bar-style"]'
    );
    if (appleStatusMeta) {
      appleStatusMeta.setAttribute('content', statusBarStyle);
    }

    const htmlElement = document.documentElement;
    if (htmlElement) {
      htmlElement.style.backgroundColor = surfaceColor;
    }
  }, [resolvedTheme, themeId]);

  return null;
}
