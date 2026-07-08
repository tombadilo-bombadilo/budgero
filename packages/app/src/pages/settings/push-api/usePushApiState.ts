import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { pushApi } from '@shared/api/api-client';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { useBudgets } from '@entities/budget/api/useBudgets';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useCategoryGroups, useCategories } from '@entities/category/api/useCategories';
import { usePayeeDirectory } from '@entities/payee/api/payee-directory';
import { useUiStore } from '@shared/store/useUiStore';

export function usePushApiState() {
  const queryClient = useQueryClient();
  const runtime = useRuntime();

  const [newToken, setNewToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [showEncryptionKey, setShowEncryptionKey] = useState(false);
  const [encryptionKey, setEncryptionKey] = useState<string | null>(null);
  const [showKeyWarningDialog, setShowKeyWarningDialog] = useState(false);
  const [showIds, setShowIds] = useState(false);
  const [expandedBudgetId, setExpandedBudgetId] = useState<number | null>(null);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);

  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const budgetIdForQueries = expandedBudgetId ?? selectedBudget?.ID ?? 0;

  // Fetch budgets, accounts, and categories for ID reference
  const { data: budgets } = useBudgets();
  const { data: accounts } = useAccounts(budgetIdForQueries);
  const { data: categoryGroups } = useCategoryGroups(budgetIdForQueries);
  const { data: categories } = useCategories(budgetIdForQueries);
  const { data: payees } = usePayeeDirectory(budgetIdForQueries);

  const {
    data: tokenStatus,
    isLoading: isLoadingStatus,
    error: statusError,
  } = useQuery({
    queryKey: ['push-token-status'],
    queryFn: () => pushApi.getTokenStatus(),
  });

  const { data: queueStats, isLoading: isLoadingStats } = useQuery({
    queryKey: ['push-queue-stats'],
    queryFn: () => pushApi.getStats(),
    refetchInterval: 5000,
  });

  const clearQueueMutation = useMutation({
    mutationFn: () => pushApi.clearQueue(),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['push-queue-stats'] });
      toast.success(
        `Cleared ${data.deleted} pending item${data.deleted === 1 ? '' : 's'} from queue`
      );
    },
    onError: (error: Error) => {
      toast.error(`Failed to clear queue: ${error.message}`);
    },
  });

  const { data: encryptionInfo } = useQuery({
    queryKey: ['push-encryption-info'],
    queryFn: () => pushApi.getEncryptionInfo(),
    enabled: tokenStatus?.has_token === true,
  });

  const generateTokenMutation = useMutation({
    mutationFn: () => pushApi.generateToken(),
    onSuccess: (data) => {
      setNewToken(data.token);
      setShowToken(true);
      void queryClient.invalidateQueries({ queryKey: ['push-token-status'] });
      toast.success('API token generated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to generate token: ${error.message}`);
    },
  });

  const toggleTokenMutation = useMutation({
    mutationFn: (enabled: boolean) => pushApi.toggleToken(enabled),
    onSuccess: (_, enabled) => {
      void queryClient.invalidateQueries({ queryKey: ['push-token-status'] });
      toast.success(`Push API ${enabled ? 'enabled' : 'disabled'}`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to toggle token: ${error.message}`);
    },
  });

  const revokeTokenMutation = useMutation({
    mutationFn: () => pushApi.revokeToken(),
    onSuccess: () => {
      setNewToken(null);
      setShowRevokeDialog(false);
      void queryClient.invalidateQueries({ queryKey: ['push-token-status'] });
      toast.success('API token revoked');
    },
    onError: (error: Error) => {
      toast.error(`Failed to revoke token: ${error.message}`);
    },
  });

  const handleCopyToken = useCallback(async () => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      toast.success('Token copied to clipboard');
    } catch {
      toast.error('Failed to copy token');
    }
  }, [newToken]);

  const handleCopyEndpoint = useCallback(async () => {
    const endpoint = `${window.location.origin}/api/v1/push`;
    try {
      await navigator.clipboard.writeText(endpoint);
      toast.success('Endpoint copied to clipboard');
    } catch {
      toast.error('Failed to copy endpoint');
    }
  }, []);

  const handleGenerateToken = useCallback(() => {
    if (tokenStatus?.has_token) {
      setShowRegenerateDialog(true);
    } else {
      generateTokenMutation.mutate();
    }
  }, [tokenStatus?.has_token, generateTokenMutation]);

  const confirmRegenerate = useCallback(() => {
    setShowRegenerateDialog(false);
    generateTokenMutation.mutate();
  }, [generateTokenMutation]);

  const formatDate = useCallback((dateStr: string | undefined) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  }, []);

  const handleRevealEncryptionKey = useCallback(() => {
    setShowKeyWarningDialog(true);
  }, []);

  const confirmRevealKey = useCallback(() => {
    setShowKeyWarningDialog(false);
    const key = runtime.exportSpaceKey();
    if (key) {
      setEncryptionKey(key);
      setShowEncryptionKey(true);
      // Auto-hide after 60 seconds for security
      setTimeout(() => {
        setEncryptionKey(null);
        setShowEncryptionKey(false);
      }, 60000);
    } else {
      toast.error('Failed to export encryption key');
    }
  }, [runtime]);

  const handleCopyEncryptionKey = useCallback(async () => {
    if (!encryptionKey) return;
    try {
      await navigator.clipboard.writeText(encryptionKey);
      toast.success('Encryption key copied to clipboard');
    } catch {
      toast.error('Failed to copy key');
    }
  }, [encryptionKey]);

  const handleCopyId = useCallback(async (id: number, label: string) => {
    try {
      await navigator.clipboard.writeText(String(id));
      toast.success(`${label} ID copied: ${id}`);
    } catch {
      toast.error('Failed to copy ID');
    }
  }, []);

  // Payees are referenced by name in push payloads (there is no payee id),
  // so the reference panel copies the name string instead.
  const handleCopyText = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied: ${text}`);
    } catch {
      toast.error('Failed to copy');
    }
  }, []);

  const handleHideEncryptionKey = useCallback(() => {
    setEncryptionKey(null);
    setShowEncryptionKey(false);
  }, []);

  const handlePullMutations = useCallback(async () => {
    setIsProcessingQueue(true);
    try {
      const result = await runtime.processPushQueue();
      void queryClient.invalidateQueries({ queryKey: ['push-queue-stats'] });
      // Invalidate mutation history so audit log shows new entries (including failures)
      void queryClient.invalidateQueries({ queryKey: ['mutationHistory'] });
      void queryClient.invalidateQueries({ queryKey: ['mutationHistoryCount'] });
      if (result.processed > 0 || result.failed > 0) {
        if (result.failed > 0) {
          toast.warning(`Processed ${result.processed}, failed ${result.failed}`, {
            description: 'Check Audit Log for error details',
          });
        } else {
          toast.success(
            `Processed ${result.processed} mutation${result.processed === 1 ? '' : 's'}`
          );
        }
      } else {
        toast.info('No pending mutations to process');
      }
    } catch (error) {
      toast.error('Failed to process mutations');
      console.error('Pull mutations error:', error);
    } finally {
      setIsProcessingQueue(false);
    }
  }, [runtime, queryClient]);

  return {
    newToken,
    showToken,
    setShowToken,
    showRevokeDialog,
    setShowRevokeDialog,
    showRegenerateDialog,
    setShowRegenerateDialog,
    showEncryptionKey,
    encryptionKey,
    showKeyWarningDialog,
    setShowKeyWarningDialog,
    showIds,
    setShowIds,
    expandedBudgetId,
    setExpandedBudgetId,
    isProcessingQueue,

    budgets,
    accounts,
    categoryGroups,
    categories,
    payees,
    tokenStatus,
    isLoadingStatus,
    statusError,
    queueStats,
    isLoadingStats,
    encryptionInfo,

    clearQueueMutation,
    generateTokenMutation,
    toggleTokenMutation,
    revokeTokenMutation,

    handleCopyToken,
    handleCopyEndpoint,
    handleGenerateToken,
    confirmRegenerate,
    formatDate,
    handleRevealEncryptionKey,
    confirmRevealKey,
    handleCopyEncryptionKey,
    handleCopyId,
    handleCopyText,
    handleHideEncryptionKey,
    handlePullMutations,
  };
}

export type PushApiState = ReturnType<typeof usePushApiState>;
