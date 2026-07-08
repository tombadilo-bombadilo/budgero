/**
 * Types for mutation history tracking
 */

export type MutationOrigin = 'local' | 'remote';

export type MutationStatus = 'success' | 'failed';

export type MutationErrorCode =
  | 'DECRYPTION_FAILED'
  | 'INVALID_PAYLOAD'
  | 'INVALID_OP'
  | 'MUTATION_ERROR'
  | 'UNKNOWN';

export interface OpCall {
  op: string;
  args: Record<string, unknown>;
}

export interface MutationHistoryEntry {
  ID: number;
  BudgetID: number;
  SpaceID: string | null;
  MutationID: string;
  Timestamp: string;
  UserID: string | null;
  Op: string;
  Payload: string; // JSON stringified
  Origin: MutationOrigin;
  UndoOps: string | null; // JSON stringified OpCall[]
  RedoOps: string | null; // JSON stringified OpCall[]
  UndoneAt: string | null;
  Status: MutationStatus;
  ErrorMessage: string | null;
  ErrorCode: string | null;
}

export interface MutationHistoryInput {
  budgetId: number;
  spaceId?: string | null;
  mutationId: string;
  userId?: string | null;
  op: string;
  payload: Record<string, unknown>;
  origin: MutationOrigin;
  undoOps?: OpCall[] | null;
  redoOps?: OpCall[] | null;
  status?: MutationStatus;
  errorMessage?: string | null;
  errorCode?: MutationErrorCode | null;
}

export interface MutationHistoryListOptions {
  limit?: number;
  offset?: number;
  includeUndone?: boolean;
}

export interface ParsedMutationHistoryEntry {
  id: number;
  budgetId: number;
  spaceId: string | null;
  mutationId: string;
  timestamp: string;
  userId: string | null;
  op: string;
  payload: Record<string, unknown>;
  origin: MutationOrigin;
  undoOps: OpCall[] | null;
  redoOps: OpCall[] | null;
  undoneAt: string | null;
  canUndo: boolean;
  status: MutationStatus;
  errorMessage: string | null;
  errorCode: string | null;
}
