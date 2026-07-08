import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration022: Migration = {
  version: 22,
  description: 'Add chat tables for AI assistant conversations',
  up: `
      -- Chat conversations table
      CREATE TABLE IF NOT EXISTS chat_conversations (
        ID              INTEGER PRIMARY KEY AUTOINCREMENT,
        BudgetID        INTEGER NOT NULL,
        Title           TEXT NOT NULL DEFAULT 'New Conversation',
        CreatedAt       TEXT NOT NULL DEFAULT (datetime('now')),
        UpdatedAt       TEXT NOT NULL DEFAULT (datetime('now')),
        ArchivedAt      TEXT DEFAULT NULL,
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chat_conversations_budget ON chat_conversations(BudgetID, CreatedAt DESC);

      -- Chat messages table
      CREATE TABLE IF NOT EXISTS chat_messages (
        ID              INTEGER PRIMARY KEY AUTOINCREMENT,
        ConversationID  INTEGER NOT NULL,
        BudgetID        INTEGER NOT NULL,
        Role            TEXT NOT NULL CHECK(Role IN ('user', 'assistant', 'system', 'tool')),
        Content         TEXT NOT NULL,
        ToolCallsJSON   TEXT DEFAULT NULL,
        ToolResultJSON  TEXT DEFAULT NULL,
        CreatedAt       TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (ConversationID) REFERENCES chat_conversations(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(ConversationID, CreatedAt ASC);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_budget ON chat_messages(BudgetID);

      -- Chat settings table
      CREATE TABLE IF NOT EXISTS chat_settings (
        ID                  INTEGER PRIMARY KEY AUTOINCREMENT,
        BudgetID            INTEGER NOT NULL UNIQUE,
        ExecutionMode       TEXT NOT NULL DEFAULT 'confirm' CHECK(ExecutionMode IN ('confirm', 'auto')),
        VoiceInputEnabled   BOOLEAN NOT NULL DEFAULT 1,
        ShowBubble          BOOLEAN NOT NULL DEFAULT 1,
        ContextMonths       INTEGER NOT NULL DEFAULT 3,
        CreatedAt           TEXT NOT NULL DEFAULT (datetime('now')),
        UpdatedAt           TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chat_settings_budget ON chat_settings(BudgetID);
    `,
  verify: (db: MigrationDatabase) => {
    try {
      const conversations = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='chat_conversations'`
      );
      const messages = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'`
      );
      const settings = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='chat_settings'`
      );
      return Boolean(
        conversations?.length &&
          conversations[0]?.values?.length &&
          messages?.length &&
          messages[0]?.values?.length &&
          settings?.length &&
          settings[0]?.values?.length
      );
    } catch (error) {
      debugLog('[Migration 22] verification failed', { error });
      return false;
    }
  },
};
