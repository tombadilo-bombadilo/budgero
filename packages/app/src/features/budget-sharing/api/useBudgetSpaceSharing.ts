import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { spaceApi } from '@shared/api/api-client';
import type {
  BudgetSpaceInvite,
  BudgetSpaceMember,
  BudgetSpaceSummary,
} from '@shared/model/budget-spaces';
import {
  decryptSpaceKeyFromInvite,
  encryptSpaceKeyForInvite,
  generateInviteSecret,
  hashInviteSecret,
  wrapSpaceKeyWithMaster,
} from '@budgero/runtime';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { syncBudgetStateFromRuntime } from '@shared/runtime/budget-gate';
import { MasterPasswordManager } from '@shared/lib/crypto';

const MAX_COLLABORATOR_SEATS = 5;

export function useSpaceMembers(spaceId: string | null) {
  return useQuery<BudgetSpaceMember[]>({
    queryKey: ['space-members', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => {
      if (!spaceId) throw new Error('Space id is required');
      return spaceApi.listMembers(spaceId);
    },
    staleTime: 30_000,
  });
}

export function useSpaceInvites(spaceId: string | null, isOwner = false) {
  return useQuery<BudgetSpaceInvite[]>({
    queryKey: ['space-invites', spaceId],
    enabled: Boolean(spaceId) && isOwner,
    queryFn: () => {
      if (!spaceId) throw new Error('Space id is required');
      return spaceApi.listInvites(spaceId);
    },
    staleTime: 30_000,
  });
}

export function useOwnedWorkspaceSeatUsage(
  ownedSpaceIds: string[],
  activeSpaceId: string | null,
  currentMembers: BudgetSpaceMember[],
  currentInvites: BudgetSpaceInvite[],
  enabled: boolean
) {
  const otherOwnedSpaceIds = ownedSpaceIds.filter((spaceId) => spaceId !== activeSpaceId);

  const memberQueries = useQueries({
    queries: otherOwnedSpaceIds.map((spaceId) => ({
      queryKey: ['space-members', spaceId],
      enabled,
      staleTime: 30_000,
      queryFn: () => spaceApi.listMembers(spaceId),
    })),
  });

  const inviteQueries = useQueries({
    queries: otherOwnedSpaceIds.map((spaceId) => ({
      queryKey: ['space-invites', spaceId],
      enabled,
      staleTime: 30_000,
      queryFn: () => spaceApi.listInvites(spaceId),
    })),
  });

  const isAcceptedMember = (m: BudgetSpaceMember) =>
    m.role === 'member' && m.invitation_status === 'accepted';

  const currentAcceptedMembers = currentMembers.filter(isAcceptedMember).length;
  const currentPendingInvites = currentInvites.filter(
    (invite) => invite.status === 'pending'
  ).length;

  const occupiedSlots =
    currentAcceptedMembers +
    currentPendingInvites +
    memberQueries.reduce((total, query) => {
      const members = Array.isArray(query.data) ? query.data : [];
      return total + members.filter(isAcceptedMember).length;
    }, 0) +
    inviteQueries.reduce((total, query) => {
      const invites = Array.isArray(query.data) ? query.data : [];
      return total + invites.filter((invite) => invite.status === 'pending').length;
    }, 0);

  const isLoading =
    enabled &&
    (memberQueries.some((query) => query.isLoading || query.isPending) ||
      inviteQueries.some((query) => query.isLoading || query.isPending));

  return {
    occupiedSlots,
    remainingSlots: Math.max(0, MAX_COLLABORATOR_SEATS - occupiedSlots),
    sharingLimitReached: occupiedSlots >= MAX_COLLABORATOR_SEATS,
    isLoading,
  };
}

interface CreateInviteInput {
  email?: string;
  expiresAt?: string;
}

export function useCreateSpaceInvite(spaceId: string | null) {
  const runtime = useRuntime();
  const qc = useQueryClient();

  return useMutation<BudgetSpaceInvite, Error, CreateInviteInput>({
    mutationFn: async ({ email, expiresAt }) => {
      if (!spaceId) throw new Error('An active workspace is required');

      const secret = generateInviteSecret();
      const token = await hashInviteSecret(secret);

      const invite = await spaceApi.createInvite(spaceId, email ?? '', token, expiresAt);

      try {
        const spaceKey = await runtime.requireSpaceKey(spaceId);
        const bundle = await encryptSpaceKeyForInvite(spaceKey, secret);
        await spaceApi.attachInviteBundle(spaceId, invite.id, bundle);
      } catch (error) {
        try {
          await spaceApi.cancelInvite(spaceId, invite.id);
        } catch {
          /* no-op: invite may already be cancelled */
        }
        throw error instanceof Error
          ? error
          : new Error('Failed to encrypt invite bundle. Invite cancelled.');
      }

      await qc.invalidateQueries({ queryKey: ['space-invites', spaceId] });
      // Return the raw secret so it can be displayed to the user
      return { ...invite, invite_secret: secret };
    },
  });
}

export function useCancelSpaceInvite(spaceId: string | null) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (inviteId) => {
      if (!spaceId) throw new Error('An active workspace is required');
      await spaceApi.cancelInvite(spaceId, inviteId);
    },
    onSuccess: () => {
      if (!spaceId) return;
      void qc.invalidateQueries({ queryKey: ['space-invites', spaceId] });
    },
  });
}

