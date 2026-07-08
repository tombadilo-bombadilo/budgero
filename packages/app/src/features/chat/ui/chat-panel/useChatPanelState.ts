import { useEffect, useRef, useCallback, useState } from 'react';
import { useChatStore } from '@features/chat/model/useChatStore';
import { useUiStore } from '@shared/store/useUiStore';
import { useLLMSettings } from '@features/ai/api/useLLMSettings';
import {
  useChatSettings,
  useChatConversations,
  useChatMessages,
  useCreateConversation,
  useAddChatMessage,
  useDeleteConversation,
  useUpdateConversationTitle,
} from '@features/chat/api/useChat';
import { useCategories } from '@entities/category/api/useCategories';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useRuntime } from '@shared/runtime/runtime-provider';
import {
  streamChat,
  generateConversationTitle,
  type TokenUsage,
} from '@features/ai/lib/chat-client';
import {
  executeConfirmedAddTransaction,
  executeConfirmedEditTransaction,
  generateAddTransactionPreview,
  generateEditTransactionPreview,
  loadAnalyticsSchema,
  type AddTransactionArgs,
  type EditTransactionArgs,
  type ChatChartSpec,
} from '@features/ai/lib/tools';
import { buildBudgetContext } from '@budgero/core/browser';
import { executeReportQuery, type SqlDatabase } from '@shared/lib/sql/report-query-executor';
import { getErrorMessage } from '@shared/lib/errors';
import type { ToolContext } from '@features/ai/lib/tools/types';
import {
  getMostRecentConversation,
  scrollToBottom,
  fileToResizedDataUrl,
} from './chat-panel.utils';

