import { format, parseISO, startOfWeek, endOfWeek, addDays } from 'date-fns';

import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import type { AdminDayCount } from '@features/admin/model/admin-users';
import { EmptyState } from './primitives';

export function ActivityHeatmap({
  days,
  itemLabel,
  note,
}: {
  days: AdminDayCount[];
  itemLabel: string;
  note?: string;
}) {
  if (!days.length) {
    return <EmptyState message="No activity captured for this period." />;
  }

  const parsedDays = days.map((entry) => ({
    ...entry,
    date: parseISO(entry.day),
  }));
  const byDay = new Map(parsedDays.map((entry) => [entry.day, entry]));
  const firstDate = parsedDays[0]?.date;
  const lastDate = parsedDays[parsedDays.length - 1]?.date;

  if (!firstDate || !lastDate) {
    return <EmptyState message="No activity captured for this period." />;
  }

  const weekStart = startOfWeek(firstDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(lastDate, { weekStartsOn: 1 });
  const weeks: { day: string; date: Date; count: number; inRange: boolean }[][] = [];

  for (let cursor = weekStart; cursor <= weekEnd; cursor = addDays(cursor, 7)) {
    const week: { day: string; date: Date; count: number; inRange: boolean }[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const current = addDays(cursor, offset);
      const key = format(current, 'yyyy-MM-dd');
      const dayEntry = byDay.get(key);
      week.push({
        day: key,
        date: current,
        count: dayEntry?.count ?? 0,
        inRange: Boolean(dayEntry),
      });
    }
    weeks.push(week);
  }

  const maxCount = Math.max(...days.map((entry) => entry.count), 0);

  return (
    <div className="space-y-4">
      {note ? (
        <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {note}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-1">
          {weeks.map((week, index) => (
            <div key={`${week[0]?.day}-${index}`} className="grid grid-rows-7 gap-1">
              {week.map((entry) =>
                entry.inRange ? (
                  <Tooltip key={entry.day}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={`h-4 w-4 rounded-[4px] border ${heatmapClass(entry.count, maxCount)}`}
                        aria-label={`${format(entry.date, 'EEEE, MMM d, yyyy')}: ${entry.count} ${itemLabel}${entry.count === 1 ? '' : 's'}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      {format(entry.date, 'EEE, MMM d, yyyy')}: {entry.count} {itemLabel}
                      {entry.count === 1 ? '' : 's'}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div
                    key={entry.day}
                    className="h-4 w-4 rounded-[4px] border border-transparent bg-transparent"
                  />
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{format(firstDate, 'MMM d')}</span>
        <div className="flex items-center gap-2">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className={`h-3 w-3 rounded-[3px] border ${heatmapLegendClass(level)}`}
            />
          ))}
          <span>More</span>
        </div>
        <span>{format(lastDate, 'MMM d')}</span>
      </div>
    </div>
  );
}

function heatmapClass(count: number, maxCount: number) {
  if (count <= 0) return 'border-slate-200 bg-slate-100';
  const intensity = maxCount <= 1 ? 4 : Math.min(4, Math.ceil((count / maxCount) * 4));
  return heatmapLegendClass(intensity);
}

function heatmapLegendClass(level: number) {
  switch (level) {
    case 4:
      return 'border-teal-700/70 bg-teal-700';
    case 3:
      return 'border-teal-600/70 bg-teal-600';
    case 2:
      return 'border-teal-500/70 bg-teal-500';
    case 1:
      return 'border-teal-300/70 bg-teal-300';
    default:
      return 'border-slate-200 bg-slate-100';
  }
}
