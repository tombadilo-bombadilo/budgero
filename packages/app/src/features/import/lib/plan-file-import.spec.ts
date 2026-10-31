import { describe, it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { ImportDuplicateService, DuplicateInput } from '@budgero/core/browser';
import { buildFileImportPreview } from './plan-file-import';
import { DEFAULT_IMPORT_CONFIG } from '../model/types';

function options() {
  const bytes = new TextEncoder().encode('Date,Amount,Payee\n2026-09-01,-10,Coffee');
  return {
    parsedData: {
      source: {
        type: 'csv' as const,
        fileName: 'original.csv',
        file: { arrayBuffer: async () => bytes.buffer } as File,
      },
      headers: ['Date', 'Amount', 'Payee'],
      rows: [{ Date: '2026-09-01', Amount: '-10', Payee: 'Coffee' }],
    },
    budgetId: 1,
    columnMapping: { date: 'Date', amount: 'Amount', payee: 'Payee' },
    importConfig: { ...DEFAULT_IMPORT_CONFIG, defaultAccountId: 1 },
    accounts: [{ ID: 1, Name: 'Checking', Currency: 'USD' }],
    skippedRowIndices: new Set<number>(),
    selectedHeaderIndex: null,
    runKey: 'run',
    duplicates: {
      plan: (rows: DuplicateInput[]) =>
        rows.map((row) => ({
          index: row.index,
          status: row.valid ? 'new' : 'invalid',
          candidates: [],
          reason: '',
        })),
    } as Pick<ImportDuplicateService, 'plan'>,
  };
}
vi.stubGlobal('crypto', webcrypto);

describe('file preview identity and destinations', () => {
  it('uses file bytes, not the filename or attempt ID, for duplicate identity', async () => {
    const input = options();
    const original = (await buildFileImportPreview(input))[0];
    input.parsedData.source.fileName = 'renamed.csv';
    input.runKey = 'another-attempt';
    const renamed = (await buildFileImportPreview(input))[0];
    expect(original.input.fileRowKey).toBe(renamed.input.fileRowKey);
    expect(original.input.operationId).not.toBe(renamed.input.operationId);
  });
  it('keeps original row indices when users skip rows, and visits rows past 500', async () => {
    const input = options();
    input.parsedData.rows = Array.from({ length: 550 }, () => ({ ...input.parsedData.rows[0] }));
    input.skippedRowIndices.add(0);
    const rows = await buildFileImportPreview(input);
    expect(rows).toHaveLength(550);
    expect(rows[0].input.valid).toBe(false);
    expect(rows[549].input.index).toBe(549);
  });
  it('requires an explicit fallback for an unmatched account name', async () => {
    const input = options();
    input.columnMapping = {
      ...input.columnMapping,
      account: 'Payee',
    } as typeof input.columnMapping;
    input.importConfig.defaultAccountId = null as unknown as number;
    await expect(buildFileImportPreview(input)).rejects.toThrow('Choose a destination account');
    input.importConfig.defaultAccountId = -1;
    expect((await buildFileImportPreview(input))[0].parsed.account).toBe('Import Account (new)');
  });
  it('reconsiders changed mappings and destination interpretation', async () => {
    const input = options();
    const before = (await buildFileImportPreview(input))[0];
    input.columnMapping.payee = '';
    const after = (await buildFileImportPreview(input))[0];
    expect(after.input.fileRowKey).not.toBe(before.input.fileRowKey);
    expect(after.input.operationId).not.toBe(before.input.operationId);
  });
  it('forwards the statement tolerance and defaults suggested matches to Match', async () => {
    const input = options();
    const plan = vi.fn((rows: DuplicateInput[], _options?: unknown) =>
      rows.map((row) => ({
        index: row.index,
        status: 'needs-review' as const,
        candidates: [],
        reason: 'Similar amount and date in this account',
        suggestMatch: true,
      }))
    );
    input.duplicates = { plan } as Pick<ImportDuplicateService, 'plan'>;
    const tolerance = { toleranceBps: 50, dayWindow: 3 };
    const [row] = await buildFileImportPreview({ ...input, tolerance });
    expect(plan.mock.calls[0][1]).toEqual({ tolerance });
    expect(row.decision).toBe('match');
  });
});

describe('amounts at the destination account scale', () => {
  function btcOptions() {
    const input = options();
    input.parsedData.rows = [
      { Date: '2026-10-01', Amount: '0.025', Payee: 'Exchange' },
      { Date: '2026-10-02', Amount: '-0.0000085', Payee: 'Network fee' },
    ];
    input.accounts = [
      { ID: 1, Name: 'Checking', Currency: 'USD' },
      { ID: 2, Name: 'Wallet', Currency: 'BTC' },
    ];
    input.importConfig.defaultAccountId = 2;
    return input;
  }

  it('plans sats for an existing BTC account and previews whole BTC', async () => {
    const rows = await buildFileImportPreview(btcOptions());
    expect(rows.map((row) => [row.input.inflow, row.input.outflow])).toEqual([
      [2_500_000, 0],
      [0, 850],
    ]);
    expect(rows.map((row) => row.parsed.amount)).toEqual([0.025, -0.0000085]);
    expect(rows[0].input.currency).toBe('BTC');
  });

  it('plans sats for a new Import Account in BTC', async () => {
    const input = btcOptions();
    input.importConfig = { ...input.importConfig, defaultAccountId: -1, accountCurrency: 'BTC' };
    const rows = await buildFileImportPreview(input);
    expect(rows[1].input.outflow).toBe(850);
    expect(rows[1].parsed.account).toBe('Import Account (new)');
  });

  it('routes rows by the Account column, each at its own scale', async () => {
    const input = btcOptions();
    input.parsedData.rows = [
      { Date: '2026-10-01', Amount: '2500.50', Payee: 'Checking' },
      { Date: '2026-10-02', Amount: '-0.0000085', Payee: 'Wallet' },
    ];
    input.columnMapping = {
      ...input.columnMapping,
      account: 'Payee',
    } as typeof input.columnMapping;
    const rows = await buildFileImportPreview(input);
    expect(rows.map((row) => [row.input.accountId, row.input.inflow, row.input.outflow])).toEqual([
      [1, 2_500_500, 0],
      [2, 0, 850],
    ]);
  });

  it('keeps fiat amounts and row keys exactly as before', async () => {
    const [row] = await buildFileImportPreview(options());
    expect([row.input.inflow, row.input.outflow]).toEqual([0, 10_000]);
    expect(row.parsed.amount).toBe(-10);
    const [, , index, interpretation] = JSON.parse(row.input.fileRowKey);
    expect(index).toBe(0);
    expect(interpretation).toEqual([
      '2026-09-01',
      0,
      10_000,
      'Coffee',
      'Imported transaction',
      'USD',
      '',
      DEFAULT_IMPORT_CONFIG.skipRows,
      null,
    ]);
  });
});
