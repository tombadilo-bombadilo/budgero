import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRuntime } from '@shared/runtime/runtime-provider';
import type {
  CustomDashboard,
  CustomDashboardWidget,
  CustomDashboardWithWidgets,
  DesktopWidgetLayout,
  MobileWidgetLayout,
} from '@budgero/core/browser';

const CUSTOM_DASHBOARDS_QUERY_KEY = 'customDashboards';
const CUSTOM_DASHBOARD_QUERY_KEY = 'customDashboard';

export function useCustomDashboards(budgetId: number) {
  const runtime = useRuntime();
  return useQuery<CustomDashboard[]>({
    queryKey: [CUSTOM_DASHBOARDS_QUERY_KEY, budgetId],
    queryFn: async () => {
      if (!budgetId) return [];
      return await runtime.services().customDashboards.getDashboards(budgetId);
    },
    enabled: budgetId > 0,
  });
}

export function useCustomDashboard(dashboardId: string | null | undefined) {
  const runtime = useRuntime();
  return useQuery<CustomDashboardWithWidgets | null>({
    queryKey: [CUSTOM_DASHBOARD_QUERY_KEY, dashboardId],
    queryFn: async () => {
      if (!dashboardId) return null;
      return await runtime.services().customDashboards.getDashboard(dashboardId);
    },
    enabled: Boolean(dashboardId),
  });
}

export function useCreateCustomDashboard() {
  const runtime = useRuntime();
  return useMutation<CustomDashboard, Error, { budgetId: number; name: string }>({
    mutationFn: async (data) => {
      const { result } = await runtime.mutationsRouter().execute<CustomDashboard>({
        op: 'customDashboards.create',
        payload: data,
        meta: { label: 'useCreateCustomDashboard' },
      });
      return result;
    },
  });
}

export function useUpdateCustomDashboard() {
  const runtime = useRuntime();
  return useMutation<
    CustomDashboard,
    Error,
    { id: string; budgetId: number; name?: string; sortOrder?: number }
  >({
    mutationFn: async (data) => {
      const { result } = await runtime.mutationsRouter().execute<CustomDashboard>({
        op: 'customDashboards.update',
        payload: {
          id: data.id,
          name: data.name,
          sortOrder: data.sortOrder,
        },
        meta: { label: 'useUpdateCustomDashboard' },
      });
      return result;
    },
  });
}

export function useDeleteCustomDashboard() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string; budgetId: number }>({
    mutationFn: async ({ id }) => {
      await runtime.mutationsRouter().execute<void>({
        op: 'customDashboards.delete',
        payload: { id },
        meta: { label: 'useDeleteCustomDashboard' },
      });
    },
    onSuccess: (_, variables) => {
      // Invalidation is executor-driven (customDashboards.delete invalidates).
      // Still drop the deleted dashboard's cached detail entry.
      queryClient.removeQueries({ queryKey: [CUSTOM_DASHBOARD_QUERY_KEY, variables.id] });
    },
  });
}

export function useAddDashboardWidget() {
  const runtime = useRuntime();
  return useMutation<
    CustomDashboardWithWidgets,
    Error,
    {
      dashboardId: string;
      reportId: string;
      chartId: string;
      desktopLayout?: DesktopWidgetLayout;
      mobileLayout?: MobileWidgetLayout;
      titleOverride?: string;
    }
  >({
    mutationFn: async (data) => {
      const { result } = await runtime.mutationsRouter().execute<CustomDashboardWithWidgets>({
        op: 'customDashboardWidgets.add',
        payload: data,
        meta: { label: 'useAddDashboardWidget' },
      });
      return result;
    },
  });
}

export function useUpdateDashboardWidget() {
  const runtime = useRuntime();
  return useMutation<
    CustomDashboardWidget,
    Error,
    {
      id: string;
      dashboardId: string;
      reportId?: string;
      chartId?: string;
      desktopLayout?: DesktopWidgetLayout;
      mobileLayout?: MobileWidgetLayout;
      sortOrder?: number;
      titleOverride?: string | null;
    }
  >({
    mutationFn: async (data) => {
      const { result } = await runtime.mutationsRouter().execute<CustomDashboardWidget>({
        op: 'customDashboardWidgets.update',
        payload: {
          id: data.id,
          reportId: data.reportId,
          chartId: data.chartId,
          desktopLayout: data.desktopLayout,
          mobileLayout: data.mobileLayout,
          sortOrder: data.sortOrder,
          titleOverride: data.titleOverride,
        },
        meta: { label: 'useUpdateDashboardWidget' },
      });
      return result;
    },
  });
}

export function useDeleteDashboardWidget() {
  const runtime = useRuntime();
  return useMutation<void, Error, { id: string; dashboardId: string }>({
    mutationFn: async ({ id }) => {
      await runtime.mutationsRouter().execute<void>({
        op: 'customDashboardWidgets.delete',
        payload: { id },
        meta: { label: 'useDeleteDashboardWidget' },
      });
    },
  });
}

export function useReorderDashboardWidgets() {
  const runtime = useRuntime();
  return useMutation<void, Error, { dashboardId: string; orderedIds: string[] }>({
    mutationFn: async (data) => {
      await runtime.mutationsRouter().execute<void>({
        op: 'customDashboardWidgets.reorder',
        payload: data,
        meta: { label: 'useReorderDashboardWidgets' },
      });
    },
  });
}
