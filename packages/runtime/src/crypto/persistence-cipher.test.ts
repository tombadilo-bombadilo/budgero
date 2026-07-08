import { describe, expect, it, vi } from 'vitest';
import { createLocalPersistenceCipher } from './persistence-cipher';
import * as dbCrypto from './database-crypto';

describe('LocalPersistenceCipher', () => {
  it('encrypts and decrypts encrypted payloads', async () => {
    const cipher = createLocalPersistenceCipher('master');
    const data = new TextEncoder().encode('hello sqlite bytes hello sqlite bytes');

    const encrypted = await cipher.encrypt(data);
    const out = await cipher.decrypt(encrypted);

    expect(Array.from(out.decrypted)).toEqual(Array.from(data));
    expect(out.wasEncrypted).toBe(true);
  });

  it('falls back to plaintext sqlite payload when decrypt fails', async () => {
    const cipher = createLocalPersistenceCipher('master');
    const sqliteHeader = new Uint8Array(Array.from('SQLite format 3\u0000').map((c) => c.charCodeAt(0)));

    vi.spyOn(dbCrypto, 'decryptAndDecompressDatabase').mockRejectedValue(new Error('bad key'));

    const out = await cipher.decrypt(sqliteHeader);
    expect(out.wasEncrypted).toBe(false);
    expect(out.decrypted).toEqual(sqliteHeader);
  });

  it('handles sqlite fallback when decrypt rejects with non-Error values', async () => {
    const cipher = createLocalPersistenceCipher('master');
    const sqliteHeader = new Uint8Array(Array.from('SQLite format 3\u0000').map((c) => c.charCodeAt(0)));
    vi.spyOn(dbCrypto, 'decryptAndDecompressDatabase').mockRejectedValue('bad key');

    const out = await cipher.decrypt(sqliteHeader);
    expect(out.wasEncrypted).toBe(false);
    expect(out.decrypted).toEqual(sqliteHeader);
  });

  it('throws normalized error for non-sqlite decrypt failures', async () => {
    const cipher = createLocalPersistenceCipher('master');
    vi.spyOn(dbCrypto, 'decryptAndDecompressDatabase').mockRejectedValue(new Error('broken'));

    await expect(cipher.decrypt(new Uint8Array([1, 2, 3]))).rejects.toThrow('Decryption failed');
  });

  it('handles sqlite-header mismatch and non-Error rejection shape', async () => {
    const cipher = createLocalPersistenceCipher('master');
    const nearHeader = new Uint8Array(Array.from('SQLite format 3x').map((c) => c.charCodeAt(0)));
    vi.spyOn(dbCrypto, 'decryptAndDecompressDatabase').mockRejectedValue('broken');

    await expect(cipher.decrypt(nearHeader)).rejects.toThrow('Decryption failed');
  });
});
