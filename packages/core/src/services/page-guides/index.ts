import { DatabaseAdapter } from '../../database/interface.js';
import { allRows, atomically, run } from '../../database/sql.js';

/** Longest guide id accepted; ids are short slugs like 'budget'. */
const MAX_GUIDE_ID_LENGTH = 64;

/**
 * Page guides each member of the workspace has seen (table page_guides_seen).
 * Keyed by the member's user id, so members of a shared workspace keep their
 * own list. Marks only ever add rows, so marks from several devices merge.
 * Guide ids are not checked against a fixed list: a newer build may add guides.
 */
export class PageGuidesService {
  constructor(private db: DatabaseAdapter) {}

  getSeen(userId: string): string[] {
    if (!userId) return [];
    return allRows<{ GuideID: string }>(
      this.db,
      `SELECT GuideID FROM page_guides_seen WHERE UserID = ? ORDER BY GuideID`,
      userId
    ).map((row) => row.GuideID);
  }

  /** Records guides as seen; returns the ones that weren't recorded yet. */
  markSeen(userId: string, guideIds: readonly string[]): string[] {
    if (typeof userId !== 'string' || userId === '') throw new Error('User id is required');
    if (!Array.isArray(guideIds)) throw new Error('Guide ids must be a list');
    const ids = [...new Set(guideIds)];
    for (const id of ids) {
      if (typeof id !== 'string' || id === '' || id.length > MAX_GUIDE_ID_LENGTH) {
        throw new Error('Invalid guide id');
      }
    }
    return atomically(this.db, () => {
      const known = new Set(this.getSeen(userId));
      const added = ids.filter((id) => !known.has(id));
      for (const id of added) {
        run(
          this.db,
          `INSERT OR IGNORE INTO page_guides_seen (UserID, GuideID) VALUES (?, ?)`,
          userId,
          id
        );
      }
      return added;
    });
  }
}
