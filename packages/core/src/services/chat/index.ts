import type { DatabaseAdapter } from '../../database/interface.js';
import { ChatQueries } from './queries.js';
import type {
  ChatConversation,
  ChatMessage,
  ChatSettings,
  ChatSettingsInput,
  CreateMessageInput,
} from './types.js';

export * from './types.js';

export class ChatService {
  private queries: ChatQueries;

  constructor(db: DatabaseAdapter) {
    this.queries = new ChatQueries(db);
  }

  // ============ Conversations ============

  createConversation(budgetId: number, title?: string): ChatConversation {
    return this.queries.createConversation({ budgetId, title });
  }

  getConversation(conversationId: number): ChatConversation | null {
    return this.queries.getConversation(conversationId);
  }

  getConversations(budgetId: number, limit?: number): ChatConversation[] {
    return this.queries.getConversations(budgetId, limit);
  }

  updateConversationTitle(conversationId: number, title: string): void {
    this.queries.updateConversationTitle(conversationId, title);
  }

  archiveConversation(conversationId: number): void {
    this.queries.archiveConversation(conversationId);
  }

  deleteConversation(conversationId: number): void {
    this.queries.deleteConversation(conversationId);
  }

  // ============ Messages ============

  addMessage(input: CreateMessageInput): ChatMessage {
    return this.queries.addMessage(input);
  }

  getMessage(messageId: number): ChatMessage | null {
    return this.queries.getMessage(messageId);
  }

  getMessages(conversationId: number): ChatMessage[] {
    return this.queries.getMessages(conversationId);
  }

  getRecentMessages(conversationId: number, limit?: number): ChatMessage[] {
    return this.queries.getRecentMessages(conversationId, limit);
  }

  deleteMessage(messageId: number): void {
    this.queries.deleteMessage(messageId);
  }

  // ============ Settings ============

  getSettings(budgetId: number): ChatSettings | null {
    return this.queries.getChatSettings(budgetId);
  }

  updateSettings(budgetId: number, input: ChatSettingsInput): ChatSettings {
    return this.queries.upsertChatSettings(budgetId, input);
  }

  deleteSettings(budgetId: number): void {
    this.queries.deleteChatSettings(budgetId);
  }

  getDefaultSettings(): Omit<ChatSettings, 'ID' | 'BudgetID' | 'CreatedAt' | 'UpdatedAt'> {
    return {
      ExecutionMode: 'confirm',
      VoiceInputEnabled: true,
      ShowBubble: true,
      ContextMonths: 3,
      SpeechModel: 'base',
      EnabledTools: null,
    };
  }
}
