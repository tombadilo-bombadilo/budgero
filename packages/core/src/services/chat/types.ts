export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';
export type ExecutionMode = 'confirm' | 'auto';
export type SpeechModel = 'tiny' | 'base' | 'small';

export interface ChatConversation {
  ID: number;
  BudgetID: number;
  Title: string;
  CreatedAt: string;
  UpdatedAt: string;
  ArchivedAt: string | null;
}

export interface ChatMessage {
  ID: number;
  ConversationID: number;
  BudgetID: number;
  Role: ChatRole;
  Content: string;
  ToolCallsJSON: string | null;
  ToolResultJSON: string | null;
  CreatedAt: string;
}

export interface ChatSettings {
  ID: number;
  BudgetID: number;
  ExecutionMode: ExecutionMode;
  VoiceInputEnabled: boolean;
  ShowBubble: boolean;
  ContextMonths: number;
  SpeechModel: SpeechModel;
  /** Enabled chat tool keys. null means "all tools enabled" (not yet configured). */
  EnabledTools: string[] | null;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface ChatSettingsInput {
  ExecutionMode?: ExecutionMode;
  VoiceInputEnabled?: boolean;
  ShowBubble?: boolean;
  ContextMonths?: number;
  SpeechModel?: SpeechModel;
  EnabledTools?: string[] | null;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface CreateMessageInput {
  conversationId: number;
  budgetId: number;
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
}

export interface CreateConversationInput {
  budgetId: number;
  title?: string;
}
