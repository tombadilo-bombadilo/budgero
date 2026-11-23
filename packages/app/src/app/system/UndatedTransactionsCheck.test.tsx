import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { useUiStore } from '@shared/store/useUiStore';
import { UndatedTransactionsCheck } from './UndatedTransactionsCheck';

const mocks = vi.hoisted(() => ({
  listUndatedTransactions: vi.fn(),
  mutateAsync: vi.fn(),
  track: vi.fn(),
}));
vi.mock('@shared/lib/analytics/track', () => ({ track: mocks.track }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => ({ transactions: mocks }),
    servicesReady: () => true,
    getActiveSpaceId: () => useUiStore.getState().selectedBudget?.SpaceID,
  }),
}));
vi.mock('@entities/transaction/api/mutations', () => ({
  useUpdateTransactionColumn: () => ({ mutateAsync: mocks.mutateAsync }),
}));

const CLEAN_KEY = 'budgero:undated-transactions-clean:space-a';
const row = {
  id: 671,
  budgetId: 1,
  budgetName: 'Home',
  accountId: 174,
  accountName: 'Checking',
  currency: 'USD',
  payee: 'Landlord',
  memo: null,
  inflow: 0,
  outflow: 1_200_000,
  suggestedDate: '2026-11-03',
};

function renderCheck() {
  return render(
    <I18nProvider i18n={i18n}>
      <UndatedTransactionsCheck />
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  i18n.loadAndActivate({ locale: 'en', messages: {} });
  mocks.mutateAsync.mockResolvedValue(undefined);
  useUiStore.setState({
    selectedBudget: {
      ID: 1,
      SpaceID: 'space-a',
      Name: 'Home',
      DisplayCurrency: 'USD',
      BadgeIcon: '',
      NumberFormat: '$1,096.56',
      RtaMode: 'cumulative',
    },
  });
});
afterEach(cleanup);

it('remembers a clean result and does not check again', () => {
  mocks.listUndatedTransactions.mockReturnValue([]);
  const first = renderCheck();
  expect(mocks.listUndatedTransactions).toHaveBeenCalledOnce();
  expect(window.localStorage.getItem(CLEAN_KEY)).toBe('1');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mocks.track.mock.calls).toEqual([
    ['undated_transactions_checked', { found_bucket: '0', suggested: 'no' }],
  ]);
  first.unmount();

  renderCheck();
  expect(mocks.listUndatedTransactions).toHaveBeenCalledOnce();
});

it('asks for a date, saves it and only then marks the space clean', async () => {
  mocks.listUndatedTransactions.mockReturnValueOnce([row]).mockReturnValue([]);
  renderCheck();
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.getByText('Landlord')).toBeTruthy();
  expect(window.localStorage.getItem(CLEAN_KEY)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Save date' }));
  await waitFor(() =>
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      transactionId: 671,
      column: 'Date',
      value: '2026-11-03',
      accountId: 174,
    })
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(window.localStorage.getItem(CLEAN_KEY)).toBe('1');
  expect(mocks.track.mock.calls).toEqual([
    ['undated_transactions_checked', { found_bucket: '1', suggested: 'yes' }],
    ['undated_transaction_dated', { kept_suggestion: 'yes' }],
  ]);
});

it('cannot save without a date and asks again next start after Later', async () => {
  mocks.listUndatedTransactions.mockReturnValue([{ ...row, suggestedDate: null }]);
  const first = renderCheck();
  await screen.findByRole('dialog');
  expect((screen.getByRole('button', { name: 'Save date' }) as HTMLButtonElement).disabled).toBe(
    true
  );
  fireEvent.click(screen.getByRole('button', { name: 'Later' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(CLEAN_KEY)).toBeNull();
  first.unmount();

  renderCheck();
  expect(await screen.findByRole('dialog')).toBeTruthy();
});
