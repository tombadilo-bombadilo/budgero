import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __setOpfsWorkerFactoryForTests,
  needsOpfsWorkerWriter,
  writeOpfsFileViaWorker,
  type OpfsWorkerLike,
} from '../src/database/opfs-sync-writer';

/** A worker stand-in that answers like the real one. */
function fakeWorker(reply: (msg: { id: number; filename: string; buffer: ArrayBuffer }) => object) {
  const posted: { filename: string; bytes: number[] }[] = [];
  const w: OpfsWorkerLike = {
    onmessage: null,
    onerror: null,
    terminate: vi.fn(),
    postMessage(message: unknown) {
      const msg = message as { id: number; filename: string; buffer: ArrayBuffer };
      posted.push({ filename: msg.filename, bytes: Array.from(new Uint8Array(msg.buffer)) });
      queueMicrotask(() => w.onmessage?.({ data: { id: msg.id, ...reply(msg) } } as MessageEvent));
    },
  };
  return { w, posted };
}

describe('OPFS worker writer (Safari < 26)', () => {
  afterEach(() => __setOpfsWorkerFactoryForTests(null));

  it('detects a file handle without createWritable', () => {
    expect(needsOpfsWorkerWriter({})).toBe(true);
    expect(needsOpfsWorkerWriter({ createWritable: async () => ({}) })).toBe(false);
  });

  it('writes the whole file through the worker', async () => {
    const { w, posted } = fakeWorker(() => ({ ok: true }));
    __setOpfsWorkerFactoryForTests(() => w);
    await writeOpfsFileViaWorker('space_x.db', new Uint8Array([1, 2, 3]).buffer);
    expect(posted).toEqual([{ filename: 'space_x.db', bytes: [1, 2, 3] }]);
  });

  it('rejects with the worker error name (e.g. a locked file)', async () => {
    const { w } = fakeWorker(() => ({
      ok: false,
      name: 'NoModificationAllowedError',
      message: 'locked',
    }));
    __setOpfsWorkerFactoryForTests(() => w);
    await expect(writeOpfsFileViaWorker('space_x.db', new ArrayBuffer(1))).rejects.toMatchObject({
      name: 'NoModificationAllowedError',
    });
  });

  it('fails in-flight writes and recreates the worker after a worker error', async () => {
    const broken: OpfsWorkerLike = {
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
      postMessage() {
        queueMicrotask(() => broken.onerror?.(new Event('error')));
      },
    };
    const { w: healthy, posted } = fakeWorker(() => ({ ok: true }));
    const factory = vi.fn().mockReturnValueOnce(broken).mockReturnValue(healthy);
    __setOpfsWorkerFactoryForTests(factory);
    await expect(writeOpfsFileViaWorker('a.db', new ArrayBuffer(1))).rejects.toThrow(
      'OPFS writer worker failed'
    );
    await writeOpfsFileViaWorker('a.db', new Uint8Array([9]).buffer);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(posted).toEqual([{ filename: 'a.db', bytes: [9] }]);
  });
});
