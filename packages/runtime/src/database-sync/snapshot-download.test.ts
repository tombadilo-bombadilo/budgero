import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadSnapshot } from './snapshot-download';
import * as crypto from '../crypto';

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function blob(data: number[], headers: Record<string, string>) {
  return { data: new Uint8Array(data), headers: new Headers(headers) };
}

describe('downloadSnapshot integrity check', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockDecrypt() {
    return vi
      .spyOn(crypto, 'decryptAndDecompressDatabase')
      .mockImplementation(async (data: Uint8Array) => ({ decrypted: data }) as never);
  }

  it('accepts a blob whose bytes match X-Database-Hash', async () => {
    const decrypt = mockDecrypt();
    const bytes = [1, 2, 3];
    const downloadBlob = vi.fn(async () =>
      blob(bytes, {
        'X-Database-Hash': sha256Hex(new Uint8Array(bytes)),
        'X-Database-Version': '7',
        'X-Mutation-Version': '40',
      })
    );

    const snapshot = await downloadSnapshot({ downloadBlob }, 's1', 'pw');

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(snapshot?.blobVersion).toBe(7);
    expect(snapshot?.mutationVersion).toBe(40);
  });

  it('re-downloads when the bytes do not match and trusts only the verified response', async () => {
    const decrypt = mockDecrypt();
    const fresh = [4, 5, 6];
    const downloadBlob = vi
      .fn()
      // Stale bytes served with the NEW version headers: must not be trusted.
      .mockResolvedValueOnce(
        blob([9, 9, 9], {
          'X-Database-Hash': sha256Hex(new Uint8Array(fresh)),
          'X-Database-Version': '8',
          'X-Mutation-Version': '50',
        })
      )
      .mockResolvedValueOnce(
        blob(fresh, {
          'X-Database-Hash': sha256Hex(new Uint8Array(fresh)),
          'X-Database-Version': '8',
          'X-Mutation-Version': '50',
        })
      );

    const snapshot = await downloadSnapshot({ downloadBlob }, 's1', 'pw');

    expect(downloadBlob).toHaveBeenCalledTimes(2);
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(Array.from(decrypt.mock.calls[0][0])).toEqual(fresh);
    expect(snapshot?.mutationVersion).toBe(50);
  });

  it('fails without decrypting when the blob never matches its hash', async () => {
    const decrypt = mockDecrypt();
    const downloadBlob = vi.fn(async () =>
      blob([1], { 'X-Database-Hash': 'deadbeef', 'X-Mutation-Version': '3' })
    );

    await expect(downloadSnapshot({ downloadBlob }, 's1', 'pw')).rejects.toThrow(
      /integrity check failed/
    );
    expect(downloadBlob).toHaveBeenCalledTimes(3);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('accepts responses without a hash header (legacy servers)', async () => {
    const decrypt = mockDecrypt();
    const downloadBlob = vi.fn(async () => blob([1, 2], { 'X-Database-Version': '2' }));

    const snapshot = await downloadSnapshot({ downloadBlob }, 's1', 'pw');

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(snapshot?.blobVersion).toBe(2);
  });

  it('returns null when the server has no snapshot', async () => {
    mockDecrypt();
    const downloadBlob = vi.fn(async () => null);

    await expect(downloadSnapshot({ downloadBlob }, 's1', 'pw')).resolves.toBeNull();
  });
});
