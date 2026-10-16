/**
 * LocalPersistScheduler — coalesces local DB persists (export + encrypt +
 * OPFS write of the whole database) for one active space.
 *
 * Every mutation, ack and applied remote mutation used to write the whole
 * database, one after another. Now:
 *  - `persistNow()` writes as soon as the previous write is done. Callers
 *    that arrive while a write is queued share it (the queued write has not
 *    exported yet, so it still contains their changes).
 *  - `persistSoon()` is a trailing debounce (250 ms, at most 1 s after the
 *    first request), so a burst of mutations (bulk edit, bank sync, catch-up)
 *    costs one write per second instead of one or two per op.
 *  - `flush()` runs a pending debounced write right away; the page calls it
 *    when it is hidden (visibilitychange / pagehide), the runtime before a
 *    snapshot upload, a snapshot restore and a space switch. `dispose()`
 *    drops a pending write (sign-out wipes local storage; the DB is closed).
 *
 * What happens if the tab dies before a debounced write runs: the local DB
 * file is up to ~1 s behind memory. Nothing is lost, because the durable
 * state that recovery reads never runs ahead of that file:
 *  - local mutations are in the IndexedDB offline queue before they are sent,
 *    and only leave it on the server's ack;
 *  - the mutation cursor (localStorage) is written only after a persist that
 *    contains everything up to it (SyncTransport.updateLocalVersion);
 *  - applied ids are flushed only for mutations applied before that persist's
 *    export began (OfflineQueue.appliedIdsMark / flushAppliedIds).
 * On reload the DB opens at the last write and catch-up replays the log from
 * the persisted cursor. Mutations after it, our own included, are not in the
 * persisted applied set, so they are applied again; our queued ones are then
 * re-sent and the server dedups them by id. Mutations that never reached the
 * server (offline, failed send) are not debounced: MutationDispatchService
 * still persists those right away, as before.
 */

export const LOCAL_PERSIST_DEBOUNCE_MS = 250;
export const LOCAL_PERSIST_MAX_WAIT_MS = 1000;

interface Deferred {
  promise: Promise<boolean>;
  resolve(value: boolean | Promise<boolean>): void;
}

function deferred(): Deferred {
  let resolve!: Deferred['resolve'];
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export interface LocalPersistSchedulerOptions {
  debounceMs?: number;
  maxWaitMs?: number;
  now?(): number;
  /** Register page-lifecycle listeners that flush (default: true in browsers). */
  listenForPageHide?: boolean;
}

export class LocalPersistScheduler {
  private readonly runWrite: () => Promise<boolean>;

  private readonly debounceMs: number;

  private readonly maxWaitMs: number;

  private readonly now: () => number;

  /** Last write in the chain (resolves when it finished). */
  private tail: Promise<boolean> = Promise.resolve(true);

  /** A write that is chained but has not started (not exported) yet. */
  private queued: Promise<boolean> | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;

  private soon: Deferred | null = null;

  private soonSince = 0;

  private disposed = false;

  private listening = false;

  private readonly onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') return;
    void this.flush();
  };

  private readonly onPageHide = () => {
    void this.flush();
  };

  /** `write` persists the DB; it must catch its own errors and resolve false. */
  constructor(write: () => Promise<boolean>, options: LocalPersistSchedulerOptions = {}) {
    this.runWrite = write;
    this.debounceMs = options.debounceMs ?? LOCAL_PERSIST_DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? LOCAL_PERSIST_MAX_WAIT_MS;
    this.now = options.now ?? (() => Date.now());
    if (options.listenForPageHide ?? true) this.addPageListeners();
  }

  /**
   * Persist after the previous write finishes. Resolves with the result of a
   * write whose export started after this call. Also settles a pending
   * debounced request: this write covers it.
   */
  persistNow(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    const waiting = this.takeSoon();
    let write = this.queued;
    if (!write) {
      const start = () => {
        this.queued = null;
        return this.runWrite();
      };
      write = this.tail.then(start, start);
      this.queued = write;
      this.tail = write;
    }
    waiting?.resolve(write);
    return write;
  }

  /**
   * Debounced persist: runs `debounceMs` after the last request, and at most
   * `maxWaitMs` after the first one. Resolves like {@link persistNow}.
   */
  persistSoon(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    const now = this.now();
    if (!this.soon) {
      this.soon = deferred();
      this.soonSince = now;
    }
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.max(0, Math.min(this.debounceMs, this.soonSince + this.maxWaitMs - now));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persistNow();
    }, delay);
    return this.soon.promise;
  }

  /** Write a pending debounced request now; otherwise wait for in-flight writes. */
  flush(): Promise<boolean> {
    if (this.soon) return this.persistNow();
    return this.tail;
  }

  hasPending(): boolean {
    return this.soon !== null;
  }

  /** Drop a pending debounced write and stop accepting new ones. */
  dispose(): void {
    this.disposed = true;
    this.takeSoon()?.resolve(false);
    this.removePageListeners();
  }

  private takeSoon(): Deferred | null {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const waiting = this.soon;
    this.soon = null;
    return waiting;
  }

  private addPageListeners(): void {
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      this.listening = true;
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', this.onPageHide);
      this.listening = true;
    }
  }

  private removePageListeners(): void {
    if (!this.listening) return;
    this.listening = false;
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pagehide', this.onPageHide);
    }
  }
}
