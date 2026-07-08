/**
 * React Query hooks for unified reports management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import type { UnifiedReport, ChartConfiguration } from '@budgero/core/browser';

/**
 * Get all reports
 */
export function useReports() {
  const runtime = useRuntime();
  return useQuery({
    queryKey: ['reports'],
    queryFn: async () => {
      const services = runtime.services();
      return await services.reports.getReports();
    },
  });
}

/**
 * Create a new report
 */
export function useCreateReport() {
  const runtime = useRuntime();

  type CreateReportData = {
    name: string;
    description?: string;
    query: string;
    charts?: Omit<ChartConfiguration, 'id'>[];
    tags?: string[];
    isFavorite?: boolean;
  };

  return useMutation<UnifiedReport, Error, CreateReportData>({
    mutationFn: async (data: CreateReportData) => {
      return executeSpaceMutation<UnifiedReport>(runtime, {
        op: 'reports.create',
        payload: data,
        meta: { label: 'useCreateReport' },
      });
    },
  });
}

/**
 * Update an existing report
 */
export function useUpdateReport() {
  const runtime = useRuntime();

  return useMutation<
    UnifiedReport,
    Error,
    {
      id: string;
      name?: string;
      description?: string;
      query?: string;
      charts?: ChartConfiguration[];
      tags?: string[];
      isFavorite?: boolean;
    }
  >({
    mutationFn: async (data: {
      id: string;
      name?: string;
      description?: string;
      query?: string;
      charts?: ChartConfiguration[];
      tags?: string[];
      isFavorite?: boolean;
    }) => {
      return executeSpaceMutation<UnifiedReport>(runtime, {
        op: 'reports.update',
        payload: data,
        meta: { label: 'useUpdateReport' },
      });
    },
  });
}

/**
 * Delete a report
 */
export function useDeleteReport() {
  const queryClient = useQueryClient();
  const runtime = useRuntime();

  return useMutation<void, Error, string>({
    mutationFn: async (id: string) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'reports.delete',
        payload: { id },
        meta: { label: 'useDeleteReport' },
      });
    },
    onSuccess: (_, id) => {
      // Invalidation is executor-driven (reports.delete invalidates). Still drop
      // the deleted report's cached detail entry so it isn't refetched.
      queryClient.removeQueries({ queryKey: ['report', id] });
    },
  });
}

/**
 * Toggle report favorite status
 */
export function useToggleReportFavorite() {
  const runtime = useRuntime();

  return useMutation<UnifiedReport, Error, string>({
    mutationFn: async (id: string) => {
      return executeSpaceMutation<UnifiedReport>(runtime, {
        op: 'reports.toggleFavorite',
        payload: { id },
        meta: { label: 'useToggleReportFavorite' },
      });
    },
  });
}

/**
 * Add chart to existing report
 */
export function useAddChartToReport() {
  const runtime = useRuntime();

  type AddChartData = {
    reportId: string;
    chart: Omit<ChartConfiguration, 'id'>;
  };

  return useMutation<UnifiedReport, Error, AddChartData>({
    mutationFn: async (data: AddChartData) => {
      return executeSpaceMutation<UnifiedReport>(runtime, {
        op: 'reports.addChart',
        payload: data,
        meta: { label: 'useAddChartToReport' },
      });
    },
  });
}

/**
 * Update chart in report
 */
export function useUpdateChartInReport() {
  const runtime = useRuntime();

  type UpdateChartData = {
    reportId: string;
    chartId: string;
    updates: Partial<ChartConfiguration>;
  };

  return useMutation<UnifiedReport, Error, UpdateChartData>({
    mutationFn: async (data: UpdateChartData) => {
      return executeSpaceMutation<UnifiedReport>(runtime, {
        op: 'reports.updateChart',
        payload: data,
        meta: { label: 'useUpdateChartInReport' },
      });
    },
  });
}

/**
 * Remove chart from report
 */
export function useRemoveChartFromReport() {
  const runtime = useRuntime();

  type RemoveChartData = {
    reportId: string;
    chartId: string;
  };

  return useMutation<UnifiedReport, Error, RemoveChartData>({
    mutationFn: async (data: RemoveChartData) => {
      return executeSpaceMutation<UnifiedReport>(runtime, {
        op: 'reports.removeChart',
        payload: data,
        meta: { label: 'useRemoveChartFromReport' },
      });
    },
  });
}

/**
 * Duplicate a report
 */
export function useDuplicateReport() {
  const runtime = useRuntime();

  type DuplicateReportData = {
    id: string;
    newName: string;
  };

  return useMutation<UnifiedReport, Error, DuplicateReportData>({
    mutationFn: async (data: DuplicateReportData) => {
      return executeSpaceMutation<UnifiedReport>(runtime, {
        op: 'reports.duplicate',
        payload: data,
        meta: { label: 'useDuplicateReport' },
      });
    },
  });
}
