import { describe, expect, it } from 'vitest';
import {
  decodeSpaceKey,
  decryptSpaceKeyFromInvite,
  encodeSpaceKey,
  encryptSpaceKeyForInvite,
  generateInviteSecret,
  generateSpaceKey,
  hashInviteSecret,
  unwrapSpaceKeyWithMaster,
  wrapSpaceKeyWithMaster,
} from './space-key-crypto';

describe('space key crypto', () => {
  it('generates, encodes and decodes space key', () => {
    const key = generateSpaceKey();
    expect(key.length).toBe(32);

    const encoded = encodeSpaceKey(key);
    const decoded = decodeSpaceKey(encoded);
    expect(decoded).toEqual(key);
  });

  it('wraps and unwraps with master password', async () => {
    const key = generateSpaceKey();
    const wrapped = await wrapSpaceKeyWithMaster(key, 'master');
    const unwrapped = await unwrapSpaceKeyWithMaster(wrapped, 'master');

    expect(unwrapped).toEqual(key);
  });

  it('supports invite encryption/decryption', async () => {
    const key = generateSpaceKey();
    const secret = generateInviteSecret();
    const bundle = await encryptSpaceKeyForInvite(key, secret);
    const decrypted = await decryptSpaceKeyFromInvite(bundle, secret);

    expect(decrypted).toEqual(key);
  });

  it('hashes secret and validates malformed invite payloads', async () => {
    const hash = await hashInviteSecret('abc');
    expect(hash).toHaveLength(64);

    await expect(decryptSpaceKeyFromInvite('{"bad":1}', generateInviteSecret())).rejects.toThrow(
      'Unsupported invite bundle version'
    );
    await expect(decryptSpaceKeyFromInvite('bad-json', generateInviteSecret())).rejects.toThrow(
      'Invalid invite bundle payload'
    );
  });
});
