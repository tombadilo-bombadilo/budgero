import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Budget } from '@budgero/core/browser';
import { EditBudgetForm } from './EditBudgetForm';

const updateCurrency = vi.fn(async () => undefined);
const exportDatabase = vi.fn(async () => new Uint8Array([1, 2, 3]));
const downloadBlob = vi.fn();

const mutation = (fn = vi.fn(async () => undefined)) => ({ mutateAsync: fn, isPending: false });
vi.mock('@entities/budget/api/useBudgets', () => ({
  useUpdateBudgetName: () => mutation(),
  useUpdateBudgetCurrency: () => mutation(updateCurrency),
  useUpdateBudgetIcon: () => mutation(),
  useUpdateBudgetNumberFormat: () => mutation(),
}));
vi.mock('@features/currencies/ui/CurrencySelector', () => ({
  CurrencySelector: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <input aria-label="currency" value={value} onChange={(e) => onValueChange(e.target.value)} />
  ),
}));
vi.mock('@features/budget-management/ui/IconPicker', () => ({ IconPicker: () => null }));
vi.mock('@features/budget-management/ui/FormatSelector', () => ({ FormatSelector: () => null }));
vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => ({ services: () => ({ export: { exportDatabase } }) }),
}));
vi.mock('@entities/user/api/useAuth', () => ({ useRecordBackup: () => ({ mutate: vi.fn() }) }));
vi.mock('@shared/lib/download', () => ({
  downloadBlob: (...args: unknown[]) => downloadBlob(...args),
}));

const budget = {
  ID: 5,
  Name: 'Zoka i Aca',
  DisplayCurrency: 'RSD',
  BadgeIcon: 'dollar',
  NumberFormat: '123,456.78',
} as unknown as Budget;

async function renderForm() {
  const onClose = vi.fn();
  const { container } = render(
    <EditBudgetForm budget={budget} onError={vi.fn()} onClose={onClose} />
  );
  // The form re-reads the budget one microtask after mounting.
  await act(async () => {
    await Promise.resolve();
  });
  const form = container.querySelector('form')!;
  return { form, onClose };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EditBudgetForm currency change', () => {
  it('asks before converting, and converts only after confirming', async () => {
    const { form, onClose } = await renderForm();
    fireEvent.change(screen.getByLabelText('currency'), { target: { value: 'USD' } });
    fireEvent.submit(form);

    expect(await screen.findByText(/Change the budget currency from RSD to USD/)).toBeTruthy();
    expect(updateCurrency).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Download backup/ }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(downloadBlob.mock.calls[0][1]).toMatch(/before-usd\.db$/);
    expect(updateCurrency).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Change currency/ }));
    await waitFor(() => expect(updateCurrency).toHaveBeenCalledWith({ id: 5, currency: 'USD' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('cancel keeps the budget as it was', async () => {
    const { form, onClose } = await renderForm();
    fireEvent.change(screen.getByLabelText('currency'), { target: { value: 'USD' } });
    fireEvent.submit(form);
    fireEvent.click(await screen.findByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(screen.queryByText(/Change the budget currency/)).toBeNull());
    expect(updateCurrency).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('saves other edits without asking', async () => {
    const { form, onClose } = await renderForm();
    fireEvent.submit(form);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/Change the budget currency/)).toBeNull();
  });
});
