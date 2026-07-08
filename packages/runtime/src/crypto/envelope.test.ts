import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearEnvelopeCache, decryptEnvelope, encryptEnvelope, getCachedSalt } from './envelope';

describe('envelope crypto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnvelopeCache();
  });

  it('encrypts and decrypts payload', async () => {
    clearEnvelopeCache();
    const data = new TextEncoder().encode('secret payload');

    const encrypted = await encryptEnvelope(data, 'master-pass');
    const out = await decryptEnvelope(encrypted, 'master-pass');

    expect(Array.from(out.decrypted)).toEqual(Array.from(data));
    expect(out.iterations).toBeGreaterThan(1000);
    expect(getCachedSalt()).not.toBeNull();
  });

  it('fails on invalid envelope structure', async () => {
    await expect(decryptEnvelope(new Uint8Array([1, 2]), 'master-pass')).rejects.toThrow(
      'Invalid envelope'
    );
  });

  it('fails on missing magic and missing iterations envelope errors', async () => {
    await expect(
      decryptEnvelope(new Uint8Array([0, 0, 0, 0, 2, 1, 2, 3, 4]), 'master-pass')
    ).rejects.toThrow('missing magic');

    const magicNoIterations = new Uint8Array([0x42, 0x47, 0x45, 0x31, 2, 0, 0, 0]);
    await expect(decryptEnvelope(magicNoIterations, 'master-pass')).rejects.toThrow(
      'missing iterations'
    );
  });

  it('fails on unsupported version', async () => {
    const data = new TextEncoder().encode('abc');
    const encrypted = await encryptEnvelope(data, 'master-pass');
    encrypted[4] = 99;

    await expect(decryptEnvelope(encrypted, 'master-pass')).rejects.toThrow('Unsupported envelope');
  });

  it('clears cached salt', async () => {
    const data = new Uint8Array([9]);
    await encryptEnvelope(data, 'master-pass');
    expect(getCachedSalt()).not.toBeNull();

    clearEnvelopeCache();
    expect(getCachedSalt()).toBeNull();
  });

  it('throws clear error when global crypto is missing or subtle is invalid', async () => {
    vi.stubGlobal('crypto', undefined as unknown as Crypto);
    await expect(encryptEnvelope(new Uint8Array([1]), 'master-pass')).rejects.toThrow(
      'WebCryptoUnavailable'
    );

    vi.stubGlobal(
      'crypto',
      {
        getRandomValues: (arr: Uint8Array) => arr,
        subtle: undefined,
      } as unknown as Crypto
    );
    await expect(encryptEnvelope(new Uint8Array([1]), 'master-pass')).rejects.toThrow(
      'WebCryptoUnavailable'
    );

    vi.stubGlobal(
      'crypto',
      {
        getRandomValues: (arr: Uint8Array) => arr,
        subtle: { importKey: undefined } as unknown as SubtleCrypto,
      } as unknown as Crypto
    );
    await expect(encryptEnvelope(new Uint8Array([1]), 'master-pass')).rejects.toThrow(
      'WebCryptoUnavailable'
    );
  });

  it('covers defensive cache-invariant branch in encryptEnvelope', async () => {
    const realCrypto = globalThis.crypto;
    const realSubtle = realCrypto.subtle;
    let firstEncrypt = true;

    vi.stubGlobal(
      'crypto',
      {
        getRandomValues: (arr: Uint8Array) => realCrypto.getRandomValues(arr),
        subtle: {
          importKey: (...args: Parameters<SubtleCrypto['importKey']>) =>
            realSubtle.importKey(...args),
          deriveKey: (...args: Parameters<SubtleCrypto['deriveKey']>) =>
            realSubtle.deriveKey(...args),
          digest: (...args: Parameters<SubtleCrypto['digest']>) => realSubtle.digest(...args),
          encrypt: async (...args: Parameters<SubtleCrypto['encrypt']>) => {
            const out = await realSubtle.encrypt(...args);
            if (firstEncrypt) {
              firstEncrypt = false;
              queueMicrotask(() => clearEnvelopeCache());
            }
            return out;
          },
          decrypt: (...args: Parameters<SubtleCrypto['decrypt']>) => realSubtle.decrypt(...args),
        } as unknown as SubtleCrypto,
      } as unknown as Crypto
    );

    await expect(encryptEnvelope(new Uint8Array([1, 2, 3]), 'master-pass')).rejects.toThrow(
      'Envelope header not initialized'
    );
  });
});
