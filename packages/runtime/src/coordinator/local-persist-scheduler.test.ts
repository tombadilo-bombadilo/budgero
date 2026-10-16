import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalPersistScheduler,
  LOCAL_PERSIST_DEBOUNCE_MS,
  LOCAL_PERSIST_MAX_WAIT_MS,
} from './local-persist-scheduler';

function controlledWriter() {
  const calls: { resolve(ok: boolean): void }[] = [];
  const write = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        calls.push({ resolve });
      })
  );
  return { write, calls };
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('LocalPersistScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shares a queued write between callers and starts a new one after it began', async () => {
    const { write, calls } = controlledWriter();
    const s = new LocalPersistScheduler(write, { listenForPageHide: false });

    const a = s.persistNow();
    const b = s.persistNow();
    expect(a).toBe(b);
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1);

    // The first write has started (exported); later callers need a new one.
    const c = s.persistNow();
    const d = s.persistNow();
    expect(c).toBe(d);
    expect(c).not.toBe(a);
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1); // chained, never two at once

    calls[0]!.resolve(true);
    await expect(a).resolves.toBe(true);
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(2);
    calls[1]!.resolve(false);
    await expect(c).resolves.toBe(false);
  });

  it('debounces persistSoon into one trailing write', async () => {
    const { write, calls } = controlledWriter();
    const s = new LocalPersistScheduler(write, { listenForPageHide: false });

    const waits = [s.persistSoon(), s.persistSoon()];
    vi.advanceTimersByTime(LOCAL_PERSIST_DEBOUNCE_MS - 1);
    waits.push(s.persistSoon());
    vi.advanceTimersByTime(LOCAL_PERSIST_DEBOUNCE_MS - 1);
    await flushMicrotasks();
    expect(write).not.toHaveBeenCalled();
    expect(s.hasPending()).toBe(true);

    vi.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1);
    expect(s.hasPending()).toBe(false);

    calls[0]!.resolve(true);
    await expect(Promise.all(waits)).resolves.toEqual([true, true, true]);
  });

  it('writes at most maxWait after the first request under continuous load', async () => {
    const { write, calls } = controlledWriter();
    const s = new LocalPersistScheduler(write, { listenForPageHide: false });

    s.persistSoon();
    for (let t = 0; t < LOCAL_PERSIST_MAX_WAIT_MS - 100; t += 100) {
      vi.advanceTimersByTime(100);
      s.persistSoon();
    }
    await flushMicrotasks();
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1);
    calls[0]!.resolve(true);
  });

  it('persistNow and flush settle a pending debounced request', async () => {
    const { write, calls } = controlledWriter();
    const s = new LocalPersistScheduler(write, { listenForPageHide: false });

    const soon = s.persistSoon();
    const flushed = s.flush();
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1);
    calls[0]!.resolve(true);
    await expect(soon).resolves.toBe(true);
    await expect(flushed).resolves.toBe(true);

    vi.advanceTimersByTime(LOCAL_PERSIST_MAX_WAIT_MS);
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1); // the timer was cleared
  });

  it('flush without a pending request waits for the in-flight write', async () => {
    const { write, calls } = controlledWriter();
    const s = new LocalPersistScheduler(write, { listenForPageHide: false });
    void s.persistNow();
    await flushMicrotasks();

    let done = false;
    void s.flush().then(() => {
      done = true;
    });
    await flushMicrotasks();
    expect(done).toBe(false);
    calls[0]!.resolve(true);
    await flushMicrotasks();
    expect(done).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('dispose drops a pending write and refuses new ones', async () => {
    const { write } = controlledWriter();
    const s = new LocalPersistScheduler(write, { listenForPageHide: false });
    const soon = s.persistSoon();

    s.dispose();

    await expect(soon).resolves.toBe(false);
    vi.advanceTimersByTime(LOCAL_PERSIST_MAX_WAIT_MS);
    await expect(s.persistSoon()).resolves.toBe(false);
    await expect(s.persistNow()).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('flushes a pending write when the page is hidden or unloaded', async () => {
    const docListeners = new Map<string, () => void>();
    const winListeners = new Map<string, () => void>();
    const doc = {
      visibilityState: 'visible',
      addEventListener: (type: string, fn: () => void) => docListeners.set(type, fn),
      removeEventListener: (type: string) => docListeners.delete(type),
    };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: () => void) => winListeners.set(type, fn),
      removeEventListener: (type: string) => winListeners.delete(type),
    });
    const { write, calls } = controlledWriter();
    const s = new LocalPersistScheduler(write);

    s.persistSoon();
    docListeners.get('visibilitychange')!(); // still visible: no-op
    await flushMicrotasks();
    expect(write).not.toHaveBeenCalled();
    doc.visibilityState = 'hidden';
    docListeners.get('visibilitychange')!();
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1);
    calls[0]!.resolve(true);
    await flushMicrotasks();

    s.persistSoon();
    winListeners.get('pagehide')!();
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(2);
    calls[1]!.resolve(true);

    s.dispose();
    expect(docListeners.size).toBe(0);
    expect(winListeners.size).toBe(0);
  });
});
