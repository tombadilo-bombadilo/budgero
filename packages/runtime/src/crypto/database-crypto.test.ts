import { describe, expect, it } from 'vitest';
import { compressAndEncryptDatabase, decryptAndDecompressDatabase } from './database-crypto';
import { encryptEnvelope } from './envelope';

describe('database crypto', () => {
  it('compresses+encrypts then decrypts+decompresses', async () => {
    const data = new TextEncoder().encode('sqlite-bytes-sqlite-bytes-sqlite-bytes');

    const { encrypted, compressed } = await compressAndEncryptDatabase(data, 'pass');
    expect(encrypted.length).toBeGreaterThan(0);
    expect(compressed.length).toBeGreaterThan(0);

    const out = await decryptAndDecompressDatabase(encrypted, 'pass');
    expect(Array.from(out.decrypted)).toEqual(Array.from(data));
  });

  it('throws for wrong password and empty decrypted data', async () => {
    const data = new TextEncoder().encode('abcabcabcabcabcabcabcabcabcabcabcabc');
    const { encrypted } = await compressAndEncryptDatabase(data, 'pass1');

    await expect(decryptAndDecompressDatabase(encrypted, 'pass2')).rejects.toThrow();

    const { encrypted: emptyEncrypted } = await compressAndEncryptDatabase(new Uint8Array([]), 'x');
    await expect(decryptAndDecompressDatabase(emptyEncrypted, 'x')).rejects.toThrow('empty');
  });

  it('supports decrypt path for payloads that were not compressed', async () => {
    const raw = new TextEncoder().encode('SQLite format 3\0raw-bytes-without-lz4-header');
    const encrypted = await encryptEnvelope(raw, 'pass');

    const out = await decryptAndDecompressDatabase(encrypted, 'pass');
    expect(Array.from(out.decrypted)).toEqual(Array.from(raw));
  });
});
