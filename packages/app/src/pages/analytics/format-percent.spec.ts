import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@lingui/core';
import { formatPercent } from './format-percent';

describe('formatPercent', () => {
  afterEach(() => i18n.activate('en'));

  it('keeps the requested decimals', () => {
    i18n.activate('en');
    expect(formatPercent(12.345, 1)).toBe('12.3%');
    expect(formatPercent(12.5)).toBe('13%');
    expect(formatPercent(40, 1)).toBe('40.0%');
  });

  it('follows the app language', () => {
    i18n.load('de', {});
    i18n.activate('de');
    expect(formatPercent(12.5, 1)).toMatch(/^12,5\s%$/);
  });
});
