import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UnifiedReport } from '@budgero/core/browser';
import { buildSavedQuestionQuery, createQuestion } from '@features/reports/lib/question';
import QuestionPage from './QuestionPage';

const report = (id: string, query: string): UnifiedReport => ({
  id,
  name: id,
  query,
  charts: [],
  createdAt: '',
  updatedAt: '',
});

const REPORTS = [
  report('notebook', buildSavedQuestionQuery(createQuestion('budget'), 'SELECT 1')),
  report('legacy', '-- budgero-builder: {"measure":"income","groupBy":"month"}\nSELECT 1'),
  report('sql', 'SELECT 1'),
];

vi.mock('@entities/report/api/useReports', () => ({
  useReports: () => ({ data: REPORTS, isLoading: false, isFetching: false }),
}));
vi.mock('./NotebookQuestionView', () => ({
  NotebookQuestionView: ({
    report: r,
    initialSpec,
    openSaveDialog,
  }: {
    report: UnifiedReport | null;
    initialSpec: { source: string; aggregations: { op: string }[] } | null;
    openSaveDialog: boolean;
  }) => (
    <p>
      notebook:{r?.id ?? 'new'}:{initialSpec?.source ?? '-'}:
      {initialSpec?.aggregations.map((a) => a.op).join('+')}:{String(openSaveDialog)}
    </p>
  ),
}));
vi.mock('@pages/explorer-page/SqlQuestionView', () => ({
  SqlQuestionView: ({ report: r }: { report: UnifiedReport | null }) => <p>sql:{r?.id ?? 'new'}</p>,
}));

afterEach(cleanup);

function renderAt(path: string, state?: unknown) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: path.split('?')[0],
          search: path.includes('?') ? `?${path.split('?')[1]}` : '',
          state,
        },
      ]}
    >
      <Routes>
        <Route path="/reports/question/new" element={<QuestionPage />} />
        <Route path="/reports/question/:reportId" element={<QuestionPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('QuestionPage', () => {
  it('opens notebook questions (v2 and upgraded v1) in the notebook', () => {
    renderAt('/reports/question/notebook', { openSaveDialog: true });
    expect(screen.getByText('notebook:notebook:budget::true')).toBeInTheDocument();
    cleanup();
    renderAt('/reports/question/legacy');
    expect(screen.getByText('notebook:legacy:transactions:income:false')).toBeInTheDocument();
  });

  it('opens plain SQL reports and ?mode=sql in the SQL editor', () => {
    renderAt('/reports/question/sql');
    expect(screen.getByText('sql:sql')).toBeInTheDocument();
    cleanup();
    renderAt('/reports/question/new?mode=sql');
    expect(screen.getByText('sql:new')).toBeInTheDocument();
  });

  it('starts a new notebook question and explains missing ones', () => {
    renderAt('/reports/question/new');
    expect(screen.getByText('notebook:new:-::false')).toBeInTheDocument();
    cleanup();
    renderAt('/reports/question/gone');
    expect(
      screen.getByRole('heading', { name: 'This question doesn’t exist' })
    ).toBeInTheDocument();
  });
});
