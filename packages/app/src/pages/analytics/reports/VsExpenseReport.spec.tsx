import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  flushSyncedState,
  receiveSyncedState,
  resetSyncedRuntime,
  SyncedRuntimeProvider,
  syncedWrites,
} from '@/test/synced-runtime';
import type { AnalyticsTxn } from '../analytics-model';
import type { AnalyticsData } from '../useAnalyticsData';
import { LEDGER_COLUMNS_KEY } from './ledger-columns';
import { VsExpenseReport } from './VsExpenseReport';

vi.mock('@shared/runtime/global', async () => (await import('@/test/synced-runtime')).globalMock());
vi.mock('@shared/runtime/runtime-provider', async () =>
  (await import('@/test/synced-runtime')).runtimeProviderMock()
);
vi.mock('@entities/user/api/useAuth', () => ({ useProfile: () => ({ data: { id: 'u1' } }) }));
vi.mock('../components/chart-utils', () => ({
  shortMonthLabel: (month: string) => month,
  longMonthLabel: (month: string) => month,
  useMoneyFormatters: () => ({ amount: (value: number) => `m${value}` }),
}));
vi.mock('../components/CategoryTransactionCell', () => ({
  CategoryTransactionCell: ({ value }: { value: number }) => <td>{`m${value}`}</td>,
}));

const months = ['2026-01', '2026-02', '2026-03'];

function txn(id: number, monthKey: string, outflow: number): AnalyticsTxn {
  return {
    id,
    date: `${monthKey}-10`,
    monthKey,
    accountId: 1,
    categoryId: 10,
    category: 'Groceries',
    groupName: 'Everyday',
    payee: '',
    labelId: null,
    label: '',
    labelColor: null,
    inflow: 0,
    outflow,
    isTransfer: false,
    isIncome: false,
  };
}

// Groceries: 90.00 in January, nothing in February, 30.00 in March.
const data = {
  budgetId: 1,
  isLoading: false,
  allTxns: [],
  txns: [txn(1, '2026-01', 90_000), txn(2, '2026-03', 30_000)],
  accounts: [],
  onBudgetAccountIds: new Set([1]),
  categories: [{ id: 10, name: 'Groceries', groupId: 5 }],
  categoryGroups: [{ id: 5, name: 'Everyday' }],
  labels: [],
  payees: [],
} as unknown as AnalyticsData;

const renderReport = async () => {
  render(
    <SyncedRuntimeProvider>
      <VsExpenseReport data={data} months={months} accountIds={[]} categoryIds={[]} />
    </SyncedRuntimeProvider>
  );
  await flushSyncedState();
};

const headers = () =>
  within(screen.getByRole('table'))
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent);

const categoryRow = () =>
  within(screen.getByText('Groceries').closest('tr')!)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

beforeAll(() => {
  // Radix Select uses pointer capture and scrollIntoView, which jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  localStorage.clear();
  resetSyncedRuntime();
});

it('shows a per-month Average before the Total at the end by default', async () => {
  await renderReport();
  expect(headers()).toEqual(['Category', ...months, 'Average', 'Total']);
  // (-90 + 0 + -30) / 3 months = -40 per month.
  expect(categoryRow()).toEqual(['Groceries', 'm-90000', 'm0', 'm-30000', 'm-40000', 'm-120000']);
});

it('moves Total and Average to the front and remembers it for the user', async () => {
  const user = userEvent.setup();
  await renderReport();
  await user.click(screen.getByRole('combobox', { name: 'Where Total and Average go' }));
  await user.click(await screen.findByRole('option', { name: 'Total and Average first' }));
  expect(headers()).toEqual(['Category', 'Total', 'Average', ...months]);
  expect(categoryRow().slice(0, 3)).toEqual(['Groceries', 'm-120000', 'm-40000']);
  // Only the changed field is written, so another device's change to the
  // other field survives.
  expect(syncedWrites(LEDGER_COLUMNS_KEY).at(-1)).toMatchObject({
    op: 'syncedState.merge',
    payload: { scope: 'user:u1', patch: { set: { summaryFirst: true } } },
  });

  // A later change from another device still shows.
  await receiveSyncedState('user:u1', LEDGER_COLUMNS_KEY, { average: true, summaryFirst: false });
  expect(headers()).toEqual(['Category', ...months, 'Average', 'Total']);
});

it('hides the Average column when turned off, also from another device', async () => {
  await renderReport();
  await receiveSyncedState('user:u1', LEDGER_COLUMNS_KEY, { average: false, summaryFirst: true });
  expect(headers()).toEqual(['Category', 'Total', ...months]);
  await userEvent.setup().click(screen.getByRole('switch', { name: 'Average column' }));
  expect(headers()).toEqual(['Category', 'Total', 'Average', ...months]);
});

it('closes the front summary block with a border whichever column is last', async () => {
  await renderReport();
  await receiveSyncedState('user:u1', LEDGER_COLUMNS_KEY, { average: false, summaryFirst: true });
  const total = within(screen.getByRole('table'))
    .getAllByRole('columnheader')
    .find((cell) => cell.textContent === 'Total')!;
  expect(total).toHaveClass('border-r');

  await receiveSyncedState('user:u1', LEDGER_COLUMNS_KEY, { average: true, summaryFirst: true });
  const [, totalHead, averageHead] = within(screen.getByRole('table')).getAllByRole('columnheader');
  expect(totalHead).not.toHaveClass('border-r');
  expect(averageHead).toHaveClass('border-r');
});
