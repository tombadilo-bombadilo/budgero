import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, run } from '../../database/sql.js';
import type { DuplicateHintSettings } from '../transactions/types.js';

export const DUPLICATE_HINT_DEFAULTS: DuplicateHintSettings = {
  enabled: true,
  toleranceBps: 100,
  dayWindow: 7,
};

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

  /**
   * Whether the add-transaction form pre-fills the category from the payee's
   * last transaction. Defaults to true — including for rows written before the
   * column existed, where SQLite backfills the column default.
   */
  getSuggestCategoryFromPayee(): boolean {
    this.ensureRow();
    const row = getRow<{ SuggestCategoryFromPayee: boolean | number | null }>(
      this.db,
      `SELECT SuggestCategoryFromPayee FROM user_meta WHERE ID = 1`
    );
    if (!row || row.SuggestCategoryFromPayee == null) return true;
    return row.SuggestCategoryFromPayee === true || row.SuggestCategoryFromPayee === 1;
  }

  setSuggestCategoryFromPayee(value: boolean): void {
    this.ensureRow();
    run(this.db, `UPDATE user_meta SET SuggestCategoryFromPayee = ? WHERE ID = 1`, value ? 1 : 0);
  }

  /** Show each category group's share of the month's total assigned. Off by default. */
  getShowGroupPercent(): boolean {
    this.ensureRow();
    const row = getRow<{ ShowGroupPercent: boolean | number | null }>(
      this.db,
      `SELECT ShowGroupPercent FROM user_meta WHERE ID = 1`
    );
    if (!row || row.ShowGroupPercent == null) return false;
    return row.ShowGroupPercent === true || row.ShowGroupPercent === 1;
  }

  setShowGroupPercent(value: boolean): void {
    this.ensureRow();
    run(this.db, `UPDATE user_meta SET ShowGroupPercent = ? WHERE ID = 1`, value ? 1 : 0);
  }

  /** Animate amount changes on the Planning page. Off by default. */
  getPlanningNumberAnimations(): boolean {
    this.ensureRow();
    const row = getRow<{ PlanningNumberAnimations: boolean | number | null }>(
      this.db,
      `SELECT PlanningNumberAnimations FROM user_meta WHERE ID = 1`
    );
    if (!row || row.PlanningNumberAnimations == null) return false;
    return row.PlanningNumberAnimations === true || row.PlanningNumberAnimations === 1;
  }

  setPlanningNumberAnimations(value: boolean): void {
    this.ensureRow();
    run(this.db, `UPDATE user_meta SET PlanningNumberAnimations = ? WHERE ID = 1`, value ? 1 : 0);
  }

  /** Blur the page behind open dialogs. On by default for existing installs. */
  getDialogBackgroundBlur(): boolean {
    this.ensureRow();
    const row = getRow<{ DialogBackgroundBlur: boolean | number | null }>(
      this.db,
      `SELECT DialogBackgroundBlur FROM user_meta WHERE ID = 1`
    );
    if (!row || row.DialogBackgroundBlur == null) return true;
    return row.DialogBackgroundBlur === true || row.DialogBackgroundBlur === 1;
  }

  setDialogBackgroundBlur(value: boolean): void {
    this.ensureRow();
    run(this.db, `UPDATE user_meta SET DialogBackgroundBlur = ? WHERE ID = 1`, value ? 1 : 0);
  }

  /** Show zero transaction amounts as empty cells. Off by default. */
  getHideZeroAmounts(): boolean {
    this.ensureRow();
    const row = getRow<{ HideZeroAmounts: boolean | number | null }>(
      this.db,
      `SELECT HideZeroAmounts FROM user_meta WHERE ID = 1`
    );
    return row?.HideZeroAmounts === true || row?.HideZeroAmounts === 1;
  }

  setHideZeroAmounts(value: boolean): void {
    this.ensureRow();
    run(this.db, `UPDATE user_meta SET HideZeroAmounts = ? WHERE ID = 1`, value ? 1 : 0);
  }

  /** Add transactions in an inline register row instead of the dialog. Off by default. */
  getInlineTransactionEntry(): boolean {
    this.ensureRow();
    const row = getRow<{ InlineTransactionEntry: boolean | number | null }>(
      this.db,
      `SELECT InlineTransactionEntry FROM user_meta WHERE ID = 1`
    );
    return row?.InlineTransactionEntry === true || row?.InlineTransactionEntry === 1;
  }

  setInlineTransactionEntry(value: boolean): void {
    this.ensureRow();
    run(this.db, `UPDATE user_meta SET InlineTransactionEntry = ? WHERE ID = 1`, value ? 1 : 0);
  }

  /** First calendar weekday: Sunday (0) or Monday (1). */
  getWeekStartsOn(): 0 | 1 {
    this.ensureRow();
    const row = getRow<{ WeekStartsOn: number }>(
      this.db,
      `SELECT WeekStartsOn FROM user_meta WHERE ID = 1`
    );
    return row?.WeekStartsOn === 1 ? 1 : 0;
  }

  setWeekStartsOn(value: 0 | 1): void {
    if (value !== 0 && value !== 1) throw new Error('Week start must be Sunday or Monday');
    this.ensureRow();
    run(this.db, `UPDATE user_meta SET WeekStartsOn = ? WHERE ID = 1`, value);
  }

  /** Possible-duplicate hint while adding transactions. On, 1%, ±7 days by default. */
  getDuplicateHintSettings(): DuplicateHintSettings {
    this.ensureRow();
    const row = getRow<{
      DuplicateHintsEnabled: number | null;
      DuplicateAmountToleranceBps: number | null;
      DuplicateDayWindow: number | null;
    }>(
      this.db,
      `SELECT DuplicateHintsEnabled, DuplicateAmountToleranceBps, DuplicateDayWindow
         FROM user_meta WHERE ID = 1`
    );
    return {
      enabled: row?.DuplicateHintsEnabled == null ? true : Boolean(row.DuplicateHintsEnabled),
      toleranceBps: row?.DuplicateAmountToleranceBps ?? DUPLICATE_HINT_DEFAULTS.toleranceBps,
      dayWindow: row?.DuplicateDayWindow ?? DUPLICATE_HINT_DEFAULTS.dayWindow,
    };
  }

  setDuplicateHintSettings(patch: Partial<DuplicateHintSettings>): void {
    const next = { ...this.getDuplicateHintSettings(), ...patch };
    if (typeof next.enabled !== 'boolean') throw new Error('Duplicate hints must be on or off');
    if (!Number.isInteger(next.toleranceBps) || next.toleranceBps < 0 || next.toleranceBps > 1000) {
      throw new Error('Duplicate amount tolerance must be between 0% and 10%');
    }
    if (!Number.isInteger(next.dayWindow) || next.dayWindow < 1 || next.dayWindow > 31) {
      throw new Error('Duplicate date range must be between 1 and 31 days');
    }
    run(
      this.db,
      `UPDATE user_meta
          SET DuplicateHintsEnabled = ?, DuplicateAmountToleranceBps = ?, DuplicateDayWindow = ?
        WHERE ID = 1`,
      next.enabled ? 1 : 0,
      next.toleranceBps,
      next.dayWindow
    );
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

  /** Days of daily currency rates kept in the local cache (synced blob size). */
  getRateCacheRetentionDays(): number {
    this.ensureRow();
    const row = getRow<{ RateCacheRetentionDays: number | null }>(
      this.db,
      `SELECT RateCacheRetentionDays FROM user_meta WHERE ID = 1`
    );
    const days = row?.RateCacheRetentionDays;
    return typeof days === 'number' && days > 0 ? days : 30;
  }

  setRateCacheRetentionDays(days: number): void {
    this.ensureRow();
    const normalized = Math.max(1, Math.floor(days));
    run(this.db, `UPDATE user_meta SET RateCacheRetentionDays = ? WHERE ID = 1`, normalized);
  }

  /** Whether offline-entered rates re-resolve to official ones on reconnect. */
  getResyncRatesOnReconnect(): boolean {
    this.ensureRow();
    const row = getRow<{ ResyncRatesOnReconnect: boolean | number | null }>(
      this.db,
      `SELECT ResyncRatesOnReconnect FROM user_meta WHERE ID = 1`
    );
    if (!row || row.ResyncRatesOnReconnect == null) return true;
    return row.ResyncRatesOnReconnect === true || row.ResyncRatesOnReconnect === 1;
  }

  setResyncRatesOnReconnect(value: boolean): void {
    this.ensureRow();
    run(this.db, `UPDATE user_meta SET ResyncRatesOnReconnect = ? WHERE ID = 1`, value ? 1 : 0);
  }
}
