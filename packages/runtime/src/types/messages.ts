/**
 * WebSocket message types for sync protocol.
 */

export interface WsMessage {
  type: string;
  spaceId?: string;
  mutationId?: string;
  /** On mutation_ack the server reuses this field to carry the mutation ID. */
  hash?: string;
  version?: number;
  /** sync_state_changed: blob was written by an out-of-band bulk change
   * (import/restore) whose content is NOT in the mutation log. */
  out_of_band?: boolean;
  latestVersion?: number;
  nextSinceVersion?: number;
  hasMore?: boolean;
  success?: boolean;
  new_version?: number;
  error?: string;
  payload?: {
    op?: string;
    args?: string | Record<string, unknown>;
    encryptedPayload?: string;
  };
  mutations?: WsCatchUpMutation[];
}

export interface WsCatchUpMutation {
  id?: string;
  version?: number;
  op?: string;
  args?: string | Record<string, unknown>;
  encryptedPayload?: string;
}
