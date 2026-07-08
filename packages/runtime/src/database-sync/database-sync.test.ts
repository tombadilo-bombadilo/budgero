import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiUnreachableError, DatabaseSync } from './database-sync';
import * as crypto from '../crypto';

function createDeps() {
  const db = {
    backup: vi.fn(async () => new Uint8Array([1, 2, 3])),
    restore: vi.fn(async () => undefined),
  };

  const deps = {
    getDatabase: vi.fn(() => db),
    checkApiHealth: vi.fn(async () => true),
    getPassphrase: vi.fn(() => 'secret'),
    getEncryptionKeyVersion: vi.fn(() => 2),
    setEncryptionKeyVersion: vi.fn(),
    getMutationCursor: vi.fn(() => 42),
    hasUnackedMutations: vi.fn(() => false),
    onDatabaseRestored: vi.fn(async () => undefined),
    uploadBlob: vi.fn(async () => ({ version: 11 })),
    downloadBlob: vi.fn(async () => ({
      data: new Uint8Array([9, 9]),
      headers: new Headers({
        'X-Encryption-Key-Version': '3',
        'X-Database-Version': '12',
        'X-Mutation-Version': '34',
      }),
    })),
  };

  return { db, deps };
}

describe('DatabaseSync', () => {
  afterEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* no-op */
    }
  });

  it('uploads snapshot and tracks blob version', async () => {
    const { deps } = createDeps();
    vi.spyOn(crypto, 'compressAndEncryptDatabase').mockResolvedValue({
      encrypted: new Uint8Array([7]),
      compressed: new Uint8Array([6]),
    });

    const sync = new DatabaseSync('s1', deps as never);
    sync.setBlobVersion(5);
    await sync.upload();

    // The current mutation cursor rides along, binding the blob to its
    // position in the mutation log.
    expect(deps.uploadBlob).toHaveBeenCalledWith('s1', new Uint8Array([7]), 5, 2, 42, undefined);
    expect(sync.getBlobVersion()).toBe(11);
  });

  it('skips upload when api/passphrase/db missing', async () => {
    const { deps } = createDeps();
    deps.checkApiHealth.mockResolvedValue(false);
    const sync = new DatabaseSync('s1', deps as never);

    await sync.upload();
    expect(deps.uploadBlob).not.toHaveBeenCalled();

    deps.checkApiHealth.mockResolvedValue(true);
    deps.getPassphrase.mockReturnValue(null);
    await sync.upload();
    expect(deps.uploadBlob).not.toHaveBeenCalled();

    deps.getDatabase.mockReturnValue(null);
    await sync.upload();
    expect(deps.uploadBlob).not.toHaveBeenCalled();
  });

  it('retries upload on version conflict after restore', async () => {
    const { db, deps } = createDeps();
    const sync = new DatabaseSync('s1', deps as never);

    vi.spyOn(crypto, 'compressAndEncryptDatabase').mockResolvedValue({
      encrypted: new Uint8Array([7]),
      compressed: new Uint8Array([6]),
    });
    vi.spyOn(crypto, 'decryptAndDecompressDatabase').mockResolvedValue({
      decrypted: new Uint8Array([1, 1, 1]),
    });

    deps.uploadBlob
      .mockRejectedValueOnce({ status: 409, response: 'version_conflict' })
      .mockResolvedValueOnce({ version: 22 });

    await sync.upload();

    expect(deps.downloadBlob).toHaveBeenCalled();
    expect(db.restore).toHaveBeenCalledWith(new Uint8Array([1, 1, 1]));
    // The restore hook fires with the downloaded blob's bound version (34)
    // so the wiring reseeds the cursor and re-applies queued mutations.
    expect(deps.onDatabaseRestored).toHaveBeenCalledWith(34);
    expect(deps.uploadBlob).toHaveBeenCalledTimes(2);
    // Both attempts bind from the live cursor: after the restore the hook
    // has made cursor and DB content agree, so bind-from-cursor stays
    // correct on the retry too (the mock cursor is fixed at 42).
    expect(deps.uploadBlob).toHaveBeenNthCalledWith(
      1,
      's1',
      new Uint8Array([7]),
      undefined,
      2,
      42,
      undefined
    );
    expect(deps.uploadBlob).toHaveBeenNthCalledWith(
      2,
      's1',
      new Uint8Array([7]),
      12,
      2,
      42,
      undefined
    );
    expect(sync.getBlobVersion()).toBe(22);
  });

  it('threads the outOfBand flag through to uploadBlob', async () => {
    const { deps } = createDeps();
    vi.spyOn(crypto, 'compressAndEncryptDatabase').mockResolvedValue({
      encrypted: new Uint8Array([7]),
      compressed: new Uint8Array([6]),
    });

    const sync = new DatabaseSync('s1', deps as never);
    sync.setBlobVersion(5);
    await sync.upload({ outOfBand: true });

    expect(deps.uploadBlob).toHaveBeenCalledWith('s1', new Uint8Array([7]), 5, 2, 42, true);
  });

  it('retries an out-of-band upload after a version conflict WITHOUT restoring', async () => {
    // The imported/restored content exists only in this local DB — the
    // normal conflict recovery (restore server blob, re-upload) would
    // destroy it. OOB conflicts must adopt the server version and re-upload
    // the local DB as-is.
    const { db, deps } = createDeps();
    const sync = new DatabaseSync('s1', deps as never);
    sync.setBlobVersion(5);

    vi.spyOn(crypto, 'compressAndEncryptDatabase').mockResolvedValue({
      encrypted: new Uint8Array([7]),
      compressed: new Uint8Array([6]),
    });

    deps.uploadBlob
      .mockRejectedValueOnce({
        status: 409,
        response: JSON.stringify({ error: 'version_conflict', server_version: 12 }),
      })
      .mockResolvedValueOnce({ version: 13 });

    await sync.upload({ outOfBand: true });

    expect(deps.downloadBlob).not.toHaveBeenCalled();
    expect(db.restore).not.toHaveBeenCalled();
    expect(deps.uploadBlob).toHaveBeenNthCalledWith(1, 's1', new Uint8Array([7]), 5, 2, 42, true);
    expect(deps.uploadBlob).toHaveBeenNthCalledWith(2, 's1', new Uint8Array([7]), 12, 2, 42, true);
    expect(sync.getBlobVersion()).toBe(13);
  });

  it('defers the conflict-retry upload while unacked mutations are pending', async () => {
    const { db, deps } = createDeps();
    deps.hasUnackedMutations.mockReturnValue(true);
    const sync = new DatabaseSync('s1', deps as never);

    vi.spyOn(crypto, 'compressAndEncryptDatabase').mockResolvedValue({
      encrypted: new Uint8Array([7]),
      compressed: new Uint8Array([6]),
    });
    vi.spyOn(crypto, 'decryptAndDecompressDatabase').mockResolvedValue({
      decrypted: new Uint8Array([1, 1, 1]),
    });

    deps.uploadBlob.mockRejectedValueOnce({ status: 409, response: 'version_conflict' });

    // Re-applied queued mutations are in the DB but not yet in the log —
    // uploading now would bind effects the log can't account for.
    await expect(sync.upload()).rejects.toThrow(/unacked mutations pending/);
    expect(db.restore).toHaveBeenCalled();
    expect(deps.uploadBlob).toHaveBeenCalledTimes(1);
  });

  it('adopts server_version from conflict payload before retrying', async () => {
    const { deps } = createDeps();
    const sync = new DatabaseSync('s1', deps as never);
    sync.setBlobVersion(5);

    vi.spyOn(crypto, 'compressAndEncryptDatabase').mockResolvedValue({
      encrypted: new Uint8Array([7]),
      compressed: new Uint8Array([6]),
    });
    vi.spyOn(sync, 'downloadAndRestore').mockResolvedValue(true);

    deps.uploadBlob
      .mockRejectedValueOnce({
        status: 409,
        response: JSON.stringify({ error: 'version_conflict', server_version: 12 }),
      })
      .mockResolvedValueOnce({ version: 20 });

    await sync.upload();

    expect(deps.uploadBlob).toHaveBeenNthCalledWith(
      1,
      's1',
      new Uint8Array([7]),
      5,
      2,
      42,
      undefined
    );
    // The retry binds from the live cursor (the restore hook keeps cursor
    // and DB content in agreement).
    expect(deps.uploadBlob).toHaveBeenNthCalledWith(
      2,
      's1',
      new Uint8Array([7]),
      12,
      2,
      42,
      undefined
    );
    expect(sync.getBlobVersion()).toBe(20);
  });

  it('does not treat encryption_key_outdated as a version conflict', async () => {
    const { deps } = createDeps();
    const sync = new DatabaseSync('s1', deps as never);

    vi.spyOn(crypto, 'compressAndEncryptDatabase').mockResolvedValue({
      encrypted: new Uint8Array([7]),
      compressed: new Uint8Array([6]),
    });
    vi.spyOn(sync, 'downloadAndRestore');

    deps.uploadBlob.mockRejectedValueOnce({
      status: 409,
      response: JSON.stringify({ error: 'encryption_key_outdated', server_key_version: 4 }),
    });

    await expect(sync.upload()).rejects.toEqual(
      expect.objectContaining({
        status: 409,
      })
    );
    expect(sync.downloadAndRestore).not.toHaveBeenCalled();
    expect(deps.uploadBlob).toHaveBeenCalledTimes(1);
  });

  it('downloads, updates versions, and decrypts payload', async () => {
    const { deps } = createDeps();
    vi.spyOn(crypto, 'decryptAndDecompressDatabase').mockResolvedValue({
      decrypted: new Uint8Array([4, 5, 6]),
    });

    const sync = new DatabaseSync('s1', deps as never);
    const data = await sync.download();

    expect(data).toEqual(new Uint8Array([4, 5, 6]));
    expect(deps.setEncryptionKeyVersion).toHaveBeenCalledWith('s1', 3);
    expect(sync.getBlobVersion()).toBe(12);
    // The blob's bound mutation-log position is exposed for cursor seeding.
    expect(sync.getLastDownloadedMutationVersion()).toBe(34);
  });

  it('distinguishes unreachable API (throws) from absent snapshot (null)', async () => {
    const { deps } = createDeps();
    const sync = new DatabaseSync('s1', deps as never);

    // Unreachable API is transient — it must NOT read as "no snapshot
    // exists", which catch-up recovery treats as terminal (sync disabled).
    deps.checkApiHealth.mockResolvedValue(false);
    await expect(sync.download()).rejects.toBeInstanceOf(ApiUnreachableError);

    deps.checkApiHealth.mockResolvedValue(true);
    deps.downloadBlob.mockResolvedValue(null);
    expect(await sync.download()).toBeNull();
  });

  it('throws clear error when decrypt fails', async () => {
    const { deps } = createDeps();
    deps.getPassphrase.mockReturnValue('secret');

    vi.spyOn(crypto, 'decryptAndDecompressDatabase').mockRejectedValue(
      new Error('wrong key or password')
    );

    const sync = new DatabaseSync('s1', deps as never);
    await expect(sync.download()).rejects.toThrow('Decryption failed');
  });

  it('downloadAndRestore restores current db and threshold flush is reentrant-safe', async () => {
    const { db, deps } = createDeps();
    const sync = new DatabaseSync('s1', {
      ...deps,
      uploadPolicy: { mutationThreshold: 2 },
    } as never);
    vi.spyOn(sync, 'download').mockResolvedValue(new Uint8Array([8]));

    await expect(sync.downloadAndRestore()).resolves.toBe(true);
    expect(db.restore).toHaveBeenCalledWith(new Uint8Array([8]));

    const uploadSpy = vi
      .spyOn(sync, 'upload')
      .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 0)));
    sync.scheduleUpload(); // 1 pending < threshold — arms timer only
    expect(uploadSpy).not.toHaveBeenCalled();
    sync.scheduleUpload(); // hits threshold — uploads
    sync.scheduleUpload(); // while in progress — no second upload
    sync.scheduleUpload();

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(uploadSpy).toHaveBeenCalledTimes(1);

    sync.destroy();
  });

  it('debounces uploads: max-delay timer fires, unacked mutations defer', async () => {
    const { deps } = createDeps();
    const timers: (() => void)[] = [];
    const delays: number[] = [];
    const sync = new DatabaseSync('s1', {
      ...deps,
      uploadPolicy: { mutationThreshold: 100, maxDelayMs: 60_000, unackedRetryMs: 500 },
      setTimeout: (cb: () => void, ms: number) => {
        timers.push(cb);
        delays.push(ms);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: () => undefined,
    } as never);
    const uploadSpy = vi.spyOn(sync, 'upload').mockResolvedValue(undefined);

    // Nothing pending yet: flush is a no-op.
    sync.flushPendingUpload('test');
    expect(uploadSpy).not.toHaveBeenCalled();

    // Below threshold: only the max-delay timer is armed (once per batch).
    sync.scheduleUpload();
    sync.scheduleUpload();
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(delays).toEqual([60_000]);

    // Unacked mutations at fire time: defer with the retry delay.
    deps.hasUnackedMutations.mockReturnValue(true);
    timers[0]!();
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(delays).toEqual([60_000, 500]);

    // Acked by the retry: upload proceeds.
    deps.hasUnackedMutations.mockReturnValue(false);
    timers[1]!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(uploadSpy).toHaveBeenCalledTimes(1);

    sync.destroy();
  });

  it('handles conflict retry edge cases and isVersionConflict detection branches', async () => {
    const { deps } = createDeps();
    const sync = new DatabaseSync('s1', deps as never);
    vi.spyOn(crypto, 'compressAndEncryptDatabase').mockResolvedValue({
      encrypted: new Uint8Array([7]),
      compressed: new Uint8Array([6]),
    });

    deps.uploadBlob.mockRejectedValueOnce({ response: 'version_conflict in response body' });
    vi.spyOn(sync, 'downloadAndRestore').mockResolvedValue(false);

    await sync.upload();
    expect(sync.downloadAndRestore).toHaveBeenCalled();
    expect(deps.uploadBlob).toHaveBeenCalledTimes(1);

    deps.uploadBlob
      .mockReset()
      .mockRejectedValueOnce(new Error('version_conflict message'))
      .mockResolvedValueOnce({ version: 33 });
    (sync.downloadAndRestore as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    await sync.upload();
    expect(deps.uploadBlob).toHaveBeenCalledTimes(2);
  });

  it('covers download/decrypt/restore failure branches', async () => {
    const { deps } = createDeps();
    const sync = new DatabaseSync('s1', deps as never);

    deps.getPassphrase.mockReturnValue(null);
    await expect(sync.download()).rejects.toThrow('No secret available');

    deps.getPassphrase.mockReturnValue('secret');
    vi.spyOn(crypto, 'decryptAndDecompressDatabase').mockRejectedValueOnce(new Error('io failure'));
    await expect(sync.download()).rejects.toThrow(
      'Failed to restore workspace snapshot from server'
    );

    vi.spyOn(sync, 'download').mockResolvedValueOnce(new Uint8Array([1]));
    deps.getDatabase.mockReturnValue(null);
    await expect(sync.downloadAndRestore()).rejects.toThrow('No database available for restore');
  });
});