export function useRemoveSpaceMember(spaceId: string | null) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (memberId) => {
      if (!spaceId) throw new Error('An active workspace is required');
      await spaceApi.removeMember(spaceId, memberId);
    },
    onSuccess: () => {
      if (!spaceId) return;
      void qc.invalidateQueries({ queryKey: ['space-members', spaceId] });
      void qc.invalidateQueries({ queryKey: ['space-invites', spaceId] });
      void qc.invalidateQueries({ queryKey: ['budget-spaces'] });
    },
  });
}

interface RedeemInviteInput {
  inviteSecret: string;
  masterPassword?: string;
}

export function useRedeemSpaceInvite() {
  const runtime = useRuntime();
  const qc = useQueryClient();

  return useMutation<BudgetSpaceSummary, Error, RedeemInviteInput>({
    mutationFn: async ({ inviteSecret, masterPassword }) => {
      const token = await hashInviteSecret(inviteSecret);
      const inspection = await spaceApi.inspectInvite(token);
      if (!inspection.encrypted_bundle) {
        throw new Error('Invite is missing its encrypted bundle; ask the owner to resend.');
      }

      let resolvedMaster = masterPassword;
      if (!resolvedMaster) {
        resolvedMaster = (await MasterPasswordManager.get()) ?? undefined;
      }
      if (!resolvedMaster) {
        throw new Error('Master password required to finish invite redemption.');
      }

      const spaceKey = await decryptSpaceKeyFromInvite(inspection.encrypted_bundle, inviteSecret);
      const wrapped = await wrapSpaceKeyWithMaster(spaceKey, resolvedMaster);
      await MasterPasswordManager.store(resolvedMaster);
      const summary = await spaceApi.redeemInvite(token, wrapped);

      // Server-side membership now exists. Activate the joined space
      // DETERMINISTICALLY, mirroring the onboarding join path. A fresh
      // account has no initialized runtime yet — refreshSpaces' internal
      // fallback switch silently no-ops in the Idle state, leaving the
      // budget gate spinning on a space that never activates.
      if (!runtime.isInitialized()) {
        await runtime.init({ masterPassword: resolvedMaster, queryClient: qc });
      } else {
        await runtime.refreshSpaces();
      }
      await runtime.switchSpace(summary.space_id);

      // Blanket invalidation: the active space (and its whole DB) changed,
      // so every space-scoped query — budgets included — must refetch.
      // Anything narrower leaves the budget gate reading a stale/errored
      // budgets query it never retries.
      await qc.invalidateQueries();

      // Seed the budgets cache + selected budget imperatively, exactly like
      // the startup/reload and workspace-switcher paths do. The budget gate
      // must not depend on the reactive useBudgets query re-arming across
      // the switch — switchSpace clears the whole query cache mid-flight, so
      // an invalidate-only hand-off can land on an orphaned/disabled query
      // and leave the splash spinning forever.
      syncBudgetStateFromRuntime({
        runtime,
        queryClient: qc,
        spaceId: summary.space_id,
        candidateSelectedBudget: null,
      });

      return summary;
    },
  });
}
