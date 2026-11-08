import { Trans, useLingui } from '@lingui/react/macro';
import { useId, useState } from 'react';
import { Settings2 } from 'lucide-react';
import {
  MAX_TOP_N,
  normalizeDisplay,
  type QuestionDisplay,
  type ResolvedVisualization,
} from '@features/reports/lib/question';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Switch } from '@shared/ui/switch';
import { displayOptionsFor, hasDisplayOptions } from './viz-meta';

interface ChartSettingsProps {
  visualization: ResolvedVisualization;
  /** The first grouping isn't a date (sorting / top N make sense). */
  categoryAxis: boolean;
  display: QuestionDisplay | undefined;
  onChange: (display: QuestionDisplay | undefined) => void;
}

function parseNumber(text: string): number | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/** "Settings" popover next to the chart type picker; shows only what the chart uses. */
export function ChartSettings({
  visualization,
  categoryAxis,
  display,
  onChange,
}: ChartSettingsProps) {
  const { t } = useLingui();
  const id = useId();
  const options = displayOptionsFor(visualization, categoryAxis);
  const [goalText, setGoalText] = useState(display?.goal?.toString() ?? '');
  const [topNText, setTopNText] = useState(display?.topN?.toString() ?? '');
  if (!hasDisplayOptions(options)) return null;

  const update = (patch: Partial<Record<keyof QuestionDisplay, unknown>>) => {
    const next: Record<string, unknown> = { ...display, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    onChange(normalizeDisplay(next));
  };
  const active = Boolean(display && Object.keys(display).length > 0);

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          setGoalText(display?.goal?.toString() ?? '');
          setTopNText(display?.topN?.toString() ?? '');
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant={active ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 gap-1.5 px-2"
          aria-label={t`Chart settings`}
        >
          <Settings2 className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">
            <Trans>Settings</Trans>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-4 p-4">
        <h3 className="text-sm font-medium">
          <Trans>Chart settings</Trans>
        </h3>
        {options.showValues && (
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${id}-values`} className="text-sm font-normal">
              <Trans>Show values</Trans>
            </Label>
            <Switch
              id={`${id}-values`}
              checked={display?.showValues ?? visualization === 'waterfall'}
              onCheckedChange={(checked) => update({ showValues: checked })}
            />
          </div>
        )}
        {options.goal && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-goal`} className="text-sm font-normal">
              <Trans>Goal line</Trans>
            </Label>
            <Input
              id={`${id}-goal`}
              inputMode="decimal"
              placeholder={t`None`}
              value={goalText}
              onChange={(event) => {
                setGoalText(event.target.value);
                update({ goal: parseNumber(event.target.value) });
              }}
              className="h-8"
            />
          </div>
        )}
        {options.sort && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-sort`} className="text-sm font-normal">
              <Trans>Sort bars</Trans>
            </Label>
            <Select
              value={display?.sort ?? 'none'}
              onValueChange={(value) => update({ sort: value === 'none' ? undefined : value })}
            >
              <SelectTrigger id={`${id}-sort`} className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t`Question order`}</SelectItem>
                <SelectItem value="desc">{t`Largest first`}</SelectItem>
                <SelectItem value="asc">{t`Smallest first`}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {options.topN && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-top`} className="text-sm font-normal">
              <Trans>Show the top</Trans>
            </Label>
            <Input
              id={`${id}-top`}
              type="number"
              min={1}
              max={MAX_TOP_N}
              placeholder={visualization === 'sankey' ? '10' : t`All`}
              value={topNText}
              onChange={(event) => {
                setTopNText(event.target.value);
                update({ topN: parseNumber(event.target.value) });
              }}
              className="h-8"
            />
            <p className="text-xs text-muted-foreground">
              <Trans>The rest are added up as “Other”.</Trans>
            </p>
          </div>
        )}
        {options.dualAxis && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-axis`} className="text-sm font-normal">
              <Trans>Second metric’s axis</Trans>
            </Label>
            <Select
              value={display?.dualAxis === undefined ? 'auto' : display.dualAxis ? 'own' : 'shared'}
              onValueChange={(value) =>
                update({ dualAxis: value === 'auto' ? undefined : value === 'own' })
              }
            >
              <SelectTrigger id={`${id}-axis`} className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t`Automatic (own axis when units differ)`}</SelectItem>
                <SelectItem value="own">{t`Its own axis`}</SelectItem>
                <SelectItem value="shared">{t`Shared with the bars`}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setGoalText('');
              setTopNText('');
              onChange(undefined);
            }}
          >
            <Trans>Reset settings</Trans>
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
