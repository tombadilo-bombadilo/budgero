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

export interface FeedbackBroadcastStatus {
  quarter: string;
  eligible: number;
  alreadySent: number;
  dryRun: boolean;
}

export interface FeedbackBroadcastResult {
  quarter: string;
  eligible: number;
  sent: number;
  failed: number;
  dryRun: boolean;
}

export type AnalyticsGranularity = 'daily' | 'weekly' | 'monthly';

export interface TimeSeriesPoint {
  period: string;
  count: number;
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
  cohort_granularity: AnalyticsGranularity;
  current: StickinessSeriesPoint;
  series: StickinessSeriesPoint[];
  cohorts: CohortRetentionMatrix;
}

/** Weekly active self-host installs: distinct update-check senders per UTC week. */
export interface SelfHostInstallWeek {
  /** Monday of the UTC week, YYYY-MM-DD. */
  week: string;
  installs: number;
  /** The current, still-open week. */
  partial: boolean;
}

export interface SelfHostVersionPing {
  version: string;
  pings: number;
  days: number;
}

export interface SelfHostInstallSummary {
  weeks: SelfHostInstallWeek[];
  versions: SelfHostVersionPing[];
  /** Window, in days, that `versions` covers. */
  days: number;
}

/** Signups per day, week or month over an inclusive UTC date range. */
export interface SignupSeriesPoint {
  /** SQLite strftime label (e.g. 2026-10-29, 2026-W43, 2026-10). */
  period: string;
  /** First day of the bucket inside the range, YYYY-MM-DD. */
  start: string;
  signups: number;
}

export interface SignupSeries {
  from: string;
  to: string;
  granularity: AnalyticsGranularity;
  total: number;
  points: SignupSeriesPoint[];
}
