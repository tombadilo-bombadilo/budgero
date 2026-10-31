import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotHistoryList } from './SnapshotHistoryList';

const mutateAsync = vi.fn(async () => ({ version: 113, mutation_version: 19369 }));
const history = {
  current: {
    sync_version: 112,
    mutation_version: 25,
    size_bytes: 25_089,
    updated_at: '2026-10-31T02:21:39Z',
    encryption_key_version: 1,
    origin: 'sync' as const,
  },
  entries: [
    {
      id: 7,
      sync_version: 111,
      mutation_version: 19369,
      size_bytes: 2_532_177,
      became_current_at: '2026-10-31T01:15:48Z',
      replaced_at: '2026-10-31T02:21:39Z',
      origin: 'sync' as const,
      encryption_key_version: 1,
      restorable: true,
    },
    {
      id: 6,
      sync_version: 90,
      mutation_version: 19000,
      size_bytes: 2_400_000,
      became_current_at: '2026-10-25T10:00:00Z',
      replaced_at: '2026-10-26T10:00:00Z',
      origin: 'out_of_band' as const,
      encryption_key_version: 0,
      restorable: false,
    },
  ],
};

const summaries: Record<string, unknown> = {
  current: { budgets: 1, accounts: 0, categories: 0, transactions: 0, lastTransactionDate: null },
  7: {
    budgets: 1,
    accounts: 4,
    categories: 31,
    transactions: 2840,
    lastTransactionDate: '2026-10-30',
  },
};
vi.mock('../api/useSnapshotHistory', () => ({
  useSnapshotHistory: () => ({ data: history, isLoading: false, error: null }),
  useRestoreSnapshot: () => ({ mutateAsync, isPending: false }),
  useSnapshotSummary: (entry: number | 'current', enabled: boolean) => ({
    data: enabled ? summaries[String(entry)] : undefined,
    isLoading: false,
    error: null,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

i18n.load('en', {});
i18n.activate('en');

function renderList() {
  return render(
    <I18nProvider i18n={i18n}>
      <SnapshotHistoryList />
    </I18nProvider>
  );
}

describe('SnapshotHistoryList', () => {
  beforeEach(() => mutateAsync.mockClear());

  it('lists the current version and earlier copies with size, log position and contents', () => {
    renderList();
    expect(screen.getByText('Current version')).toBeTruthy();
    expect(screen.getByText(/up to change #19369/)).toBeTruthy();
    // Decrypted on the device: the near-empty current copy vs the full earlier one.
    expect(
      screen.getByText(/0 transactions · 0 accounts · 0 categories · 1 budget\b/)
    ).toBeTruthy();
    expect(
      screen.getByText(/2,840 transactions · 4 accounts · 31 categories · 1 budget\b/)
    ).toBeTruthy();
    expect(screen.getByText(/newest transaction Oct 30, 2026/)).toBeTruthy();
    expect(screen.getByText(/2\.4 MB/)).toBeTruthy();
    expect(screen.getByText(/made before the master password changed/)).toBeTruthy();
  });

  it('only lets restorable copies be restored', () => {
    renderList();
    const buttons = screen.getAllByRole('button', { name: /Restore/ });
    expect(buttons).toHaveLength(2);
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks for confirmation, then restores the chosen copy', async () => {
    renderList();
    fireEvent.click(screen.getAllByRole('button', { name: /Restore/ })[0]!);
    expect(await screen.findByText('Restore this version?')).toBeTruthy();
    const confirm = screen.getAllByRole('button', { name: 'Restore' }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(7));
  });
});
