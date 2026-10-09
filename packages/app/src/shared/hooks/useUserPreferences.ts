import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useRuntime,
  useActiveSpaceId,
  useRuntimeInitialized,
} from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import type { DuplicateHintSettings } from '@budgero/core/browser';

export const DEFAULT_DUPLICATE_HINT_SETTINGS: DuplicateHintSettings = {
  enabled: true,
  toleranceBps: 100,
  dayWindow: 7,
};

/** Service interface for user preferences */
interface UserMetaService {
  getWeekStartsOn?(): Promise<0 | 1> | 0 | 1;
  getDuplicateHintSettings?(): Promise<DuplicateHintSettings> | DuplicateHintSettings;
  getAllowOverAssignment(): Promise<boolean> | boolean;
  getSuggestCategoryFromPayee?(): Promise<boolean> | boolean;
  getShowGroupPercent?(): Promise<boolean> | boolean;
  getPlanningNumberAnimations?(): Promise<boolean> | boolean;
  getDialogBackgroundBlur?(): Promise<boolean> | boolean;
  getHideZeroAmounts?(): Promise<boolean> | boolean;
  getInlineTransactionEntry?(): Promise<boolean> | boolean;
}

/** Runtime services with userMeta */
interface ServicesWithUserMeta {
  userMeta?: UserMetaService;
}

/**
 * Hook to get the allow over-assignment preference
 * Returns true if the user has enabled flexible budgeting (allows over-assignment)
 */
