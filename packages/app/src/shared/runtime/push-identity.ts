import type { ImportIdentity } from '@budgero/core/browser';

/** Persist the queue reference in the replicated add payload, before execution. */
export function withPushIdentity(
  args: Record<string, unknown>,
  messageId: string
): Record<string, unknown> {
  const identity: ImportIdentity = {
    operationId: `push:${messageId}`,
    fileRowKey: `push:${messageId}`,
    sourceKey: 'push-api',
    date: String(args.date ?? ''),
    inflow: Number(args.inflow ?? 0),
    outflow: Number(args.outflow ?? 0),
    payee: String(args.payee ?? ''),
    memo: String(args.memo ?? ''),
    currency: '',
  };
  return { ...args, importIdentities: [identity] };
}
