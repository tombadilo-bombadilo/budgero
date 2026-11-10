import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { CustomDashboard, UnifiedReport } from '@budgero/core/browser';
import { useAddChartToReport } from '@entities/report/api/useReports';
import { SOLID_OVERLAY } from '@features/reports/ui/notebook/ResponsivePicker';
import { useAsyncDialogAction } from '@shared/hooks/useAsyncDialogAction';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { chartChoiceLabel, questionChoices, rowsTableChart } from './question-choices';

export interface DashboardPick {
  dashboardId: string;
  reportId: string;
  chartId: string;
  titleOverride?: string;
}

interface AddToDashboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Saved questions to choose from; with `question` set, only that one is used. */
  questions: UnifiedReport[];
  /** From a question's page: the question is given, the dashboard is chosen. */
  question?: UnifiedReport | null;
  dashboards: CustomDashboard[];
  /** From a dashboard: the dashboard is given, the question is chosen. */
  dashboardId?: string | null;
  defaultQuestionId?: string | null;
  defaultChartId?: string | null;
  /** Offer a custom title (adding); off when swapping a card's question. */
  withTitle?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCreateDashboard?: () => Promise<void>;
  onSubmit: (pick: DashboardPick) => Promise<void>;
}

/**
 * One picker for putting a question on a dashboard: from a dashboard it lists
 * the saved questions (like the Reports home), from a question it lists the
 * dashboards. A second "which chart" choice only shows for an SQL question
 * that has more than one.
 */
export function AddToDashboardDialog(props: AddToDashboardDialogProps) {
  // Fresh choices every time it opens.
  return props.open ? <AddToDashboardForm {...props} /> : null;
}

