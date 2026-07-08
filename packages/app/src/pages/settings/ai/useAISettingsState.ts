import { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { useUiStore } from '@shared/store/useUiStore';
import { toastError } from '@shared/lib/errors';
import { useLLMSettings, useUpdateLLMSettings } from '@features/ai/api/useLLMSettings';
import { useChatSettings, useUpdateChatSettings } from '@features/chat/api/useChat';
import { useAllTransactions } from '@entities/transaction/api/useTransactions';
import { testConnection, type AIClientConfig } from '@features/ai/lib/client';
import { ALL_TOOL_KEYS } from '@features/ai/lib/tools';
import type { LLMProvider, ExecutionMode, SpeechModel } from '@budgero/core/browser';
import {
  DEFAULT_ENDPOINTS,
  DEFAULT_TEXT_MODEL,
  DEFAULT_VISION_MODEL,
  DEFAULT_PROVIDER,
  DEFAULT_ENDPOINT,
} from './ai-settings.constants';

export type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

export function useAISettingsState() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const budgetId = selectedBudget?.ID ?? 0;

  const { data: settings, isLoading, isFetched } = useLLMSettings(budgetId);
  const updateSettings = useUpdateLLMSettings();
  const { data: chatSettings } = useChatSettings(budgetId);
  const updateChatSettings = useUpdateChatSettings();
  const { data: transactions = [] } = useAllTransactions(budgetId);

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<LLMProvider>(DEFAULT_PROVIDER);
  const [endpointURL, setEndpointURL] = useState(DEFAULT_ENDPOINT);
  const [apiKey, setApiKey] = useState('');
  const [textModel, setTextModel] = useState(DEFAULT_TEXT_MODEL);
  const [visionModel, setVisionModel] = useState(DEFAULT_VISION_MODEL);
  const [contextLength, setContextLength] = useState<number | null>(null);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const [textModelOpen, setTextModelOpen] = useState(false);
  const [visionModelOpen, setVisionModelOpen] = useState(false);

  const [categorizeOpen, setCategorizeOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const [chatExecutionMode, setChatExecutionMode] = useState<ExecutionMode>('confirm');
  const [chatVoiceEnabled, setChatVoiceEnabled] = useState(true);
  const [chatShowBubble, setChatShowBubble] = useState(true);
  const [chatContextMonths, setChatContextMonths] = useState(3);
  const [chatSpeechModel, setChatSpeechModel] = useState<SpeechModel>('base');
  // null = all tools enabled (not yet configured)
  const [chatEnabledTools, setChatEnabledTools] = useState<string[] | null>(null);

  const uncategorizedCount = useMemo(() => {
    return transactions.filter((t) => {
      if (!t) return false;
      if (t.Category === 'Split') return false;
      return !t.CategoryID || t.CategoryID === 0 || !t.Category || t.Category === 'Uncategorized';
    }).length;
  }, [transactions]);

  // Load settings when they arrive - defer to avoid synchronous cascade
  useEffect(() => {
    if (settings) {
      const id = requestAnimationFrame(() => {
        setEnabled(settings.Enabled);
        setProvider(settings.Provider);
        setEndpointURL(settings.EndpointURL);
        setApiKey(settings.ApiKey || '');
        setTextModel(settings.TextModel);
        setVisionModel(settings.VisionModel);
        setContextLength(settings.ContextLength);
      });
      return () => cancelAnimationFrame(id);
    }
  }, [settings, budgetId, isLoading, isFetched]);

  // Load chat settings when they arrive - defer to avoid synchronous cascade
  useEffect(() => {
    if (chatSettings) {
      const id = requestAnimationFrame(() => {
        setChatExecutionMode(chatSettings.ExecutionMode);
        setChatVoiceEnabled(chatSettings.VoiceInputEnabled);
        setChatShowBubble(chatSettings.ShowBubble);
        setChatContextMonths(chatSettings.ContextMonths);
        setChatSpeechModel(chatSettings.SpeechModel || 'base');
        setChatEnabledTools(chatSettings.EnabledTools ?? null);
      });
      return () => cancelAnimationFrame(id);
    }
  }, [chatSettings]);

  // Compare the *effective* enabled tool set (null = all enabled).
  const enabledToolsKey = useMemo(() => {
    const effective = (t: string[] | null | undefined) => [...(t ?? ALL_TOOL_KEYS)].sort();
    return effective(chatEnabledTools);
  }, [chatEnabledTools]);

  // Derive chat settings changes - no useState needed
  const chatHasChanges = useMemo(() => {
    if (!chatSettings) return true;
    const savedToolsKey = [...(chatSettings.EnabledTools ?? ALL_TOOL_KEYS)].sort();
    return (
      chatExecutionMode !== chatSettings.ExecutionMode ||
      chatVoiceEnabled !== chatSettings.VoiceInputEnabled ||
      chatShowBubble !== chatSettings.ShowBubble ||
      chatContextMonths !== chatSettings.ContextMonths ||
      chatSpeechModel !== (chatSettings.SpeechModel || 'base') ||
      JSON.stringify(enabledToolsKey) !== JSON.stringify(savedToolsKey)
    );
  }, [
    chatExecutionMode,
    chatVoiceEnabled,
    chatShowBubble,
    chatContextMonths,
    chatSpeechModel,
    enabledToolsKey,
    chatSettings,
  ]);

  // Derive AI settings changes - no useState needed
  const hasChanges = useMemo(() => {
    if (!settings) {
      return (
        enabled ||
        provider !== DEFAULT_PROVIDER ||
        endpointURL !== DEFAULT_ENDPOINT ||
        apiKey !== '' ||
        textModel !== DEFAULT_TEXT_MODEL ||
        visionModel !== DEFAULT_VISION_MODEL ||
        contextLength !== null
      );
    }
    return (
      enabled !== settings.Enabled ||
      provider !== settings.Provider ||
      endpointURL !== settings.EndpointURL ||
      apiKey !== (settings.ApiKey || '') ||
      textModel !== settings.TextModel ||
      visionModel !== settings.VisionModel ||
      contextLength !== settings.ContextLength
    );
  }, [enabled, provider, endpointURL, apiKey, textModel, visionModel, contextLength, settings]);

  const handleProviderChange = useCallback((value: LLMProvider) => {
    setProvider(value);
    setEndpointURL(DEFAULT_ENDPOINTS[value]);
    setConnectionStatus('idle');
    setAvailableModels([]);
  }, []);

  const handleEndpointChange = useCallback((value: string) => {
    setEndpointURL(value);
    setConnectionStatus('idle');
  }, []);

  const handleApiKeyChange = useCallback((value: string) => {
    setApiKey(value);
    setConnectionStatus('idle');
  }, []);

  const handleContextLengthChange = useCallback((value: string) => {
    const parsed = Number.parseInt(value, 10);
    setContextLength(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  }, []);

  const handleToggleTool = useCallback((key: string, enabled: boolean) => {
    setChatEnabledTools((prev) => {
      const current = prev ?? ALL_TOOL_KEYS;
      return enabled ? Array.from(new Set([...current, key])) : current.filter((k) => k !== key);
    });
  }, []);

  const handleTestConnection = useCallback(async () => {
    setConnectionStatus('testing');
    setConnectionError(null);

    const config: AIClientConfig = {
      provider,
      endpointURL,
      apiKey,
      textModel,
      visionModel,
    };

    const result = await testConnection(config);

    if (result.success) {
      setConnectionStatus('success');
      const models = result.models || [];
      setAvailableModels(models);

      if (result.contextLength) {
        setContextLength(result.contextLength);
      }

      const contextInfo = result.contextLength
        ? ` | Context: ${(result.contextLength / 1000).toFixed(0)}k tokens`
        : '';
      toast.success('Connected successfully!', {
        description: `Found ${models.length} models${contextInfo}`,
      });
    } else {
      setConnectionStatus('error');
      setConnectionError(result.error || 'Connection failed');
      toast.error('Connection failed', {
        description: result.error,
      });
    }
  }, [provider, endpointURL, apiKey, textModel, visionModel]);

  const handleSave = useCallback(async () => {
    if (!budgetId) return;

    try {
      await updateSettings.mutateAsync({
        budgetId,
        input: {
          Enabled: enabled,
          Provider: provider,
          EndpointURL: endpointURL,
          ApiKey: apiKey,
          TextModel: textModel,
          VisionModel: visionModel,
          ContextLength: contextLength,
        },
      });

      toast.success('AI settings saved');
    } catch (error: unknown) {
      toastError('Failed to save settings', error, 'Unknown error');
    }
  }, [
    budgetId,
    enabled,
    provider,
    endpointURL,
    apiKey,
    textModel,
    visionModel,
    contextLength,
    updateSettings,
  ]);

  const handleSaveChatSettings = useCallback(async () => {
    if (!budgetId) return;

    try {
      await updateChatSettings.mutateAsync({
        budgetId,
        input: {
          ExecutionMode: chatExecutionMode,
          VoiceInputEnabled: chatVoiceEnabled,
          ShowBubble: chatShowBubble,
          ContextMonths: chatContextMonths,
          SpeechModel: chatSpeechModel,
          EnabledTools: chatEnabledTools,
        },
      });

      toast.success('Chat settings saved');
    } catch (error: unknown) {
      toastError('Failed to save chat settings', error, 'Unknown error');
    }
  }, [
    budgetId,
    chatExecutionMode,
    chatVoiceEnabled,
    chatShowBubble,
    chatContextMonths,
    chatSpeechModel,
    chatEnabledTools,
    updateChatSettings,
  ]);

  return {
    budgetId,
    isLoading,
    isFetched,

    enabled,
    setEnabled,
    provider,
    endpointURL,
    apiKey,
    textModel,
    setTextModel,
    visionModel,
    setVisionModel,
    contextLength,
    hasChanges,

    connectionStatus,
    connectionError,
    availableModels,

    textModelOpen,
    setTextModelOpen,
    visionModelOpen,
    setVisionModelOpen,

    categorizeOpen,
    setCategorizeOpen,
    scannerOpen,
    setScannerOpen,

    chatExecutionMode,
    setChatExecutionMode,
    chatVoiceEnabled,
    setChatVoiceEnabled,
    chatShowBubble,
    setChatShowBubble,
    chatContextMonths,
    setChatContextMonths,
    chatSpeechModel,
    setChatSpeechModel,
    chatEnabledTools,
    chatHasChanges,

    uncategorizedCount,

    handleProviderChange,
    handleEndpointChange,
    handleApiKeyChange,
    handleContextLengthChange,
    handleToggleTool,
    handleTestConnection,
    handleSave,
    handleSaveChatSettings,

    isSaving: updateSettings.isPending,
    isSavingChat: updateChatSettings.isPending,
  };
}
