/**
 * Compression utilities for database blobs using LZ4.
 */

import * as LZ4 from 'lz4js';

/**
 * Compress data using LZ4.
 */
export function compress(data: Uint8Array): Uint8Array {
  return LZ4.compress(data);
}

/**
 * Decompress LZ4 compressed data.
 */
export function decompress(data: Uint8Array): Uint8Array {
  return LZ4.decompress(data);
}

/**
 * Try to decompress data, returning original if decompression fails.
 * Useful for backward compatibility with uncompressed data.
 */
export function tryDecompress(data: Uint8Array): { data: Uint8Array; wasCompressed: boolean } {
  try {
    const decompressed = LZ4.decompress(data);
    return { data: decompressed, wasCompressed: true };
  } catch {
    return { data, wasCompressed: false };
  }
}
