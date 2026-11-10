import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createQuestion, type QuestionSpec } from '@features/reports/lib/question';
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
});
