import { Trans } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useReports } from '@entities/report/api/useReports';
import { parseQuestionHeader, type QuestionSpec } from '@features/reports/lib/question';
import { SqlQuestionView } from '@pages/explorer-page/SqlQuestionView';
import { useUiStore } from '@shared/store/useUiStore';
import { Button } from '@shared/ui/button';
import { BackToReports } from '../BackToReports';
import { NotebookQuestionView } from './NotebookQuestionView';
import type { QuestionRouteState } from './useOpenSavedQuestion';

/**
 * /reports/question/new and /reports/question/:reportId. Notebook questions
 * (saved with a question header) open in the notebook editor; plain SQL
 * reports open in the SQL (advanced) editor. `?mode=sql` starts a new SQL one.
 */
export default function QuestionPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const budgetId = useUiStore((state) => state.selectedBudget?.ID || 0);
  const { data: reports, isLoading, isFetching } = useReports();
  const routeState = (location.state as QuestionRouteState | null) ?? {};
  // A "Convert to SQL" for this visit; a new navigation (save → replace) resets it.
  // The notebook spec it came from is kept so "Back to the notebook" loses nothing.
  const [converted, setConverted] = useState<{
    key: string;
    sql: string;
    spec: QuestionSpec;
    back?: boolean;
  } | null>(null);
  const current = converted?.key === location.key ? converted : null;
  const convertedSql = current && !current.back ? current.sql : null;
  const resumeSpec = current?.back ? current.spec : null;

  const report = useMemo(
    () => (reportId ? (reports?.find((item) => item.id === reportId) ?? null) : null),
    [reports, reportId]
  );
  const spec = useMemo(() => (report ? parseQuestionHeader(report.query) : null), [report]);

  if (reportId && isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span className="sr-only">
          <Trans>Loading…</Trans>
        </span>
      </div>
    );
  }

  if (reportId && !report && isFetching) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
    );
  }

  if (reportId && !report) {
    return (
      <div className="w-full space-y-4 p-4 sm:p-6">
        <BackToReports />
        <div className="rounded-lg border border-dashed p-8 text-center">
          <h1 className="text-lg font-semibold">
            <Trans>This question doesn’t exist</Trans>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Trans>It may have been deleted on another device.</Trans>
          </p>
          <Button asChild className="mt-4">
            <Link to="/reports/question/new">
              <Trans>New question</Trans>
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const viewKey = `${report?.id ?? 'new'}:${location.key}`;

  if (
    convertedSql !== null ||
    (report && !spec) ||
    (!report && searchParams.get('mode') === 'sql')
  ) {
    return (
      <SqlQuestionView
        key={`sql:${viewKey}`}
        budgetId={budgetId}
        report={report}
        initialSql={convertedSql ?? undefined}
        onBackToNotebook={
          convertedSql !== null ? () => setConverted({ ...current!, back: true }) : undefined
        }
        openSaveDialog={Boolean(routeState.openSaveDialog)}
        openPinDialog={Boolean(routeState.openPinDialog)}
      />
    );
  }

  return (
    <NotebookQuestionView
      key={`notebook:${viewKey}`}
      budgetId={budgetId}
      report={report}
      initialSpec={spec}
      resumeSpec={resumeSpec}
      openSaveDialog={Boolean(routeState.openSaveDialog)}
      openPinDialog={Boolean(routeState.openPinDialog)}
      onConvertToSql={(sql, from) => setConverted({ key: location.key, sql, spec: from })}
    />
  );
}
