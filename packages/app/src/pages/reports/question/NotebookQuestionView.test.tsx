import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  QUESTION_HEADER_PREFIX,
  createQuestion,
  type QuestionSpec,
} from '@features/reports/lib/question';
import type { UnifiedReport } from '@budgero/core/browser';
import { NotebookQuestionView } from './NotebookQuestionView';
import { clearAllQuestionDrafts } from './question-drafts';

vi.mock('@entities/report/api/useReports', () => ({
  useReports: () => ({ data: [] }),
  useCreateReport: () => ({ mutateAsync: vi.fn() }),
  useUpdateReport: () => ({ mutateAsync: vi.fn() }),
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
vi.mock('@features/reports/ui/notebook/NotebookEditor', () => ({
  NotebookEditor: ({
    spec,
    onChange,
  }: {
    spec: QuestionSpec;
    onChange: (next: QuestionSpec) => void;
  }) => (
    <div>
      <p>source:{spec.source}</p>
      <button type="button" onClick={() => onChange(createQuestion('accounts'))}>
        Use accounts
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  clearAllQuestionDrafts();
});

function renderNew() {
  return render(
    <MemoryRouter>
      <NotebookQuestionView
        budgetId={1}
        report={null}
        initialSpec={null}
        onConvertToSql={() => undefined}
      />
    </MemoryRouter>
  );
}

describe('NotebookQuestionView', () => {
  it('marks a changed new question as unsaved and keeps it when you come back', async () => {
    const user = userEvent.setup();
    renderNew();
    expect(screen.getByText('New question')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use accounts' }));
    expect(screen.getByText('New question · not saved yet')).toBeInTheDocument();

    // Leave and come back: the draft is still there, and can be dropped.
    cleanup();
    renderNew();
    expect(screen.getByText('source:accounts')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('unsaved changes');
    await user.click(screen.getByRole('button', { name: 'Discard them' }));
    expect(screen.getByText('source:transactions')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('asks before the tab closes with unsaved changes', async () => {
    const user = userEvent.setup();
    renderNew();
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Use accounts' }));
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(true);
  });

  it('renames the question from its title and says what couldn’t be opened', async () => {
    const user = userEvent.setup();
    const report = {
      id: 'r1',
      name: 'Old name',
      query: `${QUESTION_HEADER_PREFIX} ${JSON.stringify({
        source: 'transactions',
        customColumns: [{ id: 'expr_1', name: 'Broken', expression: '[Nope] * 2' }],
        aggregations: [{ op: 'spending' }],
      })}\nSELECT 1`,
      charts: [],
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      tags: [],
    } as unknown as UnifiedReport;
    render(
      <MemoryRouter>
        <NotebookQuestionView
          budgetId={1}
          report={report}
          initialSpec={createQuestion('transactions', { aggregations: [{ op: 'spending' }] })}
          onConvertToSql={() => undefined}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole('status')).toHaveTextContent('Custom column “Broken” was left out');
    await user.click(screen.getByRole('button', { name: /Old name/ }));
    const input = screen.getByRole('textbox', { name: 'Question name' });
    await user.clear(input);
    await user.type(input, 'Groceries watch{Enter}');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Groceries watch');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });
});
