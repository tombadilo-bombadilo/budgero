import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  parseEnableBankingConfig,
  type BankConnection,
  type BankFeedSettings,
  type BankLink,
  type BankProvider,
  type BankReview,
  type EnableBankingSession,
} from '@budgero/core/browser';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { invalidateRoots } from '@shared/lib/query-utils';
import { getInvalidatesForOp } from '@shared/mutations/op-code-registry';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { runInUndoGroup } from '@shared/mutations/UndoStore';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import {
  deleteSession,
  getApplication,
  listAspsps,
  type EnableBankingApplication,
} from '../lib/enable-banking/client';
import type { EnableBankingCredentials } from '../lib/enable-banking/jwt';
import { fetchRemoteAccounts } from '../lib/provider';
import { claimSetupToken } from '../lib/simplefin-client';
import { navigatePopup, waitForBankCallback } from '../model/bank-auth-popup';
import { beginAuthorization, completeAuthorization } from '../model/enable-banking-auth';
import { linkAccounts, type LinkRequest } from '../model/link-accounts';
import { bankIdempotencyKey, runBankSync } from '../model/run-bank-sync';

export function invalidateAfterBankSync(queryClient: QueryClient) {
  const roots = new Set(['bankSync', 'accounts', 'budgets', 'categories']);
  for (const key of getInvalidatesForOp('transactions.import') ?? []) roots.add(key[0]);
  invalidateRoots(queryClient, ...roots);
}

/** Every connected provider for the budget (SimpleFIN and Enable Banking can coexist). */
export function useBankConnections(budgetId: number | undefined) {
  return useSpaceQuery<BankConnection[]>({
    key: ['bankSync', 'connections', budgetId ?? 0],
    enabled: Boolean(budgetId),
    queryFn: (services) => services.bankSync.listConnections(budgetId!),
  });
}

export function useBankLinks(budgetId: number | undefined) {
  return useSpaceQuery<BankLink[]>({
    key: ['bankSync', 'links', budgetId ?? 0],
    enabled: Boolean(budgetId),
    queryFn: (services) => services.bankSync.listLinks(budgetId!),
  });
}

export function useBankReviews(budgetId: number | undefined, accountId?: number) {
  return useSpaceQuery<BankReview[]>({
    key: ['bankSync', 'reviews', budgetId ?? 0, accountId ?? 'all'],
    enabled: Boolean(budgetId),
    queryFn: (services) => services.bankSync.listPendingReviews(budgetId!, accountId),
  });
}

/** SimpleFIN calls spend Bridge quota, so this is cached for the session. */
export function useRemoteBankAccounts(connection: BankConnection | undefined) {
  return useQuery({
    queryKey: [
      'bankRemoteAccounts',
      connection?.Provider,
      connection?.AccessURL,
      connection?.ConfigJSON,
    ],
    enabled: Boolean(connection),
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: () => fetchRemoteAccounts(connection!),
  });
}

export function useConnectBank() {
  const runtime = useRuntime();
  return useMutation({
    mutationFn: async ({ budgetId, setupToken }: { budgetId: number; setupToken: string }) => {
      const accessUrl = await claimSetupToken(setupToken);
      return executeSpaceMutation<BankConnection>(runtime, {
        op: 'bankSync.saveConnection',
        payload: { budgetId, accessUrl },
        meta: { label: 'bank-sync', skipUndo: true },
      });
    },
  });
}

export function useDisconnectBank() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ budgetId, provider }: { budgetId: number; provider: BankProvider }) =>
      executeSpaceMutation(runtime, {
        op: 'bankSync.deleteConnection',
        payload: { budgetId, provider },
        meta: { label: 'bank-sync', skipUndo: true },
      }),
    onSuccess: (_result, { provider }) =>
      queryClient.removeQueries({ queryKey: ['bankRemoteAccounts', provider] }),
  });
}

export function useRunBankSync() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ budgetId, providers }: { budgetId: number; providers?: BankProvider[] }) =>
      runBankSync(runtime, budgetId, { providers }),
    onSettled: () => invalidateAfterBankSync(queryClient),
  });
}

export function useLinkBankAccounts() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { connection: BankConnection; requests: LinkRequest[] }) =>
      linkAccounts(runtime, input.connection, input.requests),
    onSettled: () => invalidateAfterBankSync(queryClient),
  });
}

export function useUpdateBankFeedSettings() {
  const runtime = useRuntime();
  return useMutation({
    mutationFn: (input: { budgetId: number; accountId: number; settings: BankFeedSettings }) =>
      executeSpaceMutation(runtime, {
        op: 'bankSync.updateLinkSettings',
        payload: input,
        meta: { label: 'bank-sync' },
      }),
  });
}

export function useUnlinkBankAccount() {
  const runtime = useRuntime();
  return useMutation({
    mutationFn: ({ budgetId, accountId }: { budgetId: number; accountId: number }) =>
      executeSpaceMutation(runtime, {
        op: 'bankSync.deleteLink',
        payload: { budgetId, accountId },
        meta: { label: 'bank-sync', skipUndo: true },
      }),
  });
}

export type ReviewAction = 'match' | 'import' | 'dismiss';

