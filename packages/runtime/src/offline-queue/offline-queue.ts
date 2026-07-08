/**
 * OfflineQueue — stores encrypted mutation payloads for offline replay.
 *
 * Extracted from SyncEngine. Uses IndexedDB (via storage interface) for
 * crash-resilient async storage.
 *
 * Queue stores encrypted payloads. Dedup is based on server-acknowledged
 * mutation IDs — the server handles dedup by mutation ID, not client heuristics.
 */

import type { MutationPayload } from '../types';
import { APPLIED_IDS_PREFIX } from '../types/storage-keys';
import { IndexedDBQueueStorage, type QueueStorage } from './storage';
import { logRuntime } from '../logging';

const MAX_APPLIED_IDS = 2000;

export class OfflineQueue {
  private readonly spaceId: string;

  private queue: MutationPayload[] = [];

  private appliedIds = new Set<string>();

  private inFlightIds = new Set<string>();

  /** Transient last-send timestamps; drives the unacked-resend sweep. */
  private sentAt = new Map<string, number>();

  private storage: QueueStorage;

  private loaded = false;

  /** In-flight first load; memoized so concurrent callers share one read. */
  private loadPromise: Promise<void> | null = null;

  /**
   * appliedIds changed in memory but not yet written to localStorage. The
   * persisted set must never lead the persisted DB (a recorded-but-lost
   * mutation would be skipped on replay forever), so the flush happens only
   * after a successful local DB persist — see flushAppliedIds().
   */
  private appliedIdsDirty = false;

  constructor(spaceId: string, storage?: QueueStorage) {
    this.spaceId = spaceId;
    this.storage = storage ?? new IndexedDBQueueStorage();
    this.loadAppliedIds();
  }

  /**
   * Add a mutation to the offline queue.
   */
  async add(mutation: MutationPayload): Promise<void> {
    await this.ensureLoaded();
    if (!mutation.spaceId) {
      mutation.spaceId = this.spaceId;
    }
    this.queue.push(mutation);
    await this.storage.save(this.spaceId, this.queue);
    logRuntime('debug', 'OfflineQueue', 'Mutation queued', {
      id: mutation.id,
      op: mutation.op,
      queueLength: this.queue.length,
      spaceId: this.spaceId,
    });
  }

  /**
   * Get a copy of the current queue.
   */
  async getQueue(): Promise<MutationPayload[]> {
    await this.ensureLoaded();
    return [...this.queue];
  }

  /**
   * Check if there are queued mutations.
   */
  async hasQueued(): Promise<boolean> {
    await this.ensureLoaded();
    return this.queue.length > 0;
  }

  /**
   * Get the number of queued mutations.
   */
  async getLength(): Promise<number> {
    await this.ensureLoaded();
    return this.queue.length;
  }

  /**
   * Synchronous check if there are queued mutations.
   * Returns false if the queue hasn't been loaded from storage yet.
   */
  hasQueuedNow(): boolean {
    return this.loaded && this.queue.length > 0;
  }

  /**
   * Synchronous queue length. Returns 0 if not loaded yet.
   */
  peekQueueLength(): number {
    return this.loaded ? this.queue.length : 0;
  }

  /**
   * Record that a mutation was (re-)sent over the socket, without removing it
   * from the queue. Removal happens only in {@link ackMutation} — a send is a
   * hope, an ack is a fact.
   */
  noteSent(mutationId: string, now: number = Date.now()): void {
    this.sentAt.set(mutationId, now);
  }

  /**
   * Queued mutations never sent this session, in queue (FIFO) order.
   * `sentAt` is transient, so after a reload every queued entry reads as
   * unsent — the first dispatch re-sends them in order, which is exactly
   * the causal-order guarantee we need (server dedups repeats by ID).
   */
  async getUnsent(): Promise<MutationPayload[]> {
    await this.ensureLoaded();
    return this.queue.filter((m) => !this.sentAt.has(m.id));
  }

  /**
   * Queued mutations for this space that were never sent, or whose last send
   * is older than `thresholdMs` without an ack — candidates for re-send.
   */
  async getStale(thresholdMs: number, now: number = Date.now()): Promise<MutationPayload[]> {
    await this.ensureLoaded();
    return this.queue.filter((m) => {
      if (m.spaceId && m.spaceId !== this.spaceId) return false;
      const last = this.sentAt.get(m.id);
      return last === undefined || now - last >= thresholdMs;
    });
  }

