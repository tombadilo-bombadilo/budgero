import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PreviewStep } from './PreviewStep';
import { DEFAULT_IMPORT_CONFIG, type PreviewRow } from '../../model/types';

afterEach(cleanup);
const makeRow = (index: number): PreviewRow => ({
  input: {
    index,
    valid: true,
    budgetId: 1,
    accountId: 1,
    currency: 'USD',
    date: '2026-09-01',
    inflow: 0,
    outflow: 10000,
    payee: 'Coffee',
    memo: `Purchase ${index}`,
    fileRowKey: `row-${index}`,
    operationId: `op-${index}`,
  },
  original: {},
  parsed: { account: 'Checking' },
  errors: [],
  duplicate: { index, status: 'new', candidates: [], reason: '' },
});
function props(rows: PreviewRow[]) {
  return {
    previewData: rows,
    previewTotalCount: rows.length,
    previewImportableCount: rows.length,
    previewSkippedCount: 0,
    columnMapping: {},
    importConfig: DEFAULT_IMPORT_CONFIG,
    hasBudgetSelected: true,
    onBack: vi.fn(),
    onStartImport: vi.fn(),
    onDecision: vi.fn(),
    onResolveAll: vi.fn(),
  };
}
describe('import review', () => {
  it('blocks unresolved rows beyond 500 and exposes them through the review filter', () => {
    const rows = Array.from({ length: 550 }, (_, i) => makeRow(i));
    rows[549].duplicate.status = 'needs-review';
    const callbacks = props(rows);
    render(<PreviewStep {...callbacks} />);
    expect(screen.getByRole('button', { name: 'Import 549 transactions' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Needs review (1)' }));
    expect(screen.getByText('Purchase 549')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Skip$/ }));
    expect(callbacks.onDecision).toHaveBeenCalledWith(549, 'skip');
    fireEvent.click(screen.getByRole('button', { name: 'Import all unresolved as new' }));
    expect(callbacks.onResolveAll).toHaveBeenCalledWith('import');
  });
  it('shows nothing new for confirmed repeats and allows an explicit override', () => {
    const row = makeRow(0);
    row.duplicate.status = 'already-imported';
    row.decision = 'skip';
    const callbacks = props([row]);
    render(<PreviewStep {...callbacks} />);
    expect(screen.getByText('Nothing new to import.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import anyway' }));
    expect(callbacks.onDecision).toHaveBeenCalledWith(0, 'import');
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(callbacks.onStartImport).toHaveBeenCalledOnce();
  });
  it('offers Match for a candidate and labels a match-only run', () => {
    const row = makeRow(0);
    row.duplicate = {
      index: 0,
      status: 'needs-review',
      reason: 'Similar amount and date in this account',
      candidates: [
        { id: 7, date: '2026-08-30', inflow: 0, outflow: 10000, payee: 'Coffee', memo: '' },
      ],
    };
    const unresolved = props([row]);
    render(<PreviewStep {...unresolved} />);
    fireEvent.click(screen.getByRole('button', { name: /^Match$/ }));
    expect(unresolved.onDecision).toHaveBeenCalledWith(0, 'match');
    fireEvent.click(screen.getByRole('button', { name: 'Match all unresolved' }));
    expect(unresolved.onResolveAll).toHaveBeenCalledWith('match');
    cleanup();

    const decided = props([{ ...row, decision: 'match' }]);
    render(<PreviewStep {...decided} />);
    expect(screen.getByText(/0 to import · 1 matched/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Match 1 transaction' }));
    expect(decided.onStartImport).toHaveBeenCalledOnce();
  });
});
