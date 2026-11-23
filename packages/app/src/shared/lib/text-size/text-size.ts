/**
 * App-wide text size (Settings → Appearance), per device. It scales the root
 * font size, so every rem-based size (Tailwind text, spacing, row heights)
 * grows with it; chart labels and the few sizes still in px don't.
 *
 * index.html applies the stored choice before the first paint (keep its
 * inline script in step with TEXT_SIZE_STORAGE_KEY and the values here); the
 * scale itself lives in index.css under html[data-text-size].
 */
export type TextSize = 'default' | 'large' | 'larger';

export const TEXT_SIZE_STORAGE_KEY = 'budgero:text-size';

/** Root font size multiplier per setting (matches index.css). */
export const TEXT_SIZE_SCALE: Record<TextSize, number> = {
  default: 1,
  large: 1.125,
  larger: 1.25,
};

export function isTextSize(value: unknown): value is TextSize {
  return value === 'default' || value === 'large' || value === 'larger';
}

export function applyTextSize(size: TextSize): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (size === 'default') root.removeAttribute('data-text-size');
  else root.setAttribute('data-text-size', size);
}
