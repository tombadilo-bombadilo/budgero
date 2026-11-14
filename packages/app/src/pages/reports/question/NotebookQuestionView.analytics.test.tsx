import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  buildSavedQuestionQuery,
  normalizeQuestion,
  type QuestionSpec,
} from '@features/reports/lib/question';
import type { SaveQuestionInput } from '@features/reports/ui/notebook/SaveQuestionDialog';
import type { UnifiedReport } from '@budgero/core/browser';
import { NotebookQuestionView } from './NotebookQuestionView';
import { clearAllQuestionDrafts } from './question-drafts';

const { track, createReport, updateReport } = vi.hoisted(() => ({
  track: vi.fn(),
  createReport: vi.fn(),
  updateReport: vi.fn(),
}));

vi.mock('@shared/lib/analytics/track', () => ({ track }));
vi.mock('@entities/report/api/useReports', () => ({
  useReports: () => ({ data: [] }),
  useCreateReport: () => ({ mutateAsync: createReport }),
  useUpdateReport: () => ({ mutateAsync: updateReport }),
  useDeleteReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
}));
vi.mock('@features/reports/ui/notebook/useFieldValueOptions', () => ({
  useFieldValueOptions: () => () => [],
}));
vi.mock('@features/reports/ui/notebook/useQuestionQuery', () => ({
  useQuestionQuery: () => ({
    compiled: null,
    compileError: null,
    result: null,
    resultCompiled: null,
    error: null,
    isRunning: false,
  }),
}));
vi.mock('./usePinToDashboard', () => ({
  usePinToDashboard: () => ({ open: vi.fn(), dialog: null }),
}));
vi.mock('@features/reports/ui/notebook/QuestionResult', () => ({ QuestionResult: () => null }));
vi.mock('@features/reports/ui/notebook/NotebookEditor', () => ({ NotebookEditor: () => null }));
// The dialog's own form is tested elsewhere: here it just saves (and, like it, catches a failure).
vi.mock('@features/reports/ui/notebook/SaveQuestionDialog', () => ({
  SaveQuestionDialog: ({ onSave }: { onSave: (input: SaveQuestionInput) => Promise<unknown> }) => (
    <button
      type="button"
      onClick={() => void onSave({ name: 'Groceries by month' }).catch(() => undefined)}
    >
      Save it
    </button>
  ),
}));

const stacked: QuestionSpec = normalizeQuestion({
  source: 'transactions',
  aggregations: [{ op: 'spending' }],
  breakouts: [{ field: 'date', bucket: 'month' }, { field: 'category' }],
  visualization: 'bar',
  stacking: 'percent',
});

beforeEach(() => {
  track.mockReset();
  createReport.mockReset().mockResolvedValue({ id: 'q1', name: 'x', query: '', charts: [] });
  updateReport.mockReset().mockResolvedValue({ id: 'q1', name: 'x', query: '', charts: [] });
});

afterEach(() => {
  cleanup();
  clearAllQuestionDrafts();
});

function renderView(report: UnifiedReport | null, spec: QuestionSpec | null) {
  render(
    <MemoryRouter>
      <NotebookQuestionView
        budgetId={1}
        report={report}
        initialSpec={report ? spec : null}
        resumeSpec={report ? null : spec}
        onConvertToSql={() => undefined}
      />
    </MemoryRouter>
  );
}

describe('NotebookQuestionView analytics', () => {
  it('counts a new question saved, with its data source and chart', async () => {
    renderView(null, stacked);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save it' }));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('question_saved', {
        source: 'transactions',
        chart: 'bar',
        stacking: 'percent',
        mode: 'new',
      })
    );
    expect(createReport).toHaveBeenCalledTimes(1);
  });

  it('counts an edited question as edited, and nothing when the save fails', async () => {
    const report = {
      id: 'q1',
      name: 'Accounts',
      query: buildSavedQuestionQuery(normalizeQuestion({ source: 'accounts' }), 'SELECT 1'),
      charts: [],
    } as unknown as UnifiedReport;
    const accounts = normalizeQuestion({ source: 'accounts' });
    renderView(report, accounts);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save it' }));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'question_saved',
        expect.objectContaining({ source: 'accounts', stacking: 'none', mode: 'edited' })
      )
    );

    track.mockReset();
    updateReport.mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Save it' }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(2));
    expect(track).not.toHaveBeenCalled();
  });
});
