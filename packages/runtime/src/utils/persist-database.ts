import type { WebDatabaseInstance } from '../types';

/**
 * Persist a database via `saveToOPFSPublic`, falling back to `forceSave`.
 * Returns false when the active adapter supports neither; errors propagate
 * so callers can apply their own logging/recovery.
 */
export async function persistDatabase(db: WebDatabaseInstance): Promise<boolean> {
  if (db.saveToOPFSPublic) {
    await db.saveToOPFSPublic();
    return true;
  }
  if (db.forceSave) {
    await db.forceSave();
    return true;
  }
  return false;
}
