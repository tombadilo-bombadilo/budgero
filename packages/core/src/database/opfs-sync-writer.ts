/**
 * OPFS write path for browsers without FileSystemFileHandle.createWritable()
 * on the main thread (Safari before 26). Those browsers can still read OPFS
 * files (getFile) but only write them through createSyncAccessHandle(), which
 * exists only inside a dedicated worker (Safari 15.2+).
 *
 * Seen in production 2026-10-31: on Safari 18.6 every local save threw a
 * TypeError, the device never kept a local copy, then wiped and re-uploaded
 * an empty workspace.
 */

/** Runs in the worker: one message = one whole-file write. */
const WORKER_SOURCE = `
self.onmessage = async (event) => {
  const { id, filename, buffer } = event.data;
  let handle;
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(filename, { create: true });
    handle = await fileHandle.createSyncAccessHandle();
    const bytes = new Uint8Array(buffer);
    handle.truncate(0);
    let written = 0;
    while (written < bytes.byteLength) {
      written += handle.write(bytes.subarray(written), { at: written });
    }
    handle.flush();
    handle.close();
    handle = undefined;
    self.postMessage({ id, ok: true });
  } catch (error) {
    try { handle && handle.close(); } catch (_) {}
    self.postMessage({
      id,
      ok: false,
      name: (error && error.name) || 'Error',
      message: String((error && error.message) || error),
    });
  }
};
`;

export interface OpfsWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent | Event) => void) | null;
  terminate(): void;
}

type WorkerFactory = () => OpfsWorkerLike;

let createWorker: WorkerFactory = () => {
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  return new Worker(url) as unknown as OpfsWorkerLike;
};

let worker: OpfsWorkerLike | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();

function getWorker(): OpfsWorkerLike {
  if (worker) return worker;
  const created = createWorker();
  created.onmessage = (event: MessageEvent) => {
    const data = event.data as { id: number; ok: boolean; name?: string; message?: string };
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) {
      entry.resolve();
    } else {
      const error = new Error(data.message ?? 'OPFS write failed');
      error.name = data.name ?? 'Error';
      entry.reject(error);
    }
  };
  created.onerror = () => {
    // A broken worker fails everything in flight and is recreated next time.
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(new Error('OPFS writer worker failed'));
    }
    created.terminate();
    if (worker === created) worker = null;
  };
  worker = created;
  return created;
}

/** True when the main thread cannot write OPFS files directly. */
export function needsOpfsWorkerWriter(fileHandle: unknown): boolean {
  return typeof (fileHandle as { createWritable?: unknown })?.createWritable !== 'function';
}

/** Write a whole OPFS file through the worker (replaces existing content). */
export function writeOpfsFileViaWorker(filename: string, data: ArrayBuffer): Promise<void> {
  const id = nextId++;
  return new Promise<void>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ id, filename, buffer: data }, [data]);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Test-only: swap the worker factory and reset state. */
export function __setOpfsWorkerFactoryForTests(factory: WorkerFactory | null): void {
  worker?.terminate();
  worker = null;
  pending.clear();
  if (factory) createWorker = factory;
}
