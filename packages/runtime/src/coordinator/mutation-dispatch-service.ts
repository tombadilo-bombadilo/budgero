import type { MutationResult, MutationSpec, MutationPayload, WebDatabaseInstance } from '../types';
import { MUTATION_FORMAT_VERSION } from '../sync-format.js';
import { persistDatabase } from '../utils/persist-database';

interface MutationExecutionContext {
  spaceId: string;
  executor: {
    execute<T = unknown>(
      spec: MutationSpec
    ): Promise<{ result: T; mutationId: string; isReceiver: boolean }>;
  };
  sync: {
    isConnected(): boolean;
    send(payload: {
      id: string;
      op: string;
      args: Record<string, unknown>;
      spaceId?: string;
    }): Promise<boolean>;
  };
  dbSync: {
    scheduleUpload(): void;
  };
  offlineQueue: {
    add(mutation: MutationPayload): Promise<void>;
    addInFlight(mutationId: string): void;
    markApplied(mutationId: string): void;
    noteSent(mutationId: string): void;
    getUnsent(): Promise<MutationPayload[]>;
  };
  db: WebDatabaseInstance;
  persistLocalDatabase?(): Promise<boolean>;
}

export class MutationDispatchService {
  async executeMutation<T = unknown>(
    spec: MutationSpec,
    ctx: MutationExecutionContext
  ): Promise<MutationResult<T>> {
    const { result, mutationId, isReceiver } = await ctx.executor.execute<T>(spec);

    // Inbound mutation already applied by executor path.
    if (isReceiver) {
      return { result, synced: false, queued: false };
    }

    const payload: MutationPayload = {
      id: mutationId,
      v: MUTATION_FORMAT_VERSION,
      op: spec.op,
      args: spec.payload,
      baseVersion: 0,
      timestamp: new Date(),
      spaceId: ctx.spaceId,
    };

    // At-least-once delivery: every mutation is queued durably BEFORE any
    // send attempt and leaves the queue only when the server acks its ID
    // (the server dedups re-sends on UNIQUE(space_id, id)). A ws.send() that
    // "succeeds" only proves the bytes entered the socket buffer.
    await ctx.offlineQueue.add(payload);
    // Applied-marking makes a catch-up echo of our own mutation a dedup
    // no-op (and an implicit ack) instead of a local double-apply. It goes
    // into the DURABLE dedup set, flushed together with the DB persist
    // below — the old memory-only in-flight marker let a reload in the
    // send→ack window re-apply our own mutation via its catch-up echo.
    ctx.offlineQueue.markApplied(payload.id);

    if (ctx.sync.isConnected()) {
      // Causal order: the server assigns log versions by ARRIVAL, so this
      // mutation must never overtake an older queued-but-unsent one (e.g. a
      // mutation that raced a still-connecting socket and is waiting for the
      // resend sweep). Otherwise a fresh device replaying the log sees
      // children before their parent (account before its budget) and dies on
      // FK constraints. Send every unsent entry in queue (FIFO) order —
      // overlap with the sweep is safe, the server dedups repeats by ID.
      const unsent = await ctx.offlineQueue.getUnsent();
      let sentOwn = false;
      for (const m of unsent) {
        if (m.spaceId && m.spaceId !== ctx.spaceId) continue;
        const ok = await ctx.sync.send({
          id: m.id,
          op: m.op,
          args: m.args,
          spaceId: ctx.spaceId,
        });
        if (!ok) break;
        ctx.offlineQueue.noteSent(m.id);
        if (m.id === payload.id) sentOwn = true;
      }
      if (sentOwn) {
        await this.persistLocalMutation(ctx);
        ctx.dbSync.scheduleUpload();
        return { result, synced: true, queued: false };
      }
    }

    // Offline or send failed: stays queued for replay; persist best-effort.
    await this.persistLocalMutation(ctx);

    return { result, synced: false, queued: true };
  }

  private async persistLocalMutation(ctx: MutationExecutionContext): Promise<void> {
    try {
      if (ctx.persistLocalDatabase) {
        await ctx.persistLocalDatabase();
        return;
      }
      await persistDatabase(ctx.db);
    } catch {
      /* no-op */
    }
  }
}
