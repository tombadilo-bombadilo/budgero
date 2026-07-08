/**
 * Local persistence cipher factory.
 * Builds a cipher for encrypting/decrypting database files stored in OPFS.
 */

import { compressAndEncryptDatabase, decryptAndDecompressDatabase } from './database-crypto';
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
    async encrypt(data: Uint8Array): Promise<Uint8Array> {
      const { encrypted } = await compressAndEncryptDatabase(data, masterPassword);
      return encrypted;
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