function AddToDashboardForm({
  open,
  onOpenChange,
  questions,
  question,
  dashboards,
  dashboardId,
  defaultQuestionId,
  defaultChartId,
  withTitle = true,
  title,
  description,
  confirmLabel,
  onCreateDashboard,
  onSubmit,
}: AddToDashboardDialogProps) {
  const { t } = useLingui();
  const addChart = useAddChartToReport();
  const choices = useMemo(
    () => questionChoices(question ? [question] : questions),
    [question, questions]
  );
  const [questionId, setQuestionId] = useState(
    question?.id ?? defaultQuestionId ?? choices[0]?.report.id ?? ''
  );
  const choice = choices.find((item) => item.report.id === questionId) ?? null;
  const [chartChoice, setChartChoice] = useState(defaultChartId ?? '');
  const chartId =
    choice?.charts.find((chart) => chart.id === chartChoice)?.id ?? choice?.charts[0]?.id ?? '';
  const [dashboardChoice, setTargetDashboardId] = useState(dashboardId ?? '');
  // Dashboards may arrive (or be created) after the dialog opened.
  const targetDashboardId =
    dashboards.find((dashboard) => dashboard.id === dashboardChoice)?.id ??
    dashboardId ??
    dashboards[0]?.id ??
    '';
  const [customTitle, setCustomTitle] = useState('');
  const submit = useAsyncDialogAction({
    errorMessage: t`Could not add the question to the dashboard`,
    onSuccess: () => onOpenChange(false),
  });
  const creating = useAsyncDialogAction({ errorMessage: t`Could not create the dashboard` });

  const noDashboards = !dashboardId && dashboards.length === 0;
  const noQuestions = choices.length === 0;
  const pickDashboard = !dashboardId;

  const handleSubmit = async () => {
    if (!choice || !targetDashboardId) return;
    await submit.run(async () => {
      let id = chartId;
      if (!id) {
        // An SQL question saved without a chart shows its rows as a table.
        const updated = await addChart.mutateAsync({
          reportId: choice.report.id,
          chart: rowsTableChart(),
        });
        id = updated.charts.at(-1)?.id ?? '';
      }
      if (!id) throw new Error('No chart to show');
      await onSubmit({
        dashboardId: targetDashboardId,
        reportId: choice.report.id,
        chartId: id,
        ...(withTitle && customTitle.trim() ? { titleOverride: customTitle.trim() } : {}),
      });
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,44rem)] w-[95vw] flex-col sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {noQuestions || noDashboards ? (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            {noQuestions && (
              <p>
                <Trans>Save a question under Reports first.</Trans>
              </p>
            )}
            {noDashboards && (
              <p>
                <Trans>Create a dashboard first.</Trans>
              </p>
            )}
            {noDashboards && onCreateDashboard && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void creating.run(onCreateDashboard)}
                disabled={creating.isRunning}
              >
                {creating.isRunning ? t`Creating...` : t`Create "My Dashboard"`}
              </Button>
            )}
          </div>
        ) : (
          <div className="min-h-0 space-y-4 overflow-y-auto">
            {pickDashboard && (
              <div className="space-y-2">
                <Label htmlFor="add-to-dashboard-target">
                  <Trans>Dashboard</Trans>
                </Label>
                <Select value={targetDashboardId} onValueChange={setTargetDashboardId}>
                  <SelectTrigger id="add-to-dashboard-target" className="w-full">
                    <SelectValue placeholder={t`Select dashboard`} />
                  </SelectTrigger>
                  <SelectContent className={SOLID_OVERLAY}>
                    {dashboards.map((dashboard) => (
                      <SelectItem key={dashboard.id} value={dashboard.id}>
                        {dashboard.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!question && (
              <div className="space-y-2">
                <Label>
                  <Trans>Question</Trans>
                </Label>
                <Command className="rounded-md border">
                  <CommandInput
                    placeholder={t`Search questions…`}
                    aria-label={t`Search questions`}
                  />
                  <CommandList className="max-h-[min(18rem,40dvh)]">
                    <CommandEmpty>
                      <Trans>No question matches.</Trans>
                    </CommandEmpty>
                    <CommandGroup>
                      {choices.map(({ report, summary, icon: Icon }) => {
                        const selected = report.id === questionId;
                        return (
                          <CommandItem
                            key={report.id}
                            value={`${report.name} ${summary} ${report.id}`}
                            onSelect={() => {
                              setQuestionId(report.id);
                              setChartChoice('');
                            }}
                            aria-selected={selected}
                            className={cn(
                              'cursor-pointer items-start gap-3 py-2',
                              selected && 'bg-accent'
                            )}
                          >
                            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                              <Icon className="h-4 w-4" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block break-words font-medium leading-snug">
                                {report.name}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {summary}
                              </span>
                            </span>
                            <Check
                              className={cn(
                                'mt-1 h-4 w-4 shrink-0',
                                selected ? 'opacity-100' : 'opacity-0'
                              )}
                              aria-hidden
                            />
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </div>
            )}

            {choice && choice.charts.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="add-to-dashboard-chart">
                  <Trans>Which chart of this SQL question</Trans>
                </Label>
                <Select value={chartId} onValueChange={setChartChoice}>
                  <SelectTrigger id="add-to-dashboard-chart" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={SOLID_OVERLAY}>
                    {choice.charts.map((chart) => (
                      <SelectItem key={chart.id} value={chart.id}>
                        {chartChoiceLabel(chart)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {choice?.needsChart && (
              <p className="text-xs text-muted-foreground">
                <Trans>
                  This SQL question has no chart: the dashboard shows its rows as a table.
                </Trans>
              </p>
            )}

            {withTitle && (
              <div className="space-y-2">
                <Label htmlFor="add-to-dashboard-title">
                  <Trans>Title on the dashboard (optional)</Trans>
                </Label>
                <Input
                  id="add-to-dashboard-title"
                  value={customTitle}
                  onChange={(event) => setCustomTitle(event.target.value)}
                  placeholder={choice?.report.name ?? t`The question’s name`}
                  maxLength={120}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submit.isRunning}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={
              submit.isRunning || noQuestions || noDashboards || !choice || !targetDashboardId
            }
          >
            {submit.isRunning ? t`Saving...` : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
