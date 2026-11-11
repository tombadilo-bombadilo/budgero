/**
 * Query results as the app reads them: DuckDB (node build of the same wasm
 * engine) → Arrow → rows. DECIMAL and DATE columns must come back as their
 * values (12.345, "2026-11-11"), not Arrow's raw unscaled integers / epoch
 * milliseconds, on every path that shows them: tables, number charts, CSV
 * and the AI SQL tool.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as DuckDbBlocking from '@duckdb/duckdb-wasm/blocking';
import type { ChartConfiguration } from '@budgero/core/browser';
import { executeQuerySql } from '@features/ai/lib/tools/query-sql';
import type { ToolContext } from '@features/ai/lib/tools/types';
import { sqlChartView } from '@features/reports/ui/notebook/viz/sql-chart';
import { compileQuestion } from '@features/reports/lib/question/compile';
import { normalizeQuestion } from '@features/reports/lib/question/spec';
import { arrowTableToRows } from './arrow-rows';
import { resultsToCsv } from './csv';
import type { QueryResult } from './report-query-executor';

const require = createRequire(import.meta.url);
const duckdb =
  require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs') as typeof DuckDbBlocking;

const distDir = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));

let conn: DuckDbBlocking.DuckDBConnection;

beforeAll(async () => {
  const db = await duckdb.createDuckDB(
    {
      mvp: { mainModule: path.join(distDir, 'duckdb-mvp.wasm'), mainWorker: '' },
      eh: { mainModule: path.join(distDir, 'duckdb-eh.wasm'), mainWorker: '' },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME
  );
  await db.instantiate(() => undefined);
  conn = db.connect();
}, 30_000);

afterAll(() => conn?.close());

function run(sql: string): QueryResult {
  const { columns, rows } = arrowTableToRows(conn.query(sql));
  return { columns, rows, rowCount: rows.length, executionTime: 0 };
}

const SAMPLE = `SELECT
  CAST(12.345 AS DECIMAL(18, 3)) AS amount,
  CAST(-0.5 AS DECIMAL(18, 3)) AS negative,
  CAST(123456789012.001 AS DECIMAL(18, 3)) AS large,
  SUM(CAST(1.1 AS DECIMAL(18, 3))) AS summed,
  CAST(NULL AS DECIMAL(18, 3)) AS missing,
  CAST(2.5 AS DECIMAL(10, 1)) AS one_place,
  DATE '2026-11-11' AS day,
  CAST(NULL AS DATE) AS no_day,
  CAST(7 AS BIGINT) AS count,
  CAST(1.25 AS DOUBLE) AS ratio,
  'Speed' AS label`;

describe('arrowTableToRows', () => {
  it('scales DECIMAL values and writes DATE values as ISO days', () => {
    const result = run(SAMPLE);
    expect(result.rows).toEqual([
      [12.345, -0.5, 123456789012.001, 1.1, null, 2.5, '2026-11-11', null, 7, 1.25, 'Speed'],
    ]);
  });

  it('tables, number charts, CSV and the AI tool see the real values', async () => {
    const result = run(
      `SELECT 'Checking' AS account, CAST(1234.5 AS DECIMAL(18, 3)) AS balance, DATE '2026-11-11' AS day`
    );
    // CSV export
    expect(resultsToCsv(result.columns, result.rows)).toBe(
      'account,balance,day\nChecking,1234.5,2026-11-11'
    );
    // Number chart over a SQL result
    const chart: ChartConfiguration = {
      id: 'c',
      chartType: 'stat',
      xAxisColumn: 'balance',
      yAxisColumn: 'balance',
      aggregateFunction: 'SUM',
    };
    const view = sqlChartView(result, chart);
    expect(view?.result.rows[0]).toContain(1234.5);
    // AI query_sql tool
    const context = {
      budgetId: 1,
      runReadOnlyQuery: async () => result,
    } as unknown as ToolContext;
    const answer = await executeQuerySql({ sql: 'SELECT 1' }, context);
    expect(answer.message).toContain('Checking | 1234.50 | 2026-11-11');
  });

  it('builder questions (already DOUBLE) keep their values', () => {
    const { sql } = compileQuestion(
      normalizeQuestion({ source: 'transactions', aggregations: [{ op: 'count' }] }),
      { budgetId: 1, today: '2026-11-11' }
    );
    // The question SQL reads app tables; only its value types matter here.
    expect(sql).toContain('COUNT(DISTINCT transaction_id)');
    expect(run(`SELECT CAST(CAST(12.345 AS DECIMAL(18, 3)) AS DOUBLE) AS v`).rows).toEqual([
      [12.345],
    ]);
  });
});
