/**
 * Local persistence cipher factory.
 * Builds a cipher for encrypting/decrypting database files stored in OPFS.
 */

import { decryptAndDecompressDatabase } from './database-crypto';
import { encryptEnvelope } from './envelope';
import { logRuntime } from '../logging';
import { errorMessage } from '../utils/diagnostics';

const SQLITE_HEADER = new Uint8Array(
  Array.from('SQLite format 3\u0000').map((char) => char.charCodeAt(0))
);

function isLikelySqliteDatabase(data: Uint8Array): boolean {
  if (!data || data.length < SQLITE_HEADER.length) {
    return false;
  }
  for (let i = 0; i < SQLITE_HEADER.length; i++) {
    if (data[i] !== SQLITE_HEADER[i]) {
      return false;
    }
  }
  return true;
}

/**
 * NOTE: this interface is intentionally duplicated as `LocalPersistenceCipher`
 * in `@budgero/core` (`core/src/database/interface.ts`) — runtime must not
 * depend on core, so keep both declarations shape-identical when changing it.
 */
export interface LocalPersistenceCipher {
  encrypt(data: Uint8Array): Promise<Uint8Array>;
  decrypt(data: Uint8Array): Promise<{ decrypted: Uint8Array; wasEncrypted: boolean }>;
}

/**
 * Builds a cipher implementation for local persistence based on the master password.
 */
export function createLocalPersistenceCipher(masterPassword: string): LocalPersistenceCipher {
  return {
    // The local copy is NOT LZ4-compressed: lz4js runs in JS on the main
    // thread and cost ~90% of every persist (~150-190 ms at 50k rows), paid
    // after every mutation. Only the server blob upload compresses. decrypt()
    // still reads older compressed copies: decryptAndDecompressDatabase falls
    // back to the raw bytes when the plaintext has no LZ4 frame magic, and a
    // SQLite file always starts with "SQLite format 3\0", never that magic.
    async encrypt(data: Uint8Array): Promise<Uint8Array> {
      return encryptEnvelope(data, masterPassword);
    },

    async decrypt(data: Uint8Array): Promise<{ decrypted: Uint8Array; wasEncrypted: boolean }> {
      try {
        const { decrypted } = await decryptAndDecompressDatabase(data, masterPassword);
        return { decrypted, wasEncrypted: true };
      } catch (error) {
        if (isLikelySqliteDatabase(data)) {
          logRuntime(
            'warn',
            'LocalPersistenceCipher',
            'Decrypt failed; assuming plaintext SQLite payload',
            { error: errorMessage(error) }
          );
          return { decrypted: data, wasEncrypted: false };
        }
        logRuntime(
          'warn',
          'LocalPersistenceCipher',
          'Decrypt failed; encrypted payload cannot be unlocked',
          { error: errorMessage(error) }
        );
        throw new Error('Decryption failed: invalid master password or corrupted data', {
          cause: error instanceof Error ? error : undefined,
        });
      }
    },
  };
}
