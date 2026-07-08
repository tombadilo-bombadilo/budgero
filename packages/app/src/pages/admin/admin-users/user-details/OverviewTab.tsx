import { Copy } from 'lucide-react';

import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import type { AdminUserDetails, User } from '@features/admin/model/admin-users';
import { TabSection } from './TabSection';
import { ActivityHeatmap } from './ActivityHeatmap';
import {
  CompactMetric,
  EmptyState,
  KeyValue,
  SectionError,
  formatDate,
  formatOptionalDate,
} from './primitives';

export function OverviewTab({
  resolvedUser,
  details,
  loading,
  error,
  onRetry,
  onCopyId,
}: {
  resolvedUser: User;
  details: AdminUserDetails | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onCopyId: (userId: string) => void;
}) {
  return (
    <TabSection loading={loading} error={error} onRetry={onRetry}>
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>Core account and entitlement metadata.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <KeyValue
            label="User ID"
            value={
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 text-xs">{resolvedUser.id}</code>
                <Button size="sm" variant="ghost" onClick={() => onCopyId(resolvedUser.id)}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            }
          />
          <KeyValue
            label="Subscription Status"
            value={resolvedUser.subscription_status || 'inactive'}
          />
          <KeyValue label="Customer ID" value={resolvedUser.customer_id || 'None'} />
          <KeyValue label="Subscription ID" value={resolvedUser.subscription_id || 'None'} />
          <KeyValue
            label="Trial Ends"
            value={formatOptionalDate(resolvedUser.trial_ends_at, 'MMM d, yyyy')}
          />
          <KeyValue
            label="Current Period End"
            value={formatOptionalDate(resolvedUser.current_period_end, 'MMM d, yyyy')}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent App Activity Snapshot</CardTitle>
            <CardDescription>
              Daily app heartbeats captured over the last {details?.appActivity?.windowDays ?? 365}{' '}
              days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SectionError message={details?.sectionErrors?.appActivity} />
            {details?.appActivity ? (
              <ActivityHeatmap
                days={details.appActivity.days}
                itemLabel="heartbeat"
                note="Each colored square is a UTC day with accepted app heartbeats from the SaaS client."
              />
            ) : (
              <EmptyState message="No app heartbeat activity available yet." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mutation Snapshot</CardTitle>
            <CardDescription>Write activity from the mutation log.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SectionError message={details?.sectionErrors?.mutations} />
            <div className="grid gap-3 sm:grid-cols-2">
              <CompactMetric label="Active Days" value={`${details?.mutations.activeDays ?? 0}`} />
              <CompactMetric
                label="Avg / Active Day"
                value={(details?.mutations.avgPerActiveDay ?? 0).toFixed(1)}
              />
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Last Mutation
              </div>
              {details?.mutations.lastMutation ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="font-medium">
                    {details.mutations.lastMutation.op || 'Mutation'} v
                    {details.mutations.lastMutation.version}
                  </div>
                  <div className="text-muted-foreground">
                    Space {details.mutations.lastMutation.spaceId}
                  </div>
                  <div>
                    {formatDate(details.mutations.lastMutation.timestamp, 'MMM d, yyyy HH:mm')}
                  </div>
                </div>
              ) : (
                <EmptyState message="No mutations recorded for this user." compact />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </TabSection>
  );
}
