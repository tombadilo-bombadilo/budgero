import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Activity, Users } from 'lucide-react';
import { useAdminApi } from '@features/admin/api/useAdminApi';
import type {
  StickinessAnalytics,
  CohortRetentionCell,
  RewardsAnalyticsGranularity,
} from '@features/admin/model/admin-dashboard';
import { dateInputToISO } from './admin-analytics.utils';
import { useAnalyticsQuery } from './useAnalyticsQuery';

/** Format ratio in [0,1] as a percentage with one decimal. */
function pct(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}

/**
 * Map a retention ratio in [0, 1] to a Tailwind background class.
 * Cool→warm gradient that mirrors classic retention heatmaps; pure CSS so
 * we don't have to ship a colour scale dep just for this surface.
 */
function retentionShade(r: number, hasData: boolean): string {
  if (!hasData) return 'bg-muted/30 text-muted-foreground';
  if (r >= 0.8) return 'bg-emerald-600 text-white';
  if (r >= 0.6) return 'bg-emerald-500 text-white';
  if (r >= 0.4) return 'bg-emerald-400 text-emerald-950';
  if (r >= 0.25) return 'bg-amber-300 text-amber-950';
  if (r >= 0.1) return 'bg-amber-200 text-amber-950';
  if (r > 0) return 'bg-rose-200 text-rose-950';
  return 'bg-muted/40 text-muted-foreground';
}

/**
 * Pick the day-N columns to show in the heatmap. Up to 14 columns total —
 * dense in the first two weeks where retention drop-offs cluster, sparse
 * thereafter so the matrix stays readable when MaxDayN is 90.
 */
function pickDayColumns(maxDayN: number): number[] {
  const cols: number[] = [];
  const dense = [0, 1, 2, 3, 4, 5, 6, 7, 14];
  for (const n of dense) {
    if (n <= maxDayN) cols.push(n);
  }
  for (const n of [21, 30, 45, 60, 90]) {
    if (n <= maxDayN && !cols.includes(n)) cols.push(n);
  }
  return cols;
}

interface RetentionLookup {
  /** lookup[`${cohort}|${day_n}`] = cell. */
  byKey: Map<string, CohortRetentionCell>;
}

function indexCells(cells: CohortRetentionCell[]): RetentionLookup {
  const byKey = new Map<string, CohortRetentionCell>();
  for (const c of cells) byKey.set(`${c.cohort}|${c.day_n}`, c);
  return { byKey };
}

export default function StickinessAnalyticsSection() {
  const adminApi = useAdminApi();

  const [cohort, setCohort] = useState<RewardsAnalyticsGranularity>('weekly');
  const [maxDayN, setMaxDayN] = useState<number>(30);

  // Default range: last 90 days, weekly cohorts. After mount the user re-runs
  // the query via the Refresh button (which reads the live state).
  const { from, setFrom, to, setTo, data, loading, fetchData } = useAnalyticsQuery<
    StickinessAnalytics,
    [RewardsAnalyticsGranularity, number]
  >({
    defaultDaysBack: 90,
    errorMessage: 'Failed to load stickiness analytics',
    initialArgs: ['weekly', 30],
    fetcher: (f, t, g, n) =>
      adminApi.getStickinessAnalytics(dateInputToISO(f), dateInputToISO(t), g, n),
  });

  const dayColumns = useMemo(() => pickDayColumns(maxDayN), [maxDayN]);
  const lookup = useMemo(() => indexCells(data?.cohorts.cells ?? []), [data]);

  const series = data?.series ?? [];
  const current = data?.current;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-blue-500" />
          Stickiness & retention
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="space-y-1.5">
            <Label htmlFor="stickiness-from">From</Label>
            <Input
              id="stickiness-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stickiness-to">To</Label>
            <Input
              id="stickiness-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Cohort bucket</Label>
            <Select
              value={cohort}
              onValueChange={(v) => setCohort(v as RewardsAnalyticsGranularity)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stickiness-maxn">Day-N window</Label>
            <Select value={String(maxDayN)} onValueChange={(v) => setMaxDayN(Number(v))}>
              <SelectTrigger id="stickiness-maxn">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void fetchData(from, to, cohort, maxDayN)} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>

        {/* Headline DAU/MAU + sparkline */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="h-4 w-4" />
                Current DAU/MAU
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-semibold tabular-nums">
                {current ? pct(current.stickiness) : '—'}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {current
                  ? `${current.dau.toLocaleString()} active today / ${current.mau.toLocaleString()} active in last 30 days`
                  : 'No data yet'}
              </p>
              <div className="mt-3 text-xs text-muted-foreground space-y-0.5">
                <p>&lt;10% — low engagement</p>
                <p>10–20% — typical SaaS</p>
                <p>20–50% — strong</p>
                <p>50%+ — exceptional</p>
              </div>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Stickiness over time
              </CardTitle>
            </CardHeader>
            <CardContent>
              {series.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity in the selected window.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={series.map((p) => ({ ...p, ratioPct: p.stickiness * 100 }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    />
                    <Tooltip
                      formatter={(v: number, name: string) =>
                        name === 'ratioPct' ? `${v.toFixed(1)}%` : v
                      }
                      labelFormatter={(label: string) => `Day ${label}`}
                    />
                    <Line
                      type="monotone"
                      dataKey="ratioPct"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                      name="DAU/MAU"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Cohort retention heatmap */}
        <div>
          <h3 className="text-sm font-medium mb-2">Cohort retention</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Each row is a signup cohort. Cells show the % of that cohort active on day N after
            signup. Look for cliffs (every cohort drops at the same day) and cross-cohort drift
            (recent cohorts retaining better or worse than older ones). Daily cohorts are noisy at
            low signup volume — switch to weekly if rows look jagged.
          </p>
          {(data?.cohorts.cohorts.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No cohorts in the selected window.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left p-2 font-medium sticky left-0 bg-background">
                      Cohort
                    </th>
                    <th className="text-right p-2 font-medium">Size</th>
                    {dayColumns.map((n) => (
                      <th key={n} className="text-center p-2 font-medium tabular-nums">
                        D{n}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.cohorts.cohorts ?? []).map((c) => (
                    <tr key={c.cohort} className="border-t border-border/50">
                      <td className="p-2 font-mono sticky left-0 bg-background">{c.cohort}</td>
                      <td className="p-2 text-right tabular-nums text-muted-foreground">
                        {c.size}
                      </td>
                      {dayColumns.map((n) => {
                        const cell = lookup.byKey.get(`${c.cohort}|${n}`);
                        const r = cell?.retention ?? 0;
                        return (
                          <td
                            key={n}
                            className={`p-2 text-center font-medium tabular-nums ${retentionShade(
                              r,
                              !!cell
                            )}`}
                            title={
                              cell
                                ? `${cell.active}/${cell.cohort_size} active on day ${n}`
                                : 'No data'
                            }
                          >
                            {cell ? pct(r) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