export function useChatPanelState() {
  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const globalLocalizer = useUiStore((s) => s.globalLocalizer);
  const budgetId = selectedBudget?.ID ?? null;
  const runtime = useRuntime();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Live analytics schema, fetched once and reused across messages (it's static for the session).
  const analyticsSchemaRef = useRef<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);

  const handleAddImages = useCallback(async (files: File[]) => {
    const dataUrls = await Promise.all(files.map((f) => fileToResizedDataUrl(f)));
    setAttachedImages((prev) => [...prev, ...dataUrls]);
  }, []);

  const handleRemoveImage = useCallback((index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const {
    isOpen,
    setIsOpen,
    activeConversationId,
    setActiveConversationId,
    pendingTools,
    addPendingTool,
    updatePendingTool,
    confirmTool,
    rejectTool,
    removePendingTool,
    isGenerating,
    setIsGenerating,
    streamingText,
    setStreamingText,
    streamingToolEvents,
    setStreamingToolEvents,
    inputText,
    setInputText,
    transcription,
    setTranscription,
  } = useChatStore();

  const { data: llmSettings } = useLLMSettings(budgetId);
  const { data: chatSettings } = useChatSettings(budgetId);
  const { data: conversations = [] } = useChatConversations(budgetId);
  const { data: messages = [] } = useChatMessages(activeConversationId);
  const { data: categories = [] } = useCategories(budgetId ?? 0);
  const { data: accounts = [] } = useAccounts(budgetId ?? 0);

  const createConversation = useCreateConversation();
  const addMessage = useAddChatMessage();
  const deleteConversation = useDeleteConversation();
  const updateConversationTitle = useUpdateConversationTitle();

  useEffect(() => {
    scrollToBottom(scrollRef.current);
  }, [messages, pendingTools, streamingText]);

  useEffect(() => {
    if (isOpen && budgetId && !activeConversationId && conversations.length === 0) {
      createConversation.mutate(
        { budgetId, title: 'New Chat' },
        {
          onSuccess: (conv) => {
            setActiveConversationId(conv.ID);
          },
          onError: (error) => {
            console.error('[Chat] Failed to create conversation:', error);
          },
        }
      );
    } else if (isOpen && conversations.length > 0 && !activeConversationId) {
      const mostRecent = getMostRecentConversation(conversations);
      if (mostRecent) {
        setActiveConversationId(mostRecent.ID);
      }
    }
  }, [
    isOpen,
    budgetId,
    activeConversationId,
    conversations,
    createConversation,
    setActiveConversationId,
  ]);

  useEffect(() => {
    if (transcription) {
      setInputText(transcription);
      setTranscription('');
    }
  }, [transcription, setInputText, setTranscription]);

  const getToolContext = useCallback((): ToolContext | null => {
    if (!budgetId || !llmSettings) return null;

    return {
      budgetId,
      services: runtime.services(),
      executeMutation: async <T>(spec: {
        op: string;
        payload: Record<string, unknown>;
        invalidates?: string[][];
        meta?: {
          skipUndo?: boolean;
          label?: string;
          forceInvalidate?: boolean;
          origin?: 'local' | 'remote';
        };
      }) => {
        const { result } = await runtime.executeMutation<T>({
          op: spec.op,
          payload: spec.payload,
          invalidates: spec.invalidates,
          meta: spec.meta,
        });
        return result;
      },
      runReadOnlyQuery: async (sql, options) => {
        const db = (runtime.getDatabase ? runtime.getDatabase() : null) as SqlDatabase | null;
        return executeReportQuery(sql, db, options);
      },
      enabledTools: chatSettings?.EnabledTools ?? null,
      categories: categories.map((c) => ({ ID: c.ID, Name: c.Name })),
      accounts: accounts.map((a) => ({ ID: a.ID, Name: a.Name, Type: a.Type || 'checking' })),
      aiConfig: {
        provider: llmSettings.Provider,
        endpointURL: llmSettings.EndpointURL,
        apiKey: llmSettings.ApiKey,
        textModel: llmSettings.TextModel,
        visionModel: llmSettings.VisionModel,
      },
      currencySymbol: selectedBudget?.DisplayCurrency || 'RSD',
      formatCurrency: (amount: number) => globalLocalizer.format(amount),
    };
  }, [
    budgetId,
    llmSettings,
    chatSettings,
    runtime,
    categories,
    accounts,
    selectedBudget,
    globalLocalizer,
  ]);

  const handleSend = async () => {
    if (
      (!inputText.trim() && attachedImages.length === 0) ||
      !activeConversationId ||
      !budgetId ||
      !llmSettings
    ) {
      return;
    }

    const userMessage = inputText.trim();
    const images = attachedImages;
    const isFirstMessage = messages.length === 0;
    setInputText('');
    setAttachedImages([]);
    setStreamingToolEvents([]);
    setIsGenerating(true);

    try {
      // Add user message (persist any attached images so they re-render on reload)
      await addMessage.mutateAsync({
        conversationId: activeConversationId,
        budgetId,
        role: 'user',
        content: userMessage,
        toolResult:
          images.length > 0
            ? { toolCallId: 'images', success: true, result: { images } }
            : undefined,
      });

      const services = runtime.services();
      const contextMonths = chatSettings?.ContextMonths || 3;
      const budgetContext = buildBudgetContext(services, budgetId, contextMonths);

      const toolContext = getToolContext();
      if (!toolContext) {
        throw new Error('Tool context not available');
      }

      // Charts the assistant draws this turn are collected here, then persisted
      // on the assistant message so they render live and on reload.
      const collectedCharts: ChatChartSpec[] = [];
      toolContext.collectChart = (spec) => collectedCharts.push(spec);

      // Inject the live DB schema into the SQL/chart tools so the model writes
      // correct queries up front (fetched once per session).
      if (analyticsSchemaRef.current === null) {
        analyticsSchemaRef.current = await loadAnalyticsSchema(toolContext);
      }
      toolContext.analyticsSchema = analyticsSchemaRef.current || undefined;

      const chatHistory = messages
        .filter((m) => m.Role === 'user' || m.Role === 'assistant' || m.Role === 'tool')
        .map((m) => ({
          role: (m.Role === 'tool' ? 'assistant' : m.Role) as 'user' | 'assistant',
          content: m.Content,
        }));

      const { aiConfig } = toolContext;

      // Stream the response — onTextUpdate feeds partial text into the store for live rendering
      setStreamingText('');
      const result = await streamChat(
        aiConfig,
        userMessage,
        budgetContext,
        toolContext,
        chatHistory,
        (text) => setStreamingText(text),
        images,
        (events) => setStreamingToolEvents(events)
      );
      setStreamingText('');

      if (result.usage) {
        setTokenUsage(result.usage);
      }

      // Charts + tool-call log to persist on the assistant message (rendered by ChatMessage).
      const toolEvents = result.toolEvents ?? [];
      const chartToolResult =
        collectedCharts.length > 0 || toolEvents.length > 0
          ? {
              toolCallId: 'assistant-meta',
              success: true,
              result: { charts: collectedCharts, toolEvents },
            }
          : undefined;

      // Handle pending confirmation tool (add/edit transaction)
      if (result.pendingTool) {
        const { toolCallId, toolName, args } = result.pendingTool;
        const isEdit = toolName === 'edit_transaction';
        const preview = isEdit
          ? generateEditTransactionPreview(args as EditTransactionArgs, toolContext)
          : generateAddTransactionPreview(args as AddTransactionArgs, toolContext);

        addPendingTool({
          id: toolCallId,
          toolName,
          arguments: args,
          preview,
          status: 'pending',
        });

        // Save the text response (LLM's explanation of what it wants to do)
        const responseContent =
          result.text ||
          (isEdit
            ? "I'll update that transaction. Please confirm the changes above."
            : "I'll add that transaction for you. Please confirm the details above.");
        await addMessage.mutateAsync({
          conversationId: activeConversationId,
          budgetId,
          role: 'assistant',
          content: responseContent,
          toolResult: chartToolResult,
        });
      } else {
        // No pending tool — save the final text response
        const responseContent =
          result.text || 'Sorry, I encountered an error generating a response.';

        await addMessage.mutateAsync({
          conversationId: activeConversationId,
          budgetId,
          role: 'assistant',
          content: responseContent,
          toolResult: chartToolResult,
        });
      }

      // Generate title for new conversations (in background)
      const responseForTitle = result.text;
      if (isFirstMessage && responseForTitle) {
        generateConversationTitle(aiConfig, userMessage, responseForTitle)
          .then((title) => {
            if (title) {
              updateConversationTitle.mutate(
                { conversationId: activeConversationId, title },
                {
                  onSuccess: () => void 0,
                  onError: (err) => console.error('[Chat] Failed to update title:', err),
                }
              );
            }
          })
          .catch((err) => console.error('[Chat] Failed to generate title:', err));
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error, String(error));
      console.error('[Chat] handleSend error:', errorMsg, error);
      await addMessage.mutateAsync({
        conversationId: activeConversationId,
        budgetId,
        role: 'assistant',
        content: `Sorry, I encountered an error: ${errorMsg}`,
      });
    } finally {
      setIsGenerating(false);
      setStreamingToolEvents([]);
    }
  };

  const handleConfirmTool = async (toolId: string) => {
    const tool = pendingTools.find((t) => t.id === toolId);
    if (!tool || !activeConversationId || !budgetId) return;

    confirmTool(toolId);
    const toolContext = getToolContext();

    if (toolContext) {
      const result =
        tool.toolName === 'edit_transaction'
          ? await executeConfirmedEditTransaction(tool.arguments, toolContext)
          : await executeConfirmedAddTransaction(tool.arguments, toolContext);

      updatePendingTool(toolId, {
        status: 'executed',
        result,
      });

      await addMessage.mutateAsync({
        conversationId: activeConversationId,
        budgetId,
        role: 'tool',
        content: result.message,
        toolResult: {
          toolCallId: toolId,
          success: result.success,
          result: result.data,
          error: result.error,
        },
      });

      setTimeout(() => removePendingTool(toolId), 2000);
    }
  };

  const handleRejectTool = async (toolId: string) => {
    rejectTool(toolId);

    if (activeConversationId && budgetId) {
      await addMessage.mutateAsync({
        conversationId: activeConversationId,
        budgetId,
        role: 'assistant',
        content: 'Okay, I cancelled that action.',
      });
    }

    setTimeout(() => removePendingTool(toolId), 1000);
  };

  const handleNewChat = () => {
    if (!budgetId) return;
    createConversation.mutate(
      { budgetId, title: 'New Chat' },
      {
        onSuccess: (conv) => {
          setActiveConversationId(conv.ID);
        },
      }
    );
  };

  const handleDeleteChat = (conversationId: number) => {
    if (!budgetId) return;
    deleteConversation.mutate(
      { conversationId, budgetId },
      {
        onSuccess: () => {
          if (activeConversationId === conversationId) {
            setActiveConversationId(null);
          }
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  return {
    isOpen,
    setIsOpen,
    sidebarOpen,
    toggleSidebar,
    activeConversationId,
    setActiveConversationId,
    conversations,
    messages,
    pendingTools,
    isGenerating,
    streamingText,
    streamingToolEvents,
    inputText,
    setInputText,
    tokenUsage,
    llmSettings,
    attachedImages,
    handleAddImages,
    handleRemoveImage,

    scrollRef,

    handleSend,
    handleKeyDown,
    handleConfirmTool,
    handleRejectTool,
    handleNewChat,
    handleDeleteChat,
  };
}
