import { describe, expect, it } from 'vitest';
import { normalizePagePath } from './track';

describe('normalizePagePath', () => {
  it('hides saved question ids but keeps the new-question and prebuilt paths', () => {
    expect(normalizePagePath('/reports/question/2f1c0e5a-1234')).toBe(
      '/reports/question/:questionId'
    );
    expect(normalizePagePath('/reports/question/new')).toBe('/reports/question/new');
    expect(normalizePagePath('/reports/prebuilt/spending')).toBe('/reports/prebuilt/spending');
    expect(normalizePagePath('/reports')).toBe('/reports');
  });
});
