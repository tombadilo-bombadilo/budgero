import { useEffect, useMemo, useRef, useState } from 'react';
import { useRuntime } from '@shared/runtime/runtime-provider';
import {
  executeReportQuery,
  type QueryResult,
  type SqlDatabase,
} from '@shared/lib/sql/report-query-executor';
import { getErrorMessage } from '@shared/lib/errors';
import {
  compileReportSpec,
  type CompiledReport,
  type ReportBuilderSpec,
} from '../../lib/report-builder';
import { getBuilderSqlLabels } from './builder-labels';

const DEBOUNCE_MS = 300;
const MAX_BUILDER_ROWS = 5_000;

interface UseReportBuilderQueryArgs {
  spec: ReportBuilderSpec;
  budgetId: number;
  chartId?: string;
  chartTitle?: string;
  /** Bumped to force a re-run with an unchanged spec (e.g. "Refresh"). */
  refreshKey?: number;
}

export interface ReportBuilderQueryState {
  compiled: CompiledReport | null;
  compileError: string | null;
  result: QueryResult | null;
  error: string | null;
  isRunning: boolean;
}

/**
 * Compiles the spec and runs it (debounced) through the read-only report
 * executor. Stale responses from earlier specs are dropped.
 */
export function useReportBuilderQuery({
  spec,
  budgetId,
  chartId,
  chartTitle,
  refreshKey = 0,
}: UseReportBuilderQueryArgs): ReportBuilderQueryState {
  const runtime = useRuntime();
  const [completed, setCompleted] = useState<{
    key: string;
    result: QueryResult | null;
    error: string | null;
  }>({ key: '', result: null, error: null });
  const latestKeyRef = useRef('');

  const { compiled, compileError } = useMemo(() => {
    try {
      return {
        compiled: compileReportSpec(spec, {
          budgetId,
          chartId: chartId ?? 'builder-preview',
          chartTitle,
          labels: getBuilderSqlLabels(),
        }),
        compileError: null,
      };
    } catch (err) {
      return { compiled: null, compileError: getErrorMessage(err, 'Invalid report') };
    }
  }, [spec, budgetId, chartId, chartTitle]);

  const sql = compiled?.sql ?? null;
  const runKey = sql ? `${refreshKey}\n${sql}` : '';

  useEffect(() => {
    if (!sql) return;
    latestKeyRef.current = runKey;
    const timer = window.setTimeout(() => {
      const db = runtime.getDatabase() as SqlDatabase | null;
      executeReportQuery(sql, db, { maxRows: MAX_BUILDER_ROWS })
        .then((result) => {
          if (latestKeyRef.current !== runKey) return;
          setCompleted({ key: runKey, result, error: null });
        })
        .catch((err: unknown) => {
          if (latestKeyRef.current !== runKey) return;
          setCompleted((prev) => ({
            key: runKey,
            result: prev.result,
            error: getErrorMessage(err, 'Query failed'),
          }));
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [sql, runKey, runtime]);

  // The previous result stays visible (dimmed) while the next one runs.
  const isRunning = Boolean(sql) && completed.key !== runKey;
  const { result } = completed;
  const error = completed.key === runKey ? completed.error : null;

  return { compiled, compileError, result, error, isRunning };
}
