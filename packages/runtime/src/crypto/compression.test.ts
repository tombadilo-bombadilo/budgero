import { describe, expect, it } from 'vitest';
import { compress, decompress, tryDecompress } from './compression';

describe('compression', () => {
  it('compresses and decompresses bytes', () => {
    const raw = new TextEncoder().encode('hello world hello world hello world');
    const compressed = compress(raw);
    const restored = decompress(compressed);

    expect(Array.from(restored)).toEqual(Array.from(raw));
  });

  it('tryDecompress returns original on invalid data', () => {
    const raw = new Uint8Array([1, 2, 3, 4]);
    const out = tryDecompress(raw);
    expect(out.data).toEqual(raw);
    expect(out.wasCompressed).toBe(false);
  });
});
