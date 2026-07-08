export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  trialUsers: number;
  paidUsers: number;
  betaUsers: number;
  foundingMembers: number;
  totalRevenue: number;
  mrr: number;
  recentActivity: {
    id: string;
    type: string;
    user: string;
    timestamp: string;
    details: string;
  }[];
}

export interface ClerkSyncResult {
  Synced: number;
  Created: number;
  Migrated: number;
  Updated: number;
}

export interface MailerLiteSyncResult {
  totalClerkUsers: number;
  attempted: number;
  subscribed: number;
  alreadySubscribed: number;
  skipped: number;
  failed: number;
}

export type RewardsAnalyticsGranularity = 'daily' | 'weekly' | 'monthly';

export interface TimeSeriesPoint {
  period: string;
  count: number;
}

export interface RewardsAnalyticsSeries {
  signups: TimeSeriesPoint[];
  subscriptions: TimeSeriesPoint[];
  tier1_unlocks: TimeSeriesPoint[];
  tier2_unlocks: TimeSeriesPoint[];
  tier3_unlocks: TimeSeriesPoint[];
  redemptions: TimeSeriesPoint[];
}

export interface FunnelCohort {
  cohort: string;
  signups: number;
  tier1: number;
  tier2: number;
  tier3: number;
  subscribed: number;
}

export interface RewardsAnalytics {
  granularity: RewardsAnalyticsGranularity;
  from: string;
  to: string;
  series: RewardsAnalyticsSeries;
  funnel: FunnelCohort[];
}

export interface StickinessSeriesPoint {
  day: string;
  dau: number;
  mau: number;
  /** DAU/MAU; 0 when MAU is 0. */
  stickiness: number;
}

export interface CohortRetentionCell {
  cohort: string;
  day_n: number;
  active: number;
  cohort_size: number;
  /** active / cohort_size in [0, 1]. */
  retention: number;
}

export interface CohortMeta {
  cohort: string;
  size: number;
}

export interface CohortRetentionMatrix {
  cells: CohortRetentionCell[];
  cohorts: CohortMeta[];
  max_day_n: number;
}

export interface StickinessAnalytics {
  from: string;
  to: string;
  cohort_granularity: RewardsAnalyticsGranularity;
  current: StickinessSeriesPoint;
  series: StickinessSeriesPoint[];
  cohorts: CohortRetentionMatrix;
}
