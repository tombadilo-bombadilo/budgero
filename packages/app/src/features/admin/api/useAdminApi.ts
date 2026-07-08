import { useMemo } from 'react';
import { useApiClient } from '@shared/hooks/useApiClient';
import { buildDatabaseTableUrl } from '@features/admin/api/database-table-url';
import type {
  DatabaseTableSummary,
  DatabaseTableDataResponse,
  DatabaseTableQueryOptions,
  UpdateDatabaseRowRequest,
  UpdateDatabaseRowResponse,
  AdminQueryResult,
} from '@features/admin/model/admin-database';
import type { SelfHostAdminStats, SelfHostAdminUser } from '@features/admin/model/admin-self-host';
import type { AdminUserDetails } from '@features/admin/model/admin-users';
import type {
  AdminStats,
  ClerkSyncResult,
  MailerLiteSyncResult,
  RewardsAnalytics,
  RewardsAnalyticsGranularity,
  StickinessAnalytics,
} from '@features/admin/model/admin-dashboard';

// Admin ad-hoc SQL can scan large tables; give it more room than the 15s
// default rather than letting long queries abort mid-flight.
const ADMIN_QUERY_TIMEOUT_MS = 120_000;

export function useAdminApi() {
  const apiClient = useApiClient();

  return useMemo(
    () => ({
      getStats: () => apiClient.get<AdminStats>('/admin/stats'),

      getUsers: () => apiClient.get('/admin/users'),
      getUser: (userId: string) => apiClient.get(`/admin/users/${userId}`),
      getUserDetails: (userId: string, windowDays = 365) =>
        apiClient.get<AdminUserDetails>(`/admin/users/${userId}/details?windowDays=${windowDays}`),
      grantFoundingMember: (userId: string) =>
        apiClient.post(`/admin/users/${userId}/founding-member`),
      grantBetaAccess: (userId: string, days: number) =>
        apiClient.post(`/admin/users/${userId}/beta-access`, { days }),
      revokeAccess: (userId: string) => apiClient.post(`/admin/users/${userId}/revoke-access`),
      makeAdmin: (userId: string) => apiClient.post(`/admin/users/${userId}/make-admin`),
      resetUserData: (userId: string) => apiClient.post(`/admin/users/${userId}/reset-data`),
      blockUser: (userId: string) => apiClient.post(`/admin/users/${userId}/block`),
      unblockUser: (userId: string) => apiClient.post(`/admin/users/${userId}/unblock`),

      getSelfHostStats: () => apiClient.get<SelfHostAdminStats>('/admin/selfhost/stats'),
      getSelfHostUsers: () => apiClient.get<SelfHostAdminUser[]>('/admin/selfhost/users'),
      createSelfHostUser: (email: string, name: string, password: string, isAdmin: boolean) =>
        apiClient.post('/admin/selfhost/users', { email, name, password, isAdmin }),
      resetSelfHostPassword: (userId: string, password: string) =>
        apiClient.post(`/admin/selfhost/users/${userId}/reset-password`, { password }),
      deleteSelfHostUser: (userId: string) => apiClient.delete(`/admin/selfhost/users/${userId}`),
      // Full-database download has no natural upper bound — disable the timeout.
      downloadSelfHostDatabase: () =>
        apiClient.downloadBinary('/admin/selfhost/database/download', undefined, 0),

      syncClerkUsers: () => apiClient.post<ClerkSyncResult>('/admin/sync/clerk'),
      syncMailerLite: () => apiClient.post<MailerLiteSyncResult>('/admin/sync/mailerlite'),
      syncLemonSqueezy: () => apiClient.post('/admin/sync/lemonsqueezy'),

      // Rewards analytics (SaaS only)
      getRewardsAnalytics: (from: string, to: string, granularity: RewardsAnalyticsGranularity) => {
        const params = new URLSearchParams({ from, to, granularity });
        return apiClient.get<RewardsAnalytics>(`/admin/rewards/analytics?${params.toString()}`);
      },

      // Stickiness analytics: DAU/MAU + signup-cohort retention (SaaS only)
      getStickinessAnalytics: (
        from: string,
        to: string,
        cohort: RewardsAnalyticsGranularity,
        maxDayN: number
      ) => {
        const params = new URLSearchParams({
          from,
          to,
          cohort,
          max_day_n: String(maxDayN),
        });
        return apiClient.get<StickinessAnalytics>(`/admin/stickiness?${params.toString()}`);
      },

      getDatabaseTables: () => apiClient.get<DatabaseTableSummary[]>('/admin/database/tables'),
      getSavedQueries: () =>
        apiClient.get<
          { id: number; name: string; query: string; createdAt: string; updatedAt: string }[]
        >('/admin/database/queries'),
      saveQuery: (name: string, query: string) =>
        apiClient.post<{ success: boolean; id?: number; name: string }>('/admin/database/queries', {
          name,
          query,
        }),
      deleteSavedQuery: (name: string) =>
        apiClient.delete(`/admin/database/queries/${encodeURIComponent(name)}`),
      getDatabaseTableData: (tableName: string, options: DatabaseTableQueryOptions = {}) =>
        apiClient.get<DatabaseTableDataResponse>(buildDatabaseTableUrl(tableName, options)),
      updateDatabaseRow: (tableName: string, payload: UpdateDatabaseRowRequest) =>
        apiClient.put<UpdateDatabaseRowResponse>(
          `/admin/database/tables/${encodeURIComponent(tableName)}/row`,
          payload
        ),
      runDatabaseQuery: (query: string) =>
        apiClient.post<AdminQueryResult>(
          '/admin/database/query',
          { query },
          ADMIN_QUERY_TIMEOUT_MS
        ),
    }),
    [apiClient]
  );
}
