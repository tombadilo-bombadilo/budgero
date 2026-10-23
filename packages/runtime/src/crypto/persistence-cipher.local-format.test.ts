import { describe, expect, it } from 'vitest';
import { createLocalPersistenceCipher } from './persistence-cipher';
import { compressAndEncryptDatabase } from './database-crypto';
import { decryptEnvelope } from './envelope';
import { compress, tryDecompress } from './compression';

// A SQLite-shaped payload: the real 16-byte header, then a mix of repetitive
// (compressible) and pseudo-random bytes, like a page-structured DB file.
function sqliteLikeBytes(size = 64 * 1024): Uint8Array {
  const header = Array.from('SQLite format 3\u0000').map((c) => c.charCodeAt(0));
  const out = new Uint8Array(size);
  out.set(header, 0);
  let seed = 42;
  for (let i = header.length; i < size; i++) {
    if ((i >> 10) % 2 === 0) {
      out[i] = i % 7;
    } else {
      seed = (seed * 1103515245 + 12345) >>> 0;
      out[i] = seed >>> 24;
    }
  }
  return out;
}

describe('LocalPersistenceCipher local file format', () => {
  it('writes the local copy encrypted but not LZ4-compressed', async () => {
    const cipher = createLocalPersistenceCipher('master');
    const data = sqliteLikeBytes();

    const encrypted = await cipher.encrypt(data);

    // Encrypted: no plaintext SQLite header on disk.
    expect(Array.from(encrypted.subarray(0, 16))).not.toEqual(Array.from(data.subarray(0, 16)));
    // The envelope plaintext is the raw database, not an LZ4 frame.
    const { decrypted: inner } = await decryptEnvelope(encrypted, 'master');
    expect(Array.from(inner)).toEqual(Array.from(data));
    expect(tryDecompress(inner).wasCompressed).toBe(false);
  });

  it('round-trips the new uncompressed encrypted copy', async () => {
    const cipher = createLocalPersistenceCipher('master');
    const data = sqliteLikeBytes();

    const out = await cipher.decrypt(await cipher.encrypt(data));

    expect(out.wasEncrypted).toBe(true);
    expect(Array.from(out.decrypted)).toEqual(Array.from(data));
  });

  it('still opens an old LZ4-compressed encrypted local copy', async () => {
    const cipher = createLocalPersistenceCipher('master');
    const data = sqliteLikeBytes();
    // Exactly what the previous cipher.encrypt wrote to OPFS.
    const { encrypted: oldFormat, compressed } = await compressAndEncryptDatabase(data, 'master');
    expect(compressed.length).toBeLessThan(data.length);

    const out = await cipher.decrypt(oldFormat);

    expect(out.wasEncrypted).toBe(true);
    expect(Array.from(out.decrypted)).toEqual(Array.from(data));
  });

  it('never mistakes a raw SQLite file for an LZ4 frame', () => {
    const data = sqliteLikeBytes(4096);
    expect(tryDecompress(data)).toEqual({ data, wasCompressed: false });
    expect(tryDecompress(compress(data)).wasCompressed).toBe(true);
  });

  it('rejects the new format under a different master password', async () => {
    const encrypted = await createLocalPersistenceCipher('master').encrypt(sqliteLikeBytes());
    await expect(createLocalPersistenceCipher('other').decrypt(encrypted)).rejects.toThrow(
      'Decryption failed'
    );
  });
});
