import { t } from '@lingui/core/macro';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRuntime } from '@shared/runtime/runtime-provider';
import {
  executeReportQuery,
  type QueryResult,
  type SqlDatabase,
} from '@shared/lib/sql/report-query-executor';
import { getErrorMessage } from '@shared/lib/errors';
import {
  compileQuestion,
  todayIso,
  type CompiledQuestion,
  type QuestionSpec,
} from '@features/reports/lib/question';
import { getQuestionSqlLabels } from './question-labels';

const DEBOUNCE_MS = 300;
export const MAX_QUESTION_ROWS = 5_000;

interface UseQuestionQueryArgs {
  spec: QuestionSpec;
  budgetId: number;
  chartId?: string;
  chartTitle?: string;
  /** Bumped to force a re-run with an unchanged spec (e.g. "Refresh"). */
  refreshKey?: number;
  /** False compiles but does not run (nothing to ask yet). */
  enabled?: boolean;
}

export interface QuestionQueryState {
  compiled: CompiledQuestion | null;
  compileError: string | null;
  result: QueryResult | null;
  /** Compiled question the shown result belongs to (may lag while re-running). */
  resultCompiled: CompiledQuestion | null;
  error: string | null;
  isRunning: boolean;
}

/**
 * Compiles the question and runs it (debounced) through the read-only report
 * executor. Stale responses from earlier specs are dropped; the previous
 * result stays visible while the next one runs.
 */
export function useQuestionQuery({
  spec,
  budgetId,
  chartId,
  chartTitle,
  refreshKey = 0,
  enabled = true,
}: UseQuestionQueryArgs): QuestionQueryState {
  const runtime = useRuntime();
  const [completed, setCompleted] = useState<{
    key: string;
    result: QueryResult | null;
    compiled: CompiledQuestion | null;
    error: string | null;
  }>({ key: '', result: null, compiled: null, error: null });
  const latestKeyRef = useRef('');

  const { compiled, compileError } = useMemo(() => {
    try {
      return {
        compiled: compileQuestion(spec, {
          budgetId,
          chartId: chartId ?? 'question-preview',
          chartTitle,
          labels: getQuestionSqlLabels(),
          today: todayIso(),
        }),
        compileError: null,
      };
    } catch (err) {
      return { compiled: null, compileError: getErrorMessage(err, t`Invalid question`) };
    }
  }, [spec, budgetId, chartId, chartTitle]);

  const sql = enabled ? (compiled?.sql ?? null) : null;
  const runKey = sql ? `${refreshKey}\n${sql}` : '';
  // The run depends on the SQL text only: display tweaks (goal, sort, chart
  // type) recompile the question to the same SQL and must not run it again.
  const compiledRef = useRef(compiled);
  useEffect(() => {
    compiledRef.current = compiled;
  });

  useEffect(() => {
    if (!sql) return;
    latestKeyRef.current = runKey;
    const timer = window.setTimeout(() => {
      const ranWith = compiledRef.current;
      const db = runtime.getDatabase() as SqlDatabase | null;
      executeReportQuery(sql, db, { maxRows: MAX_QUESTION_ROWS })
        .then((result) => {
          if (latestKeyRef.current !== runKey) return;
          setCompleted({ key: runKey, result, compiled: ranWith, error: null });
        })
        .catch((err: unknown) => {
          if (latestKeyRef.current !== runKey) return;
          setCompleted((prev) => ({
            ...prev,
            key: runKey,
            error: getErrorMessage(err, t`Query failed`),
          }));
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [sql, runKey, runtime]);

  const current = completed.key === runKey;
  const isRunning = Boolean(sql) && !current;
  const error = current ? completed.error : null;

  return {
    compiled,
    compileError,
    result: completed.result,
    // Same SQL as the shown result: the latest compile carries the latest display.
    resultCompiled: current && compiled ? compiled : completed.compiled,
    error,
    isRunning,
  };
}