  /**
   * Server acknowledged this mutation: drop it from the queue and record it
   * as applied for dedup. The only path that removes a queued mutation.
   */
  async ackMutation(mutationId: string): Promise<void> {
    await this.ensureLoaded();
    this.markApplied(mutationId);
    this.sentAt.delete(mutationId);
    const before = this.queue.length;
    this.queue = this.queue.filter((m) => m.id !== mutationId);
    if (this.queue.length !== before) {
      await this.storage.save(this.spaceId, this.queue);
      logRuntime('debug', 'OfflineQueue', 'Mutation acked and dequeued', {
        id: mutationId,
        queueLength: this.queue.length,
        spaceId: this.spaceId,
      });
    }
  }

  /**
   * Check if a mutation ID has already been applied (for dedup).
   */
  isApplied(mutationId: string): boolean {
    return this.appliedIds.has(mutationId);
  }

  /**
   * Check if a mutation ID is currently in-flight.
   */
  isInFlight(mutationId: string): boolean {
    return this.inFlightIds.has(mutationId);
  }

  /**
   * Mark a mutation as in-flight.
   */
  addInFlight(mutationId: string): void {
    this.inFlightIds.add(mutationId);
  }

  /**
   * Remove a mutation from in-flight tracking.
   */
  removeInFlight(mutationId: string): void {
    this.inFlightIds.delete(mutationId);
  }

  /**
   * Mark a mutation as applied (for dedup), dropping it from in-flight
   * tracking. Does not touch the queue — see {@link ackMutation}.
   *
   * Memory-only until {@link flushAppliedIds}: persisting the id before the
   * DB write that contains its effect would let a crash leave a recorded
   * id whose mutation the persisted DB never kept — replay would then skip
   * it forever.
   */
  markApplied(mutationId: string): void {
    this.inFlightIds.delete(mutationId);
    this.appliedIds.add(mutationId);
    this.appliedIdsDirty = true;
  }

  /**
   * Persist the applied-id set. Call after a successful local DB persist —
   * that ordering keeps the invariant "persisted appliedIds never lead the
   * persisted DB".
   */
  flushAppliedIds(): void {
    if (!this.appliedIdsDirty) return;
    this.appliedIdsDirty = false;
    this.saveAppliedIds();
  }

  /**
   * The DB was just restored from a snapshot: every dedup record is now
   * stale (the DB no longer contains what they recorded), so clear both
   * sets — catch-up must RE-APPLY everything after the blob's bound
   * version, including our own previously-applied mutations. Queued local
   * mutations are the caller's job to re-apply (and re-mark in-flight).
   */
  resetForRestore(): void {
    this.appliedIds = new Set();
    this.inFlightIds = new Set();
    this.appliedIdsDirty = false;
    this.saveAppliedIds();
  }

  /**
   * Forget all last-send timestamps. Call on socket disconnect: the fate of
   * bytes written to a dead socket is unknown, so treating every queued
   * entry as never-sent restores the FIFO send discipline on the next
   * connection (the server dedups repeats by id).
   */
  resetSendState(): void {
    this.sentAt.clear();
  }

  /**
   * Clear the entire queue.
   */
  async clear(): Promise<void> {
    this.queue = [];
    await this.storage.clear(this.spaceId);
  }

  /**
   * Replace the queue with a filtered version (e.g., after partial replay).
   */
  async setQueue(remaining: MutationPayload[]): Promise<void> {
    this.queue = remaining;
    await this.storage.save(this.spaceId, this.queue);
  }

  // ---- Internals ----

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    // Memoized: overlapping first calls must share ONE load. Two racing
    // loads would each assign `this.queue`, and the slower one could wipe
    // an entry pushed by the faster caller in between — losing a durably
    // queued mutation.
    this.loadPromise ??= this.storage.load(this.spaceId).then((queue) => {
      this.queue = queue;
      this.loaded = true;
    });
    await this.loadPromise;
  }

  private loadAppliedIds(): void {
    try {
      const raw = localStorage.getItem(`${APPLIED_IDS_PREFIX}_${this.spaceId}`);
      if (!raw) {
        this.appliedIds = new Set();
        return;
      }
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        this.appliedIds = new Set(arr.filter((x: unknown) => typeof x === 'string'));
      } else {
        this.appliedIds = new Set();
      }
    } catch {
      this.appliedIds = new Set();
    }
  }

  private saveAppliedIds(): void {
    try {
      if (this.appliedIds.size > MAX_APPLIED_IDS) {
        const arr = Array.from(this.appliedIds);
        const trimmed = arr.slice(arr.length - MAX_APPLIED_IDS);
        this.appliedIds = new Set(trimmed);
      }
      localStorage.setItem(
        `${APPLIED_IDS_PREFIX}_${this.spaceId}`,
        JSON.stringify(Array.from(this.appliedIds))
      );
    } catch {
      /* no-op */
    }
  }
}
