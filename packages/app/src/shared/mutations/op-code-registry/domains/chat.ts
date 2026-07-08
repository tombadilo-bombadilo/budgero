import type { ChatSettingsInput, CreateMessageInput } from '@budgero/core/browser';
import { S, type OpCodeEntry } from '../shared';

const CHAT_CONVERSATION_INVALIDATIONS: string[][] = [
  ['chatConversations', '*'],
  ['chatConversation', '*'],
];

const CHAT_MESSAGE_INVALIDATIONS: string[][] = [
  ['chatMessages', '*'],
  ['chatConversations', '*'],
  ['chatConversation', '*'],
];

export const chatOps = {
  'chat.createConversation': {
    execute: async (args) => {
      return await S().chat!.createConversation(
        args.budgetId as number,
        args.title as string | undefined
      );
    },
    invalidates: CHAT_CONVERSATION_INVALIDATIONS,
  },
  'chat.updateConversationTitle': {
    execute: async (args) => {
      await S().chat!.updateConversationTitle(args.conversationId as number, args.title as string);
      return { success: true };
    },
    invalidates: CHAT_CONVERSATION_INVALIDATIONS,
  },
  'chat.archiveConversation': {
    execute: async (args) => {
      await S().chat!.archiveConversation(args.conversationId as number);
      return { success: true };
    },
    invalidates: [...CHAT_CONVERSATION_INVALIDATIONS, ['chatMessages', '*']],
  },
  'chat.deleteConversation': {
    execute: async (args) => {
      await S().chat!.deleteConversation(args.conversationId as number);
      return { success: true };
    },
    invalidates: [...CHAT_CONVERSATION_INVALIDATIONS, ['chatMessages', '*']],
  },
  'chat.addMessage': {
    execute: async (args) => {
      return await S().chat!.addMessage(args.input as CreateMessageInput);
    },
    invalidates: CHAT_MESSAGE_INVALIDATIONS,
  },
  'chat.deleteMessage': {
    execute: async (args) => {
      await S().chat!.deleteMessage(args.messageId as number);
      return { success: true };
    },
    invalidates: CHAT_MESSAGE_INVALIDATIONS,
  },
  'chat.updateSettings': {
    execute: async (args) => {
      return await S().chat!.updateSettings(
        args.budgetId as number,
        args.input as ChatSettingsInput
      );
    },
    invalidates: [['chatSettings', '*']],
  },
} satisfies Record<string, OpCodeEntry>;
