import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutationEncryption } from './mutation-crypto';

describe('MutationEncryption', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('encrypts/decrypts from password', async () => {
    const enc = await MutationEncryption.fromPassword('master');
    const payload = { op: 'budgets.create', args: { amount: 1 } };

    const encrypted = await enc.encryptMutation(payload);
    const decrypted = await enc.decryptMutation(encrypted);

    expect(decrypted).toEqual(payload);
    expect(enc.getSalt().length).toBe(32);
  });

  it('encrypts/decrypts from space key', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const enc = await MutationEncryption.fromSpaceKey(key);

    const encrypted = await enc.encryptMutation({ op: 'x', args: { y: 1 } });
    const decrypted = await enc.decryptMutation(encrypted);

    expect(decrypted.op).toBe('x');
    expect(decrypted.args).toEqual({ y: 1 });
  });

  it('encrypts/decrypts a large payload without stack overflow', async () => {
    const enc = await MutationEncryption.fromPassword('master');
    // ~1MB string, like a base64 image attached to a chat message. The old
    // String.fromCharCode.apply(null, hugeArray) threw "Maximum call stack size exceeded".
    const big = 'x'.repeat(1_000_000);
    const payload = { op: 'chat.addMessage', args: { content: big } };

    const encrypted = await enc.encryptMutation(payload);
    const decrypted = await enc.decryptMutation(encrypted);

    expect(decrypted.args.content).toBe(big);
  });

  it('rejects invalid payloads and salt mismatch', async () => {
    const enc1 = await MutationEncryption.fromPassword('a', new Uint8Array(32).fill(1));
    const enc2 = await MutationEncryption.fromPassword('b', new Uint8Array(32).fill(2));

    await expect(enc1.decryptMutation('AAAA')).rejects.toThrow('too short');

    const encrypted = await enc1.encryptMutation({ op: 'x', args: {} });
    await expect(enc2.decryptMutation(encrypted)).rejects.toThrow('different key');
  });

  it('rejects when WebCrypto is unavailable or incomplete', async () => {
    vi.stubGlobal('crypto', undefined as unknown as Crypto);
    await expect(MutationEncryption.fromPassword('master')).rejects.toThrow(
      'WebCryptoUnavailable'
    );

    vi.stubGlobal(
      'crypto',
      {
        getRandomValues: (arr: Uint8Array) => arr,
        subtle: undefined,
      } as unknown as Crypto
    );
    await expect(MutationEncryption.fromPassword('master')).rejects.toThrow(
      'WebCryptoUnavailable'
    );

    vi.stubGlobal(
      'crypto',
      {
        getRandomValues: (arr: Uint8Array) => arr,
        subtle: { importKey: undefined } as unknown as SubtleCrypto,
      } as unknown as Crypto
    );
    await expect(MutationEncryption.fromPassword('master')).rejects.toThrow(
      'WebCryptoUnavailable'
    );
  });

  it('covers length-mismatch branch in constant-time salt comparison', async () => {
    const source = await MutationEncryption.fromPassword('a', new Uint8Array(32).fill(1));
    const target = await MutationEncryption.fromPassword('b', new Uint8Array(16).fill(2));

    const encrypted = await source.encryptMutation({ op: 'x', args: {} });
    await expect(target.decryptMutation(encrypted)).rejects.toThrow('different key');
  });
});
