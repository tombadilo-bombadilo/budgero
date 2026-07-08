import { DatabaseAdapter } from '../../database/interface.js';
import { UserMetaQueries, type UserMetaRow } from './queries.js';

export class UserMetaService {
  private queries: UserMetaQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new UserMetaQueries(db);
  }

  getMeta(): UserMetaRow {
    return this.queries.getMeta();
  }

  setLastUserBackup(timestamp: string): void {
    this.queries.setLastBackup(timestamp);
  }

  setBackupReminderDays(days: number): void {
    this.queries.setReminderDays(days);
  }

  getAllowOverAssignment(): boolean {
    return this.queries.getAllowOverAssignment();
  }

  setAllowOverAssignment(value: boolean): void {
    this.queries.setAllowOverAssignment(value);
  }
}
