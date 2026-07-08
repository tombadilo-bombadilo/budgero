import { format, parseISO } from 'date-fns';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
} from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import type { AdminUserDetails } from '@features/admin/model/admin-users';
import { TabSection } from './TabSection';
import { CompactMetric, EmptyState, SectionError } from './primitives';

export function MutationsTab({
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
          <CardTitle>Mutation KPIs</CardTitle>
          <CardDescription>
            All-time totals with a daily activity view for the current window.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <CompactMetric
            label="All-Time Mutations"
            value={`${details?.mutations.totalMutations ?? 0}`}
          />
          <CompactMetric label="Active Days" value={`${details?.mutations.activeDays ?? 0}`} />
          <CompactMetric
            label="Avg / Active Day"
            value={(details?.mutations.avgPerActiveDay ?? 0).toFixed(1)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mutations Per Day</CardTitle>
          <CardDescription>
            Daily mutation counts over the same{' '}
            {details?.activity?.windowDays ?? details?.mutations.days?.length ?? 365}-day window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SectionError message={details?.sectionErrors?.mutations} />
          {details?.mutations.days?.some((entry) => entry.count > 0) ? (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={details.mutations.days}
                  margin={{ top: 12, right: 12, left: -12, bottom: 12 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(value) => format(parseISO(value), 'MMM d')}
                    minTickGap={28}
                  />
                  <ChartTooltip
                    labelFormatter={(value) => format(parseISO(String(value)), 'MMM d, yyyy')}
                    formatter={(value: number) => [`${value} mutations`, 'Count']}
                  />
                  <Bar dataKey="count" fill="#0f766e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState message="No mutation activity in the current window." />
          )}
        </CardContent>
      </Card>
    </TabSection>
  );
}
