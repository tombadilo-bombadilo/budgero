import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, run } from '../../database/sql.js';

export type UserMetaRow = {
  ID: number;
  LastUserBackup: string | null;
  BackupReminderDays: number;
  AllowOverAssignment: boolean;
};

export class UserMetaQueries {
  constructor(private db: DatabaseAdapter) {}

  ensureRow(): void {
    run(
      this.db,
      `
      INSERT OR IGNORE INTO user_meta (ID, LastUserBackup, BackupReminderDays, AllowOverAssignment)
      VALUES (1, NULL, 7, 0)
    `
    );
  }

  getMeta(): UserMetaRow {
    this.ensureRow();
    const row = getRow<UserMetaRow>(
      this.db,
      `SELECT ID, LastUserBackup, BackupReminderDays, AllowOverAssignment FROM user_meta WHERE ID = 1`
    );
    return (
      row ?? {
        ID: 1,
        LastUserBackup: null,
        BackupReminderDays: 7,
        AllowOverAssignment: false,
      }
    );
  }

  getAllowOverAssignment(): boolean {
    this.ensureRow();
    const row = getRow<{ AllowOverAssignment: boolean | number }>(
      this.db,
      `SELECT AllowOverAssignment FROM user_meta WHERE ID = 1`
    );
    if (!row) return false;
    // SQLite returns booleans as 0/1 integers
    return row.AllowOverAssignment === true || row.AllowOverAssignment === 1;
  }

  setAllowOverAssignment(value: boolean): void {
    this.ensureRow();
    run(this.db, `UPDATE user_meta SET AllowOverAssignment = ? WHERE ID = 1`, value ? 1 : 0);
  }

  setLastBackup(timestamp: string): void {
    this.ensureRow();
    run(
      this.db,
      `UPDATE user_meta SET LastUserBackup = ?, BackupReminderDays = COALESCE(BackupReminderDays, 7) WHERE ID = 1`,
      timestamp
    );
  }

  setReminderDays(days: number): void {
    this.ensureRow();
    const normalized = Math.max(0, Math.floor(days));
    run(this.db, `UPDATE user_meta SET BackupReminderDays = ? WHERE ID = 1`, normalized);
  }
}