export function useAllowOverAssignment() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = spaceId ?? 'global';

  return useQuery<boolean>({
    queryKey: ['allowOverAssignment', spaceKey],
    queryFn: async () => {
      const services = runtime.services() as ServicesWithUserMeta;
      if (services?.userMeta) {
        const result = await services.userMeta.getAllowOverAssignment();
        return result ?? false;
      }
      return false;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * Hook to update the allow over-assignment preference
 * Uses the mutation system for proper ZK sync and persistence
 */
function useUpdateAllowOverAssignment() {
  const runtime = useRuntime();

  return useMutation<void, Error, boolean>({
    mutationFn: async (value: boolean) => {
      // Use the mutation router for proper sync, encryption, and persistence.
      // Invalidation is executor-driven from the op's declared invalidates.
      await executeSpaceMutation<void>(runtime, {
        op: 'userPreferences.setAllowOverAssignment',
        payload: { value },
        meta: { label: 'Update budget over-assignment setting' },
      });
    },
  });
}

/**
 * Whether the add-transaction form pre-fills the category from the payee's
 * last transaction. Defaults to true — including while the query is loading
 * and on older runtimes whose service predates the setting, so the feature
 * never appears switched off to someone who never switched it off.
 */
export function useSuggestCategoryFromPayee() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = spaceId ?? 'global';

  return useQuery<boolean>({
    queryKey: ['suggestCategoryFromPayee', spaceKey],
    queryFn: async () => {
      const services = runtime.services() as ServicesWithUserMeta;
      if (services?.userMeta?.getSuggestCategoryFromPayee) {
        const result = await services.userMeta.getSuggestCategoryFromPayee();
        return result ?? true;
      }
      return true;
    },
    // No initialData: it would stamp the default as FRESH data and suppress
    // the fetch for the whole staleTime, hiding a persisted "off" for minutes
    // after every load. Callers default to true while data is undefined.
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

function useUpdateSuggestCategoryFromPayee() {
  const runtime = useRuntime();

  return useMutation<void, Error, boolean>({
    mutationFn: async (value: boolean) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'userPreferences.setSuggestCategoryFromPayee',
        payload: { value },
        meta: { label: 'Update payee category suggestions setting' },
      });
    },
  });
}

/** Query + mutation pair for the payee category memory setting. */
export function useSuggestCategoryFromPayeePreference() {
  const { data: suggestCategoryFromPayee = true, ...queryRest } = useSuggestCategoryFromPayee();
  const updateMutation = useUpdateSuggestCategoryFromPayee();

  return {
    suggestCategoryFromPayee,
    isLoading: queryRest.isLoading,
    updateSuggestCategoryFromPayee: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
}

/**
 * Convenience hook that provides both the query and mutation
 */
export function useAllowOverAssignmentPreference() {
  const { data: allowOverAssignment = false, ...queryRest } = useAllowOverAssignment();
  const updateMutation = useUpdateAllowOverAssignment();

  return {
    allowOverAssignment,
    isLoading: queryRest.isLoading,
    isError: queryRest.isError,
    error: queryRest.error,
    updateAllowOverAssignment: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
}

/**
 * Whether category group rows on the Planning page show their share of the
 * month's total assigned amount. Off by default.
 */
export function useShowGroupPercent() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = spaceId ?? 'global';

  return useQuery<boolean>({
    queryKey: ['showGroupPercent', spaceKey],
    queryFn: async () => {
      const services = runtime.services() as ServicesWithUserMeta;
      if (services?.userMeta?.getShowGroupPercent) {
        const result = await services.userMeta.getShowGroupPercent();
        return result ?? false;
      }
      return false;
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

function useUpdateShowGroupPercent() {
  const runtime = useRuntime();

  return useMutation<void, Error, boolean>({
    mutationFn: async (value: boolean) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'userPreferences.setShowGroupPercent',
        payload: { value },
        meta: { label: 'Update category group percentages setting' },
      });
    },
  });
}

/** Query + mutation pair for the category group percentages setting. */
export function useShowGroupPercentPreference() {
  const { data: showGroupPercent = false, ...queryRest } = useShowGroupPercent();
  const updateMutation = useUpdateShowGroupPercent();

  return {
    showGroupPercent,
    isLoading: queryRest.isLoading,
    updateShowGroupPercent: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
}

/** Whether amount changes on the Planning page animate. Off by default. */
export function usePlanningNumberAnimations() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = spaceId ?? 'global';

  return useQuery<boolean>({
    queryKey: ['planningNumberAnimations', spaceKey],
    queryFn: async () => {
      const services = runtime.services() as ServicesWithUserMeta;
      if (services?.userMeta?.getPlanningNumberAnimations) {
        const result = await services.userMeta.getPlanningNumberAnimations();
        return result ?? false;
      }
      return false;
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

function useUpdatePlanningNumberAnimations() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const queryClient = useQueryClient();
  const queryKey = ['planningNumberAnimations', spaceId ?? 'global'] as const;

  return useMutation<void, Error, boolean, { previous: boolean | undefined }>({
    mutationFn: async (value: boolean) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'userPreferences.setPlanningNumberAnimations',
        payload: { value },
        meta: { label: 'Update planning number animations setting' },
      });
    },
    onMutate: async (value) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<boolean>(queryKey);
      queryClient.setQueryData(queryKey, value);
      return { previous };
    },
    onError: (_error, _value, context) => {
      queryClient.setQueryData(queryKey, context?.previous ?? false);
    },
  });
}

/** Query + mutation pair for Planning-page number animations. */
export function usePlanningNumberAnimationsPreference() {
  const { data: planningNumberAnimations = false, ...queryRest } = usePlanningNumberAnimations();
  const updateMutation = useUpdatePlanningNumberAnimations();

  return {
    planningNumberAnimations,
    isLoading: queryRest.isLoading,
    updatePlanningNumberAnimations: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
}

/** Whether the page behind open dialogs is blurred. On by default. */
export function useDialogBackgroundBlur() {
  const runtime = useRuntime();
  const runtimeInitialized = useRuntimeInitialized();
  const spaceId = useActiveSpaceId();
  const spaceKey = spaceId ?? 'global';

  return useQuery<boolean>({
    queryKey: ['dialogBackgroundBlur', spaceKey],
    queryFn: async () => {
      const services = runtime.services() as ServicesWithUserMeta;
      if (services?.userMeta?.getDialogBackgroundBlur) {
        const result = await services.userMeta.getDialogBackgroundBlur();
        return result ?? true;
      }
      return true;
    },
    enabled: runtimeInitialized,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

function useUpdateDialogBackgroundBlur() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const queryClient = useQueryClient();
  const queryKey = ['dialogBackgroundBlur', spaceId ?? 'global'] as const;

  return useMutation<void, Error, boolean, { previous: boolean | undefined }>({
    mutationFn: async (value: boolean) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'userPreferences.setDialogBackgroundBlur',
        payload: { value },
        meta: { label: 'Update dialog background blur setting' },
      });
    },
    onMutate: async (value) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<boolean>(queryKey);
      queryClient.setQueryData(queryKey, value);
      return { previous };
    },
    onError: (_error, _value, context) => {
      queryClient.setQueryData(queryKey, context?.previous ?? true);
    },
  });
}

/** Query + mutation pair for dialog background blur. */
export function useDialogBackgroundBlurPreference() {
  const { data: dialogBackgroundBlur = true, ...queryRest } = useDialogBackgroundBlur();
  const updateMutation = useUpdateDialogBackgroundBlur();

  return {
    dialogBackgroundBlur,
    isLoading: queryRest.isLoading,
    updateDialogBackgroundBlur: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
}

/** Whether zero transaction amounts render as empty cells. Off by default. */
export function useHideZeroAmounts() {
  const runtime = useRuntime();
  const runtimeInitialized = useRuntimeInitialized();
  const spaceId = useActiveSpaceId();

  return useQuery<boolean>({
    queryKey: ['hideZeroAmounts', spaceId ?? 'global'],
    queryFn: async () => {
      const services = runtime.services() as ServicesWithUserMeta;
      return (await services?.userMeta?.getHideZeroAmounts?.()) ?? false;
    },
    enabled: runtimeInitialized,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Query + mutation pair for showing zero amounts as empty cells. */
export function useHideZeroAmountsPreference() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const queryClient = useQueryClient();
  const queryKey = ['hideZeroAmounts', spaceId ?? 'global'] as const;
  const { data: hideZeroAmounts = false, ...queryRest } = useHideZeroAmounts();

  const updateMutation = useMutation<void, Error, boolean, { previous: boolean | undefined }>({
    mutationFn: async (value: boolean) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'userPreferences.setHideZeroAmounts',
        payload: { value },
        meta: { label: 'Update empty zero amounts setting' },
      });
    },
    onMutate: async (value) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<boolean>(queryKey);
      queryClient.setQueryData(queryKey, value);
      return { previous };
    },
    onError: (_error, _value, context) => {
      queryClient.setQueryData(queryKey, context?.previous ?? false);
    },
  });

  return {
    hideZeroAmounts,
    isLoading: queryRest.isLoading,
    updateHideZeroAmounts: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
}

/** Whether the desktop register adds transactions in an inline row. Off by default. */
export function useInlineTransactionEntry() {
  const runtime = useRuntime();
  const runtimeInitialized = useRuntimeInitialized();
  const spaceId = useActiveSpaceId();

  return useQuery<boolean>({
    queryKey: ['inlineTransactionEntry', spaceId ?? 'global'],
    queryFn: async () => {
      const services = runtime.services() as ServicesWithUserMeta;
      return (await services?.userMeta?.getInlineTransactionEntry?.()) ?? false;
    },
    enabled: runtimeInitialized,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Query + mutation pair for inline transaction entry. */
export function useInlineTransactionEntryPreference() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const queryClient = useQueryClient();
  const queryKey = ['inlineTransactionEntry', spaceId ?? 'global'] as const;
  const { data: inlineTransactionEntry = false, ...queryRest } = useInlineTransactionEntry();

  const updateMutation = useMutation<void, Error, boolean, { previous: boolean | undefined }>({
    mutationFn: async (value: boolean) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'userPreferences.setInlineTransactionEntry',
        payload: { value },
        meta: { label: 'Update inline transaction entry setting' },
      });
    },
    onMutate: async (value) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<boolean>(queryKey);
      queryClient.setQueryData(queryKey, value);
      return { previous };
    },
    onError: (_error, _value, context) => {
      queryClient.setQueryData(queryKey, context?.previous ?? false);
    },
  });

  return {
    inlineTransactionEntry,
    isLoading: queryRest.isLoading,
    updateInlineTransactionEntry: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
}

/** Calendar and semantic week-search preference, persisted with the active workspace. */
export function useWeekStartsOnPreference() {
  const runtime = useRuntime();
  const runtimeInitialized = useRuntimeInitialized();
  const spaceId = useActiveSpaceId();
  const query = useQuery<0 | 1>({
    queryKey: ['weekStartsOn', spaceId ?? 'global'],
    queryFn: async () => {
      const services = runtime.services() as ServicesWithUserMeta;
      return (await services.userMeta?.getWeekStartsOn?.()) === 1 ? 1 : 0;
    },
    enabled: runtimeInitialized,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const mutation = useMutation<void, Error, 0 | 1>({
    mutationFn: async (value) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'userPreferences.setWeekStartsOn',
        payload: { value },
        meta: { label: 'Update first day of the week' },
      });
    },
  });

  return {
    weekStartsOn: query.data ?? 0,
    isLoading: !runtimeInitialized || query.isLoading,
    isError: query.isError,
    updateWeekStartsOn: mutation.mutate,
    isUpdating: mutation.isPending,
  };
}

/** Possible-duplicate hint while adding transactions, persisted with the active workspace. */
export function useDuplicateHintSettingsPreference() {
  const runtime = useRuntime();
  const runtimeInitialized = useRuntimeInitialized();
  const spaceId = useActiveSpaceId();
  const query = useQuery<DuplicateHintSettings>({
    queryKey: ['duplicateHintSettings', spaceId ?? 'global'],
    queryFn: async () => {
      const services = runtime.services() as ServicesWithUserMeta;
      return (
        (await services.userMeta?.getDuplicateHintSettings?.()) ?? DEFAULT_DUPLICATE_HINT_SETTINGS
      );
    },
    enabled: runtimeInitialized,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const mutation = useMutation<void, Error, Partial<DuplicateHintSettings>>({
    mutationFn: async (settings) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'userPreferences.setDuplicateHintSettings',
        payload: { settings },
        meta: { label: 'Update duplicate transaction hints' },
      });
    },
  });

  return {
    settings: query.data ?? DEFAULT_DUPLICATE_HINT_SETTINGS,
    isLoading: !runtimeInitialized || query.isLoading,
    isError: query.isError,
    updateSettings: mutation.mutate,
    isUpdating: mutation.isPending,
  };
}
