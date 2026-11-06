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
        }),
        compileError: null,
      };
    } catch (err) {
      return { compiled: null, compileError: getErrorMessage(err, t`Invalid question`) };
    }
  }, [spec, budgetId, chartId, chartTitle]);

  const sql = compiled?.sql ?? null;
  const runKey = sql ? `${refreshKey}\n${sql}` : '';

  useEffect(() => {
    if (!sql || !compiled) return;
    latestKeyRef.current = runKey;
    const timer = window.setTimeout(() => {
      const db = runtime.getDatabase() as SqlDatabase | null;
      executeReportQuery(sql, db, { maxRows: MAX_QUESTION_ROWS })
        .then((result) => {
          if (latestKeyRef.current !== runKey) return;
          setCompleted({ key: runKey, result, compiled, error: null });
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
  }, [sql, runKey, runtime, compiled]);

  const isRunning = Boolean(sql) && completed.key !== runKey;
  const error = completed.key === runKey ? completed.error : null;

  return {
    compiled,
    compileError,
    result: completed.result,
    resultCompiled: completed.compiled,
    error,
    isRunning,
  };
}
