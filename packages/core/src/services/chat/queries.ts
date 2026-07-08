import type { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import type {
  ChatConversation,
  ChatMessage,
  ChatSettings,
  ChatSettingsInput,
  CreateMessageInput,
  CreateConversationInput,
} from './types.js';

interface ConversationRow {
  ID: number;
  BudgetID: number;
  Title: string;
  CreatedAt: string;
  UpdatedAt: string;
  ArchivedAt: string | null;
}

interface MessageRow {
  ID: number;
  ConversationID: number;
  BudgetID: number;
  Role: string;
  Content: string;
  ToolCallsJSON: string | null;
  ToolResultJSON: string | null;
  CreatedAt: string;
}

interface SettingsRow {
  ID: number;
  BudgetID: number;
  ExecutionMode: string;
  VoiceInputEnabled: number;
  ShowBubble: number;
  ContextMonths: number;
  SpeechModel: string | null;
  EnabledTools: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

/** Parse the EnabledTools JSON column. Returns null (= all enabled) on absent/invalid. */
function parseEnabledTools(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : null;
  } catch {
    return null;
  }
}

/** Serialize EnabledTools to its JSON column value. null (= all enabled) stays null; [] is valid. */
function serializeEnabledTools(tools: string[] | null): string | null {
  return tools === null ? null : JSON.stringify(tools);
}

function mapMessageRow(row: MessageRow): ChatMessage {
  return {
    ID: row.ID,
    ConversationID: row.ConversationID,
    BudgetID: row.BudgetID,
    Role: row.Role as ChatMessage['Role'],
    Content: row.Content,
    ToolCallsJSON: row.ToolCallsJSON,
    ToolResultJSON: row.ToolResultJSON,
    CreatedAt: row.CreatedAt,
  };
}

/**
 * ChatQueries - All SQL queries for chat conversations, messages and settings
 */
export class ChatQueries {
  constructor(private db: DatabaseAdapter) {}

  // ============ Conversations ============

  createConversation(input: CreateConversationInput): ChatConversation {
    const result = run(
      this.db,
      `
      INSERT INTO chat_conversations (BudgetID, Title)
      VALUES (?, ?)
    `,
      input.budgetId,
      input.title ?? 'New Conversation'
    );

    const conversation = this.getConversation(Number(result.lastInsertRowid));
    if (!conversation) {
      throw new Error('Failed to create conversation');
    }
    return conversation;
  }

  getConversation(conversationId: number): ChatConversation | null {
    const row = getRow<ConversationRow>(
      this.db,
      `
      SELECT ID, BudgetID, Title, CreatedAt, UpdatedAt, ArchivedAt
      FROM chat_conversations
      WHERE ID = ?
    `,
      conversationId
    );

    if (!row) return null;

    return {
      ID: row.ID,
      BudgetID: row.BudgetID,
      Title: row.Title,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt,
      ArchivedAt: row.ArchivedAt,
    };
  }

  getConversations(budgetId: number, limit = 50): ChatConversation[] {
    const rows = allRows<ConversationRow>(
      this.db,
      `
      SELECT ID, BudgetID, Title, CreatedAt, UpdatedAt, ArchivedAt
      FROM chat_conversations
      WHERE BudgetID = ? AND ArchivedAt IS NULL
      ORDER BY UpdatedAt DESC
      LIMIT ?
    `,
      budgetId,
      limit
    );

    return rows.map((row) => ({
      ID: row.ID,
      BudgetID: row.BudgetID,
      Title: row.Title,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt,
      ArchivedAt: row.ArchivedAt,
    }));
  }

  updateConversationTitle(conversationId: number, title: string): void {
    run(
      this.db,
      `
      UPDATE chat_conversations
      SET Title = ?, UpdatedAt = datetime('now')
      WHERE ID = ?
    `,
      title,
      conversationId
    );
  }

  private touchConversation(conversationId: number): void {
    run(
      this.db,
      `
      UPDATE chat_conversations
      SET UpdatedAt = datetime('now')
      WHERE ID = ?
    `,
      conversationId
    );
  }

  archiveConversation(conversationId: number): void {
    run(
      this.db,
      `
      UPDATE chat_conversations
      SET ArchivedAt = datetime('now'), UpdatedAt = datetime('now')
      WHERE ID = ?
    `,
      conversationId
    );
  }

  deleteConversation(conversationId: number): void {
    // Messages are deleted via CASCADE
    run(this.db, `DELETE FROM chat_conversations WHERE ID = ?`, conversationId);
  }

  // ============ Messages ============

  addMessage(input: CreateMessageInput): ChatMessage {
    const result = run(
      this.db,
      `
      INSERT INTO chat_messages (ConversationID, BudgetID, Role, Content, ToolCallsJSON, ToolResultJSON)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      input.conversationId,
      input.budgetId,
      input.role,
      input.content,
      input.toolCalls ? JSON.stringify(input.toolCalls) : null,
      input.toolResult ? JSON.stringify(input.toolResult) : null
    );

    this.touchConversation(input.conversationId);

    const message = this.getMessage(Number(result.lastInsertRowid));
    if (!message) {
      throw new Error('Failed to create message');
    }
    return message;
  }

  getMessage(messageId: number): ChatMessage | null {
    const row = getRow<MessageRow>(
      this.db,
      `
      SELECT ID, ConversationID, BudgetID, Role, Content, ToolCallsJSON, ToolResultJSON, CreatedAt
      FROM chat_messages
      WHERE ID = ?
    `,
      messageId
    );

    if (!row) return null;

    return mapMessageRow(row);
  }

  getMessages(conversationId: number): ChatMessage[] {
    const rows = allRows<MessageRow>(
      this.db,
      `
      SELECT ID, ConversationID, BudgetID, Role, Content, ToolCallsJSON, ToolResultJSON, CreatedAt
      FROM chat_messages
      WHERE ConversationID = ?
      ORDER BY CreatedAt ASC
    `,
      conversationId
    );

    return rows.map(mapMessageRow);
  }

  getRecentMessages(conversationId: number, limit = 20): ChatMessage[] {
    const rows = allRows<MessageRow>(
      this.db,
      `
      SELECT ID, ConversationID, BudgetID, Role, Content, ToolCallsJSON, ToolResultJSON, CreatedAt
      FROM chat_messages
      WHERE ConversationID = ?
      ORDER BY CreatedAt DESC
      LIMIT ?
    `,
      conversationId,
      limit
    );

    // Reverse to get chronological order
    return rows.map(mapMessageRow).reverse();
  }

  deleteMessage(messageId: number): void {
    run(this.db, `DELETE FROM chat_messages WHERE ID = ?`, messageId);
  }

  // ============ Settings ============

  getChatSettings(budgetId: number): ChatSettings | null {
    const row = getRow<SettingsRow>(
      this.db,
      `
      SELECT ID, BudgetID, ExecutionMode, VoiceInputEnabled, ShowBubble, ContextMonths, SpeechModel, EnabledTools, CreatedAt, UpdatedAt
      FROM chat_settings
      WHERE BudgetID = ?
    `,
      budgetId
    );

    if (!row) return null;

    return {
      ID: row.ID,
      BudgetID: row.BudgetID,
      ExecutionMode: row.ExecutionMode as ChatSettings['ExecutionMode'],
      VoiceInputEnabled: Boolean(row.VoiceInputEnabled),
      ShowBubble: Boolean(row.ShowBubble),
      ContextMonths: row.ContextMonths,
      SpeechModel: (row.SpeechModel || 'base') as ChatSettings['SpeechModel'],
      EnabledTools: parseEnabledTools(row.EnabledTools),
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt,
    };
  }

  upsertChatSettings(budgetId: number, input: ChatSettingsInput): ChatSettings {
    const existing = this.getChatSettings(budgetId);

    if (existing) {
      run(
        this.db,
        `
        UPDATE chat_settings
        SET ExecutionMode = ?,
            VoiceInputEnabled = ?,
            ShowBubble = ?,
            ContextMonths = ?,
            SpeechModel = ?,
            EnabledTools = ?,
            UpdatedAt = datetime('now')
        WHERE BudgetID = ?
      `,
        input.ExecutionMode ?? existing.ExecutionMode,
        input.VoiceInputEnabled !== undefined
          ? input.VoiceInputEnabled
            ? 1
            : 0
          : existing.VoiceInputEnabled
            ? 1
            : 0,
        input.ShowBubble !== undefined ? (input.ShowBubble ? 1 : 0) : existing.ShowBubble ? 1 : 0,
        input.ContextMonths ?? existing.ContextMonths,
        input.SpeechModel ?? existing.SpeechModel,
        serializeEnabledTools(
          input.EnabledTools !== undefined ? input.EnabledTools : existing.EnabledTools
        ),
        budgetId
      );
    } else {
      run(
        this.db,
        `
        INSERT INTO chat_settings (BudgetID, ExecutionMode, VoiceInputEnabled, ShowBubble, ContextMonths, SpeechModel, EnabledTools)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        budgetId,
        input.ExecutionMode ?? 'confirm',
        input.VoiceInputEnabled !== undefined ? (input.VoiceInputEnabled ? 1 : 0) : 1,
        input.ShowBubble !== undefined ? (input.ShowBubble ? 1 : 0) : 1,
        input.ContextMonths ?? 3,
        input.SpeechModel ?? 'base',
        serializeEnabledTools(input.EnabledTools ?? null)
      );
    }

    const settings = this.getChatSettings(budgetId);
    if (!settings) {
      throw new Error('Failed to upsert chat settings');
    }
    return settings;
  }

  deleteChatSettings(budgetId: number): void {
    run(this.db, `DELETE FROM chat_settings WHERE BudgetID = ?`, budgetId);
  }
}
