import { act, renderHook } from '@testing-library/react';
import { createQuestion, type QuestionSpec } from '@features/reports/lib/question';
import { useQuestionQuery } from './useQuestionQuery';

const execute = vi.fn(async (sql: string) => ({
  columns: ['x'],
  rows: [[sql.length]],
  rowCount: 1,
  executionTime: 1,
}));

const runtime = { getDatabase: () => ({}) };
vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => runtime,
}));
vi.mock('@shared/lib/sql/report-query-executor', () => ({
  executeReportQuery: (sql: string) => execute(sql),
}));

beforeEach(() => {
  vi.useFakeTimers();
  execute.mockClear();
});
afterEach(() => vi.useRealTimers());

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

describe('useQuestionQuery', () => {
  it('does not run the query again for display-only changes', async () => {
    const spec = createQuestion();
    const { result, rerender } = renderHook(
      ({ spec: current }: { spec: QuestionSpec }) =>
        useQuestionQuery({ spec: current, budgetId: 1 }),
      { initialProps: { spec } }
    );
    await settle();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.current.isRunning).toBe(false);

    const tweaked: QuestionSpec = { ...spec, display: { goal: 100, showValues: true } };
    rerender({ spec: tweaked });
    await settle();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.resultCompiled?.spec.display?.goal).toBe(100);
  });

  it('debounces quick changes into one run', async () => {
    const spec = createQuestion();
    const { rerender } = renderHook(
      ({ spec: current }: { spec: QuestionSpec }) =>
        useQuestionQuery({ spec: current, budgetId: 1 }),
      { initialProps: { spec } }
    );
    rerender({ spec: { ...spec, limit: 10 } });
    rerender({ spec: { ...spec, limit: 11 } });
    await settle();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toContain('11');
  });

  it('moves "today" on when the notebook stays open past midnight', async () => {
    vi.setSystemTime(new Date(2026, 10, 11, 23, 59, 0));
    const spec = createQuestion('transactions', {
      filters: [{ field: 'date', op: 'current', unit: 'day', values: [] }],
    });
    const { result } = renderHook(() => useQuestionQuery({ spec, budgetId: 1 }));
    await settle();
    expect(result.current.compiled?.sql).toContain("'2026-11-11'");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000);
    });
    expect(result.current.compiled?.sql).toContain("'2026-11-12'");
    await settle();
    expect(execute.mock.calls.at(-1)?.[0]).toContain("'2026-11-12'");
  });
});
