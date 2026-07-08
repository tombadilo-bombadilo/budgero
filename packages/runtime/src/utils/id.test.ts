import { describe, expect, it } from 'vitest';
import { generateMutationId } from './id';

describe('generateMutationId', () => {
  it('creates prefixed, unique mutation ids', () => {
    const a = generateMutationId();
    const b = generateMutationId();

    expect(a.startsWith('mut_')).toBe(true);
    expect(a).not.toBe(b);
    // mut_ + a v4 UUID
    expect(a).toMatch(/^mut_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
