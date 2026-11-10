import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Code2, LayoutGrid, MoreHorizontal, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { UnifiedReport } from '@budgero/core/browser';
import { useCreateReport, useReports, useUpdateReport } from '@entities/report/api/useReports';
import {
  buildSavedQuestionQuery,
  compileQuestion,
  createQuestion,
  normalizeQuestion,
  questionHeaderIssues,
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
  questionIssueMessage,
} from '@features/reports/ui/notebook/question-labels';
import { useFieldValueOptions } from '@features/reports/ui/notebook/useFieldValueOptions';
import { useQuestionQuery } from '@features/reports/ui/notebook/useQuestionQuery';
import { useLeaveGuard } from '@shared/hooks/useLeaveGuard';
import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { collectionOf, listCollections, withCollection } from '../collections';
import { QuestionHeader } from './QuestionHeader';
import { clearQuestionDraft, loadQuestionDraft, saveQuestionDraft } from './question-drafts';
import { useDeleteQuestion } from './useDeleteQuestion';
import { useOpenSavedQuestion } from './useOpenSavedQuestion';
import { usePinToDashboard } from './usePinToDashboard';

const MAX_HISTORY = 20;

interface NotebookQuestionViewProps {
  budgetId: number;
  /** The saved question being edited; null for a new one. */
  report: UnifiedReport | null;
  initialSpec: QuestionSpec | null;
  /** Unsaved spec to continue with (back from "Convert to SQL", or an example). */
  resumeSpec?: QuestionSpec | null;
  /** Name for a new question that starts from an example. */
  initialName?: string;
  openSaveDialog?: boolean;
  /** Open "Add to dashboard" on arrival (the question was just saved with it). */
  openPinDialog?: boolean;
  /** The SQL and the notebook spec it came from (to come back to). */
  onConvertToSql: (sql: string, spec: QuestionSpec) => void;
}

export function NotebookQuestionView({
  budgetId,
  report,
  initialSpec,
  resumeSpec = null,
  initialName,
  openSaveDialog = false,
  openPinDialog = false,
  onConvertToSql,
}: NotebookQuestionViewProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reportId = report?.id ?? null;
  // Where the question starts: the saved one, or a blank new one.
  const [startHeader] = useState(() => serializeQuestionHeader(initialSpec ?? createQuestion()));
  // An unsaved draft left in this tab is picked up again (and can be discarded).
  const [restoredDraft, setRestoredDraft] = useState(
    () => !resumeSpec && loadQuestionDraft(budgetId, reportId) !== null
  );
  const [spec, setSpec] = useState<QuestionSpec>(
    () => resumeSpec ?? loadQuestionDraft(budgetId, reportId) ?? initialSpec ?? createQuestion()
  );
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
  // Opened from a card further down the Reports home: start at the top.
  useEffect(() => {
    document.documentElement.scrollTop = 0;
  }, []);
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

  // A name typed into the title; saved with the question.
  const [name, setName] = useState<string | null>(report?.name ?? initialName ?? null);
  const title = name ?? describeQuestion(spec);
  const renamed = report !== null && name !== null && name !== report.name;
  const issues = useMemo(() => questionHeaderIssues(report?.query), [report?.query]);
  const [issuesDismissed, setIssuesDismissed] = useState(false);
  const query = useQuestionQuery({
    spec,
    budgetId,
    chartId: report?.charts?.[0]?.id,
    chartTitle: title,
    refreshKey,
  });

  const savedHeader = useMemo(
    () => (initialSpec ? serializeQuestionHeader(initialSpec) : startHeader),
    [initialSpec, startHeader]
  );
  const dirty = serializeQuestionHeader(spec) !== savedHeader || renamed;
  useLeaveGuard(dirty);
  useEffect(() => {
    if (dirty) saveQuestionDraft(budgetId, reportId, spec);
    else clearQuestionDraft(budgetId, reportId);
  }, [dirty, budgetId, reportId, spec]);
  const discardDraft = () => {
    clearQuestionDraft(budgetId, reportId);
    setRestoredDraft(false);
    setHistory([]);
    setSpec(initialSpec ?? createQuestion());
  };

  const save = useCallback(
    async ({ name: savedName, description, collection }: SaveQuestionInput) => {
      // Keep the first chart's id so dashboard widgets pinned to it keep working.
      const chartId = report?.charts?.[0]?.id ?? crypto.randomUUID();
      // No `today`: the stored SQL keeps rolling with CURRENT_DATE (live runs pass the local day).
      const { sql, chart } = compileQuestion(spec, {
        budgetId,
        chartId,
        chartTitle: savedName,
        labels: getQuestionSqlLabels(),
      });
      setName(savedName);
      const payload = {
        name: savedName,
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
      clearQuestionDraft(budgetId, null);
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
        onRename={setName}
        subtitle={
          report
            ? dirty
              ? t`Unsaved changes`
              : (report.description ?? (collectionOf(report) || t`My questions`))
            : dirty
              ? t`New question · not saved yet`
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

      {issues.length > 0 && !issuesDismissed && (
        <div
          role="status"
          className="flex flex-wrap items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
        >
          <div className="mr-auto min-w-0 space-y-0.5">
            <p className="font-medium">
              <Trans>Part of this question couldn’t be opened</Trans>
            </p>
            <ul className="list-disc pl-4 text-xs text-muted-foreground">
              {issues.map((issue, index) => (
                <li key={index}>{questionIssueMessage(issue)}</li>
              ))}
            </ul>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => setIssuesDismissed(true)}
          >
            <Trans>Got it</Trans>
          </Button>
        </div>
      )}

      {restoredDraft && dirty && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
        >
          <span className="mr-auto">
            <Trans>Picked up your unsaved changes from earlier.</Trans>
          </span>
          <Button variant="ghost" size="sm" className="h-7" onClick={discardDraft}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            <Trans>Discard them</Trans>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)] lg:items-start">
        <NotebookEditor spec={spec} onChange={setSpec} valueOptions={valueOptions} />
        <QuestionResult
          spec={spec}
          query={query}
          onVisualizationChange={(visualization) => setSpec({ ...spec, visualization })}
          onStackingChange={(stacking) => setSpec({ ...spec, stacking })}
          onDisplayChange={(display) => setSpec({ ...spec, display })}
          onRefresh={() => setRefreshKey((key) => key + 1)}
          onSpecChange={(next) => setSpec(normalizeQuestion(next))}
          onDrill={drill}
          onBack={history.length > 0 ? back : undefined}
          title={title}
        />
      </div>

      <SaveQuestionDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        mode={report ? 'edit' : 'create'}
        initialName={title}
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
        onConvert={() => query.compiled && onConvertToSql(query.compiled.sql, spec)}
      />
      {deletion.dialog}
      {pin.dialog}
    </div>
  );
}
