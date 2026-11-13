import { describe, expect, it } from 'vitest';
import { CATEGORICAL_DARK, CATEGORICAL_LIGHT } from './palette';

function hsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60;
  return [h, s, l];
}

describe('categorical palette', () => {
  it.each([
    ['light', CATEGORICAL_LIGHT],
    ['dark', CATEGORICAL_DARK],
  ])('%s: 12 distinct colours, neighbours far apart in hue or lightness', (_, palette) => {
    expect(palette).toHaveLength(12);
    expect(new Set(palette).size).toBe(12);
    palette.forEach((color, index) => {
      if (index === 0) return;
      const [h1, , l1] = hsl(palette[index - 1]);
      const [h2, , l2] = hsl(color);
      const hue = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
      expect(hue >= 30 || Math.abs(l1 - l2) >= 0.15, `${palette[index - 1]} → ${color}`).toBe(true);
    });
  });
});
