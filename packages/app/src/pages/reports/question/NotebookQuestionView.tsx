import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Code2, LayoutGrid, MoreHorizontal, Save, Trash2 } from 'lucide-react';
import type { UnifiedReport } from '@budgero/core/browser';
import { useCreateReport, useReports, useUpdateReport } from '@entities/report/api/useReports';
import {
  buildSavedQuestionQuery,
  compileQuestion,
  createQuestion,
  serializeQuestionHeader,
  type QuestionSpec,
} from '@features/reports/lib/question';
import { NotebookEditor } from '@features/reports/ui/notebook/NotebookEditor';
import { QuestionResult } from '@features/reports/ui/notebook/QuestionResult';
import {
  SaveQuestionDialog,
  type SaveQuestionInput,
} from '@features/reports/ui/notebook/SaveQuestionDialog';
import { ViewSqlDialog } from '@features/reports/ui/notebook/ViewSqlDialog';
import {
  describeQuestion,
  getQuestionSqlLabels,
} from '@features/reports/ui/notebook/question-labels';
import { useFieldValueOptions } from '@features/reports/ui/notebook/useFieldValueOptions';
import { useQuestionQuery } from '@features/reports/ui/notebook/useQuestionQuery';
import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { collectionOf, listCollections, withCollection } from '../collections';
import { QuestionHeader } from './QuestionHeader';
import { useDeleteQuestion } from './useDeleteQuestion';
import { useOpenSavedQuestion } from './useOpenSavedQuestion';
import { usePinToDashboard } from './usePinToDashboard';

const MAX_HISTORY = 20;

interface NotebookQuestionViewProps {
  budgetId: number;
  /** The saved question being edited; null for a new one. */
  report: UnifiedReport | null;
  initialSpec: QuestionSpec | null;
  openSaveDialog?: boolean;
  /** Open "Add to dashboard" on arrival (the question was just saved with it). */
  openPinDialog?: boolean;
  onConvertToSql: (sql: string) => void;
}

export function NotebookQuestionView({
  budgetId,
  report,
  initialSpec,
  openSaveDialog = false,
  openPinDialog = false,
  onConvertToSql,
}: NotebookQuestionViewProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [spec, setSpec] = useState<QuestionSpec>(() => initialSpec ?? createQuestion());
  // Questions left by drilling through, newest last; Back pops one.
  const [history, setHistory] = useState<QuestionSpec[]>([]);
  const drill = useCallback(
    (next: QuestionSpec) => {
      setHistory((previous) => [...previous.slice(-(MAX_HISTORY - 1)), spec]);
      setSpec(next);
    },
    [spec]
  );
  const back = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setSpec(previous);
  }, [history]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [saveOpen, setSaveOpen] = useState(openSaveDialog && report !== null);
  const [sqlOpen, setSqlOpen] = useState(false);
  const valueOptions = useFieldValueOptions(budgetId);
  const pin = usePinToDashboard(budgetId);
  const opener = useOpenSavedQuestion();
  const pinOnArrival = useRef(openPinDialog);
  useEffect(() => {
    if (!pinOnArrival.current || !report) return;
    pinOnArrival.current = false;
    pin.open(report);
  }, [pin, report]);
  const { data: reports = [] } = useReports();
  const createReport = useCreateReport();
  const updateReport = useUpdateReport();
  const deletion = useDeleteQuestion(() => void navigate('/reports'));

  const title = report?.name ?? describeQuestion(spec);
  const query = useQuestionQuery({
    spec,
    budgetId,
    chartId: report?.charts?.[0]?.id,
    chartTitle: title,
    refreshKey,
  });

  const savedHeader = useMemo(
    () => (initialSpec ? serializeQuestionHeader(initialSpec) : null),
    [initialSpec]
  );
  const dirty = report !== null && serializeQuestionHeader(spec) !== savedHeader;

  const save = useCallback(
    async ({ name, description, collection }: SaveQuestionInput) => {
      // Keep the first chart's id so dashboard widgets pinned to it keep working.
      const chartId = report?.charts?.[0]?.id ?? crypto.randomUUID();
      const { sql, chart } = compileQuestion(spec, {
        budgetId,
        chartId,
        chartTitle: name,
        labels: getQuestionSqlLabels(),
      });
      const payload = {
        name,
        description,
        query: buildSavedQuestionQuery(spec, sql),
        tags: withCollection(report?.tags, collection),
      };
      if (report) {
        const charts = [chart, ...(report.charts?.slice(1) ?? [])];
        const updated = await updateReport.mutateAsync({ id: report.id, ...payload, charts });
        await queryClient.invalidateQueries({ queryKey: ['reports'] });
        return updated;
      }
      const { id: _id, ...newChart } = chart;
      const created = await createReport.mutateAsync({ ...payload, charts: [newChart] });
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
      opener.open(created);
      return created;
    },
    [budgetId, createReport, opener, queryClient, report, spec, updateReport]
  );

  return (
    <div className="w-full space-y-4 p-4 pb-24 sm:p-6 md:pb-6">
      <QuestionHeader
        title={title}
        subtitle={
          report
            ? dirty
              ? t`Unsaved changes`
              : (report.description ?? (collectionOf(report) || t`My questions`))
            : t`New question`
        }
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSqlOpen(true)}
          disabled={!query.compiled}
        >
          <Code2 className="h-4 w-4" aria-hidden />
          <Trans>View the SQL</Trans>
        </Button>
        {report && (
          <Button variant="outline" size="sm" onClick={() => pin.open(report)}>
            <LayoutGrid className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">
              <Trans>Add to dashboard</Trans>
            </span>
          </Button>
        )}
        <Button size="sm" onClick={() => setSaveOpen(true)} disabled={!query.compiled}>
          <Save className="h-4 w-4" aria-hidden />
          {report ? t`Save` : t`Save question`}
        </Button>
        {report && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t`More actions`}>
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => deletion.ask(report)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                <Trans>Delete question</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </QuestionHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)] lg:items-start">
        <NotebookEditor spec={spec} onChange={setSpec} valueOptions={valueOptions} />
        <QuestionResult
          spec={spec}
          query={query}
          onVisualizationChange={(visualization) => setSpec({ ...spec, visualization })}
          onStackingChange={(stacking) => setSpec({ ...spec, stacking })}
          onDisplayChange={(display) => setSpec({ ...spec, display })}
          onRefresh={() => setRefreshKey((key) => key + 1)}
          onDrill={drill}
          onBack={history.length > 0 ? back : undefined}
          title={title}
        />
      </div>

      <SaveQuestionDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        mode={report ? 'edit' : 'create'}
        initialName={report?.name ?? describeQuestion(spec)}
        initialDescription={report?.description}
        initialCollection={report ? collectionOf(report) : undefined}
        collections={listCollections(reports)}
        onSave={save}
        onSaveAndPin={report ? pin.open : opener.openAndPin}
      />
      <ViewSqlDialog
        open={sqlOpen}
        onOpenChange={setSqlOpen}
        sql={query.compiled?.sql ?? ''}
        onConvert={() => query.compiled && onConvertToSql(query.compiled.sql)}
      />
      {deletion.dialog}
      {pin.dialog}
    </div>
  );
}
