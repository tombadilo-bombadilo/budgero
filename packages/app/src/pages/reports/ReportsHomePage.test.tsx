import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { UnifiedReport } from '@budgero/core/browser';
import { buildSavedQuestionQuery, createQuestion } from '@features/reports/lib/question';
import ReportsHomePage from './ReportsHomePage';

const question = createQuestion('transactions', {
  aggregations: [{ op: 'spending' }],
  breakouts: [{ field: 'category' }],
});

const REPORTS: UnifiedReport[] = [
  {
    id: 'q1',
    name: 'Where the money went',
    query: buildSavedQuestionQuery(question, 'SELECT 1'),
    charts: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    tags: ['Household'],
  },
  {
    id: 's1',
    name: 'Raw SQL thing',
    query: 'SELECT 42',
    charts: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    tags: [],
  },
];

const deleteReport = vi.fn(async (_id: string) => undefined);
vi.mock('@entities/report/api/useReports', () => ({
  useReports: () => ({ data: REPORTS, isLoading: false }),
  useDeleteReport: () => ({ mutateAsync: deleteReport, isPending: false }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  globalThis.ResizeObserver ??= class {
    observe() {}

    unobserve() {}

    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

function renderHome() {
  return render(
    <MemoryRouter>
      <ReportsHomePage />
    </MemoryRouter>
  );
}

describe('ReportsHomePage', () => {
  it('lists the 7 prebuilt reports as cards linking to full pages', () => {
    renderHome();
    const prebuilt = screen.getByRole('region', { name: 'Prebuilt reports' });
    const links = within(prebuilt).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/reports/prebuilt/wealth',
      '/reports/prebuilt/spending',
      '/reports/prebuilt/in-out',
      '/reports/prebuilt/plan',
      '/reports/prebuilt/money-map',
      '/reports/prebuilt/scenario',
      '/reports/prebuilt/ledger',
    ]);
    expect(links[1]).toHaveTextContent('Where does my money go?');
    expect(links[1]).toHaveTextContent('Spending');
  });

  it('shows saved questions with their collection, newest first', () => {
    renderHome();
    const saved = screen.getByRole('region', { name: 'Saved questions' });
    const cards = within(saved)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/reports/question/'));
    expect(cards.map((link) => link.getAttribute('href'))).toEqual([
      '/reports/question/new?mode=sql',
      '/reports/question/q1',
      '/reports/question/s1',
    ]);
    expect(cards[1]).toHaveTextContent('Spending by Category');
    expect(cards[1]).toHaveTextContent('Household');
    expect(cards[2]).toHaveTextContent('SQL query');
    expect(cards[2]).toHaveTextContent('My questions');
    expect(screen.getByRole('link', { name: /New question/ })).toHaveAttribute(
      'href',
      '/reports/question/new'
    );
    expect(screen.getByRole('link', { name: /Dashboards/ })).toHaveAttribute(
      'href',
      '/reports/dashboards'
    );
  });

  it('filters by search text and collection', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.type(screen.getByRole('searchbox', { name: 'Search reports' }), 'money');
    expect(screen.getAllByRole('link', { name: /money/i }).map((link) => link.textContent)).toEqual(
      [
        expect.stringContaining('Where does my money go?'),
        expect.stringContaining('How does my money move?'),
        expect.stringContaining('Where the money went'),
      ]
    );
    await user.clear(screen.getByRole('searchbox', { name: 'Search reports' }));
    await user.click(screen.getByRole('button', { name: 'Household' }));
    expect(screen.queryByText('Raw SQL thing')).not.toBeInTheDocument();
    expect(screen.getByText('Where the money went')).toBeInTheDocument();
  });

  it('deletes a saved SQL question from its card after confirming', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: 'More actions for Raw SQL thing' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete question' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Raw SQL thing');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(deleteReport).toHaveBeenCalledWith('s1');
  });
});
