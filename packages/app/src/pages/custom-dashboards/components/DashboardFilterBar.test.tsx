import { fireEvent, render, screen } from '@testing-library/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardFilters } from '@features/reports/lib/question';
import { DashboardFilterBar } from './DashboardFilterBar';
import { pruneDashboardFilters } from './prune-filters';

const optionState = vi.hoisted(() => ({
  account: [] as { value: number; label: string }[],
  categoryGroup: [] as { value: number; label: string }[],
}));

vi.mock('@features/reports/ui/notebook/useFieldValueOptions', () => ({
  useFieldValueOptions: () => (kind: 'account' | 'categoryGroup') => optionState[kind],
}));

function renderBar(filters: DashboardFilters, onChange = vi.fn()) {
  render(
    <I18nProvider i18n={i18n}>
      <DashboardFilterBar budgetId={1} filters={filters} onChange={onChange} />
    </I18nProvider>
  );
  return onChange;
}

beforeEach(() => {
  i18n.load('en', {});
  i18n.activate('en');
  optionState.account = [
    { value: 1, label: 'Checking' },
    { value: 2, label: 'Savings' },
  ];
  optionState.categoryGroup = [{ value: 10, label: 'Bills' }];
});

describe('pruneDashboardFilters', () => {
  const existing = { accounts: [1, 2], categoryGroups: [10] };

  it('returns the same object when every id exists', () => {
    const filters: DashboardFilters = { accounts: [2], categoryGroups: [10] };
    expect(pruneDashboardFilters(filters, existing)).toBe(filters);
  });

  it('drops ids that no longer exist and empty lists', () => {
    expect(
      pruneDashboardFilters(
        { date: { preset: 'thisYear' }, accounts: [1, 99], categoryGroups: [77] },
        existing
      )
    ).toEqual({ date: { preset: 'thisYear' }, accounts: [1] });
  });

  it('prunes nothing while the options are not loaded', () => {
    const filters: DashboardFilters = { accounts: [99], categoryGroups: [77] };
    expect(pruneDashboardFilters(filters, { accounts: [], categoryGroups: [] })).toBe(filters);
  });
});

describe('DashboardFilterBar', () => {
  it('drops deleted accounts and category groups from the saved filters', () => {
    const onChange = renderBar({ accounts: [1, 99], categoryGroups: [77] });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ accounts: [1] });
    expect(screen.getByRole('button', { name: 'Accounts: Checking' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Category groups: All category groups' })
    ).toBeInTheDocument();
  });

  it('hides "Clear filters" when only deleted ids were selected', () => {
    const onChange = renderBar({ accounts: [99] });
    expect(onChange).toHaveBeenCalledWith({});
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('keeps the selection, and shows it, while options are still loading', () => {
    optionState.account = [];
    const onChange = renderBar({ accounts: [1, 99] });
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Accounts: Accounts: 2 selected' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('reopens a saved custom range for editing', () => {
    const onChange = renderBar({
      date: { preset: 'custom', from: '2026-01-01', to: '2026-02-15' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit custom range' }));
    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    expect(from).toHaveValue('2026-01-01');
    expect(to).toHaveValue('2026-02-15');

    fireEvent.change(to, { target: { value: '2025-12-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The end date must be on or after the start date.'
    );
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    fireEvent.change(to, { target: { value: '2026-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({
      date: { preset: 'custom', from: '2026-01-01', to: '2026-03-01' },
    });
  });

  it('offers no edit button for presets', () => {
    renderBar({ date: { preset: 'thisYear' } });
    expect(screen.queryByRole('button', { name: 'Edit custom range' })).not.toBeInTheDocument();
  });
});
