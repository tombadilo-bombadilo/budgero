import { useQuery, useMutation } from '@tanstack/react-query';
import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import type {
  ChatConversation,
  ChatMessage,
  ChatSettings,
  ChatSettingsInput,
  CreateMessageInput,
} from '@budgero/core/browser';

export function useChatConversations(budgetId: number | null | undefined) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  const normalizedBudgetId = typeof budgetId === 'number' ? budgetId : null;
  const enabled = Boolean(spaceId) && Boolean(normalizedBudgetId && normalizedBudgetId > 0);

  return useQuery<ChatConversation[]>({
    queryKey: ['chatConversations', spaceKey, normalizedBudgetId],
    enabled,
    staleTime: 30 * 1000,
    queryFn: async () => {
      if (!spaceId || !normalizedBudgetId) return [];
      const services = runtime.services();
      return services.chat.getConversations(normalizedBudgetId);
    },
  });
}

export function useCreateConversation() {
  const runtime = useRuntime();

  return useMutation<ChatConversation, Error, { budgetId: number; title?: string }>({
    mutationFn: async ({ budgetId, title }) => {
      const { result } = await runtime.mutationsRouter().execute<ChatConversation>({
        op: 'chat.createConversation',
        payload: { budgetId, title },
        meta: { label: 'chat.createConversation' },
      });
      return result;
    },
    onError: (error, variables) => {
      console.error('[useCreateConversation] Failed:', { error, budgetId: variables.budgetId });
    },
  });
}

export function useUpdateConversationTitle() {
  const runtime = useRuntime();

  return useMutation<void, Error, { conversationId: number; title: string }>({
    mutationFn: async ({ conversationId, title }) => {
      await runtime.mutationsRouter().execute<void>({
        op: 'chat.updateConversationTitle',
        payload: { conversationId, title },
        meta: { label: 'chat.updateConversationTitle' },
      });
    },
  });
}

export function useDeleteConversation() {
  const runtime = useRuntime();

  return useMutation<void, Error, { conversationId: number; budgetId: number }>({
    mutationFn: async ({ conversationId, budgetId }) => {
      await runtime.mutationsRouter().execute<void>({
        op: 'chat.deleteConversation',
        payload: { conversationId, budgetId },
        meta: { label: 'chat.deleteConversation' },
      });
    },
  });
}

export function useChatMessages(conversationId: number | null | undefined) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  const enabled = Boolean(spaceId) && Boolean(conversationId && conversationId > 0);

  return useQuery<ChatMessage[]>({
    queryKey: ['chatMessages', spaceKey, conversationId],
    enabled,
    staleTime: 10 * 1000, // 10 seconds - messages update frequently
    queryFn: async () => {
      if (!spaceId || !conversationId) return [];
      const services = runtime.services();
      return services.chat.getMessages(conversationId);
    },
  });
}

export function useAddChatMessage() {
  const runtime = useRuntime();

  return useMutation<ChatMessage, Error, CreateMessageInput>({
    mutationFn: async (input) => {
      const { result } = await runtime.mutationsRouter().execute<ChatMessage>({
        op: 'chat.addMessage',
        payload: { input },
        meta: { label: 'chat.addMessage' },
      });
      return result;
    },
    onError: (error, variables) => {
      console.error('[useAddChatMessage] Failed to save message:', {
        error,
        conversationId: variables.conversationId,
        role: variables.role,
      });
    },
  });
}

export function useChatSettings(budgetId: number | null | undefined) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  const normalizedBudgetId = typeof budgetId === 'number' ? budgetId : null;
  const enabled = Boolean(spaceId) && Boolean(normalizedBudgetId && normalizedBudgetId > 0);

  return useQuery<ChatSettings | null>({
    queryKey: ['chatSettings', spaceKey, normalizedBudgetId],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!spaceId || !normalizedBudgetId) return null;
      const services = runtime.services();
      return services.chat.getSettings(normalizedBudgetId);
    },
  });
}

export function useUpdateChatSettings() {
  const runtime = useRuntime();

  return useMutation<ChatSettings, Error, { budgetId: number; input: ChatSettingsInput }>({
    mutationFn: async ({ budgetId, input }) => {
      const { result } = await runtime.mutationsRouter().execute<ChatSettings>({
        op: 'chat.updateSettings',
        payload: { budgetId, input },
        meta: { label: 'chat.updateSettings' },
      });
      return result;
    },
  });
}