type SpaceRuntime = Parameters<typeof executeSpaceMutation>[0];

/**
 * Resolve one bank review. Every step is one undo entry together: Ctrl+Z
 * reverts the match (or the imported row), the cleared flag and the review
 * status at once, instead of only the newest step.
 */
export function resolveBankReview(
  runtime: SpaceRuntime,
  review: BankReview,
  action: ReviewAction
): Promise<void> {
  return runInUndoGroup(async () => {
    const { BudgetID: budgetId, AccountID: accountId, identity } = review;
    if (action === 'match' && review.candidate) {
      await executeSpaceMutation(runtime, {
        op: 'importHistory.match',
        payload: { budgetId, accountId, transactionId: review.candidate.id, identity },
        meta: { label: 'bank-sync' },
      });
      await executeSpaceMutation(runtime, {
        op: 'transactions.setCleared',
        payload: { budgetId, ids: [review.candidate.id], cleared: true },
        meta: { label: 'bank-sync' },
      });
    } else if (action !== 'dismiss') {
      await executeSpaceMutation(runtime, {
        op: 'transactions.import',
        payload: {
          inflow: identity.inflow,
          outflow: identity.outflow,
          accountId,
          categoryId: 0,
          budgetId,
          date: identity.date,
          memo: identity.memo.substring(0, 255),
          payee: identity.payee,
          transferId: '',
          importIdentities: [identity],
        },
        idempotencyKey: await bankIdempotencyKey(identity.operationId),
        meta: { label: 'bank-sync' },
      });
    }
    await executeSpaceMutation(runtime, {
      op: 'bankSync.setReviewStatus',
      payload: {
        budgetId,
        id: review.ID,
        status: action === 'dismiss' ? 'dismissed' : 'resolved',
      },
      meta: { label: 'bank-sync' },
    });
  });
}

export function useResolveBankReview() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ review, action }: { review: BankReview; action: ReviewAction }) =>
      resolveBankReview(runtime, review, action),
    onSettled: () => invalidateAfterBankSync(queryClient),
  });
}

/** Checks the app ID and key against Enable Banking before anything is saved. */
export function useVerifyEnableBankingApp() {
  return useMutation<EnableBankingApplication, Error, EnableBankingCredentials>({
    mutationFn: (credentials) => getApplication(credentials),
  });
}

export function useSaveEnableBankingConnection() {
  const runtime = useRuntime();
  return useMutation({
    mutationFn: (input: {
      budgetId: number;
      credentials: EnableBankingCredentials;
      application: EnableBankingApplication;
    }) =>
      executeSpaceMutation<BankConnection>(runtime, {
        op: 'bankSync.saveEnableBankingConnection',
        payload: {
          budgetId: input.budgetId,
          config: {
            appId: input.credentials.appId.trim(),
            privateKeyPem: input.credentials.privateKeyPem.trim(),
            appName: input.application.name,
            environment: input.application.environment,
          },
        },
        meta: { label: 'bank-sync', skipUndo: true },
      }),
  });
}

export function useAspsps(connection: BankConnection | undefined, country: string | undefined) {
  const config = parseEnableBankingConfig(connection);
  return useQuery({
    queryKey: ['enableBankingAspsps', config?.appId, country],
    enabled: Boolean(config && country),
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
    queryFn: () => listAspsps(config!, country!),
  });
}

/**
 * Runs the bank login. With a popup (opened synchronously by the caller), the
 * login happens there and this resolves with the new session. Without one,
 * the page redirects to the bank and the callback page finishes the job.
 */
export function useStartBankAuthorization() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      connection,
      aspsp,
      popup,
      signal,
    }: {
      connection: BankConnection;
      aspsp: Parameters<typeof beginAuthorization>[1];
      popup: Window | null;
      signal?: AbortSignal;
    }): Promise<EnableBankingSession | null> => {
      if (!popup) {
        const { url } = await beginAuthorization(connection, aspsp, 'redirect');
        window.location.assign(url);
        return null;
      }
      try {
        const { url, state } = await beginAuthorization(connection, aspsp, 'popup');
        navigatePopup(popup, url);
        const params = await waitForBankCallback(state, popup, signal);
        return (await completeAuthorization(runtime, params)).session;
      } catch (error) {
        try {
          popup.close();
        } catch {
          /* already gone */
        }
        throw error;
      }
    },
    onSettled: () => invalidateAfterBankSync(queryClient),
  });
}

export function useRemoveBankSession() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      connection,
      sessionId,
    }: {
      connection: BankConnection;
      sessionId: string;
    }) => {
      const config = parseEnableBankingConfig(connection);
      if (config) {
        // Revoke at Enable Banking too; an already-expired session can't be, which is fine.
        await deleteSession(config, sessionId).catch((error: unknown) =>
          console.warn('[BankSync] Could not revoke Enable Banking session', error)
        );
      }
      await executeSpaceMutation(runtime, {
        op: 'bankSync.removeEnableBankingSession',
        payload: { budgetId: connection.BudgetID, sessionId },
        meta: { label: 'bank-sync', skipUndo: true },
      });
    },
    onSettled: () => invalidateAfterBankSync(queryClient),
  });
}
