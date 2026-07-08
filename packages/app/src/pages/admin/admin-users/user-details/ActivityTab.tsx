import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import type { AdminUserDetails } from '@features/admin/model/admin-users';
import { TabSection } from './TabSection';
import { ActivityHeatmap } from './ActivityHeatmap';
import { CompactMetric, EmptyState, SectionError, formatOptionalDate } from './primitives';

export function ActivityTab({
  details,
  loading,
  error,
  onRetry,
}: {
  details: AdminUserDetails | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <TabSection loading={loading} error={error} onRetry={onRetry}>
      <Card>
        <CardHeader>
          <CardTitle>App Activity</CardTitle>
          <CardDescription>
            Heartbeat-backed app usage across the last {details?.appActivity?.windowDays ?? 365}{' '}
            days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SectionError message={details?.sectionErrors?.appActivity} />
          <div className="grid gap-3 sm:grid-cols-3">
            <CompactMetric
              label="Heartbeats In Window"
              value={`${details?.appActivity?.totalHeartbeats ?? 0}`}
            />
            <CompactMetric label="Active Days" value={`${details?.appActivity?.activeDays ?? 0}`} />
            <CompactMetric
              label="Last Seen"
              value={formatOptionalDate(details?.appActivity?.lastSeenAt, 'MMM d, yyyy HH:mm')}
            />
          </div>
          {details?.appActivity ? (
            <ActivityHeatmap
              days={details.appActivity.days}
              itemLabel="heartbeat"
              note="Each day bucket is backed by Budgero SaaS heartbeat writes, not Clerk session metadata."
            />
          ) : (
            <EmptyState message="No app heartbeat activity available yet." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clerk Session Activity</CardTitle>
          <CardDescription>
            Session-derived auth activity estimated from Clerk session ranges across the last{' '}
            {details?.activity?.windowDays ?? 365} days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SectionError message={details?.sectionErrors?.activity} />
          <div className="grid gap-3 sm:grid-cols-3">
            <CompactMetric
              label="Sessions In Window"
              value={`${details?.activity?.totalSessions ?? 0}`}
            />
            <CompactMetric label="Active Days" value={`${details?.activity?.activeDays ?? 0}`} />
            <CompactMetric
              label="Last Active"
              value={formatOptionalDate(details?.activity?.lastActiveAt, 'MMM d, yyyy HH:mm')}
            />
          </div>
          {details?.activity ? (
            <ActivityHeatmap
              days={details.activity.days}
              itemLabel="session"
              note="This view is derived from Clerk session lifetimes by spanning creation to last known activity, and to expiry for expired sessions."
            />
          ) : (
            <EmptyState message="No Clerk session activity available." />
          )}
        </CardContent>
      </Card>
    </TabSection>
  );
}
