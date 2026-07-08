import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration024: Migration = {
  version: 24,
  description: 'Add SpeechModel column to chat_settings for Whisper model selection',
  up: (db: MigrationDatabase) => {
    try {
      db.exec(`ALTER TABLE chat_settings ADD COLUMN SpeechModel TEXT NOT NULL DEFAULT 'base'`);
    } catch (error) {
      debugLog('[Migration 24] statement failed (may already exist)', { error });
    }
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(chat_settings)`);
      if (!info || info.length === 0) return false;
      const columns = info[0].values.map((row: unknown[]) => row[1]);
      return columns.includes('SpeechModel');
    } catch (error) {
      debugLog('[Migration 24] verification failed', { error });
      return false;
    }
  },
};
