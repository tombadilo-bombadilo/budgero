/**
 * Database encryption utilities combining compression and envelope encryption.
 */

import { compress, tryDecompress } from './compression';
import { encryptEnvelope, decryptEnvelope } from './envelope';
import { logRuntime } from '../logging';

export interface CompressAndEncryptResult {
  encrypted: Uint8Array;
  compressed: Uint8Array;
}

export interface DecryptAndDecompressResult {
  decrypted: Uint8Array;
}

/**
 * Compress and encrypt a database blob.
 */
export async function compressAndEncryptDatabase(
  data: Uint8Array,
  masterPassword: string
): Promise<CompressAndEncryptResult> {
  const compressed = compress(data);
  logRuntime('debug', 'DatabaseCrypto', 'Compressed database with LZ4', {
    originalSize: data.length,
    compressedSize: compressed.length,
    reductionPercent: ((1 - compressed.length / data.length) * 100).toFixed(1),
  });

  const encrypted = await encryptEnvelope(compressed, masterPassword);
  logRuntime('debug', 'DatabaseCrypto', 'Envelope-encrypted compressed database', {
    encryptedSize: encrypted.length,
  });

  return { encrypted, compressed };
}

/**
 * Decrypt and decompress a database blob.
 */
export async function decryptAndDecompressDatabase(
  encryptedData: Uint8Array,
  masterPassword: string
): Promise<DecryptAndDecompressResult> {
  const { decrypted: compressedData } = await decryptEnvelope(encryptedData, masterPassword);
  logRuntime('debug', 'DatabaseCrypto', 'Envelope decrypted compressed data', {
    compressedSize: compressedData.length,
  });

  const { data: decrypted, wasCompressed } = tryDecompress(compressedData);
  if (wasCompressed) {
    logRuntime('debug', 'DatabaseCrypto', 'LZ4 decompressed database', {
      compressedSize: compressedData.length,
      decompressedSize: decrypted.length,
    });
  } else {
    logRuntime('debug', 'DatabaseCrypto', 'Data was not compressed, using as-is');
  }

  if (decrypted.length === 0) {
    throw new Error('Decrypted data is empty');
  }

  return { decrypted };
}
