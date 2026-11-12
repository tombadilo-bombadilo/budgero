import { describe, expect, it } from 'vitest';
import { sortableTransform } from './sortable-style';

describe('sortableTransform', () => {
  it('moves a card without ever scaling it', () => {
    const style = sortableTransform({ x: 120, y: -40, scaleX: 2.4, scaleY: 0.3 });
    expect(style).toBe('translate3d(120px, -40px, 0)');
    expect(style).not.toMatch(/scale/);
  });

  it('is empty while nothing is dragged', () => {
    expect(sortableTransform(null)).toBeUndefined();
  });
});
