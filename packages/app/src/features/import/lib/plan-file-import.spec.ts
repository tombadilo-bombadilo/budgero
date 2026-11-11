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
  it('requires an explicit fallback for rows that name no account', async () => {
    const input = options();
    input.parsedData.rows[0] = { ...input.parsedData.rows[0], Payee: '' };
    input.columnMapping = {
      ...input.columnMapping,
      account: 'Payee',
    } as typeof input.columnMapping;
    input.importConfig.defaultAccountId = null as unknown as number;
    await expect(buildFileImportPreview(input)).rejects.toThrow('Choose a destination account');
    input.importConfig.defaultAccountId = -1;
    expect((await buildFileImportPreview(input))[0].parsed.account).toBe('Import Account (new)');
  });
  it('sends a single unmatched account name to the account chosen in the dialog', async () => {
    const input = options();
    input.columnMapping = {
      ...input.columnMapping,
      account: 'Payee',
    } as typeof input.columnMapping;
    const [row] = await buildFileImportPreview(input);
    expect(row.input.accountId).toBe(1);
    input.importConfig.defaultAccountId = null as unknown as number;
    await expect(buildFileImportPreview(input)).rejects.toThrow('Choose a destination account');
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

describe('accounts in the file', () => {
  function multi() {
    const input = options();
    input.parsedData.headers = ['Date', 'Amount', 'Payee', 'Account'];
    input.parsedData.rows = [
      { Date: '2026-09-01', Amount: '-10', Payee: 'Coffee', Account: '12345678' },
      { Date: '2026-09-02', Amount: '-20', Payee: 'Fuel', Account: 'VISA-99' },
      { Date: '2026-09-03', Amount: '-30', Payee: 'Rent', Account: 'OLD-01' },
    ] as unknown as typeof input.parsedData.rows;
    input.columnMapping = {
      ...input.columnMapping,
      account: 'Account',
    } as typeof input.columnMapping;
    input.importConfig = {
      ...input.importConfig,
      defaultAccountId: null as unknown as number,
      accountRoutes: {
        '12345678': { kind: 'existing', accountId: 1 },
        'VISA-99': { kind: 'new', name: 'Visa card' },
        'OLD-01': { kind: 'skip' },
      },
    };
    return input;
  }

  it('sends each account to its choice: existing, new, or skipped', async () => {
    const rows = await buildFileImportPreview(multi());
    expect(rows[0].input).toMatchObject({ accountId: 1, valid: true });
    expect(rows[1].input.accountId).toBeLessThanOrEqual(-100);
    expect(rows[1].input.valid).toBe(true);
    expect(rows[1].parsed.account).toBe('Visa card (new)');
    expect(rows[2].input.valid).toBe(false);
  });

  it('gives every new account its own placeholder', async () => {
    const input = multi();
    input.importConfig.accountRoutes!['OLD-01'] = { kind: 'new', name: 'Old' };
    const rows = await buildFileImportPreview(input);
    expect(new Set([rows[1].input.accountId, rows[2].input.accountId]).size).toBe(2);
  });

  it('marks rows of a skipped account as skipped by the user, not invalid', async () => {
    const rows = await buildFileImportPreview(multi());
    expect(rows[2].accountSkipped).toBe(true);
    expect(rows[0].accountSkipped).toBeUndefined();
  });

  it('puts sources given the same new name into one new account', async () => {
    const input = multi();
    input.importConfig.accountRoutes!['OLD-01'] = { kind: 'new', name: ' visa  CARD ' };
    const rows = await buildFileImportPreview(input);
    expect(rows[2].input.accountId).toBe(rows[1].input.accountId);
  });

  it('refuses a new account whose name is already taken', async () => {
    const input = multi();
    input.importConfig.accountRoutes!['VISA-99'] = { kind: 'new', name: 'checking' };
    await expect(buildFileImportPreview(input)).rejects.toThrow('already exists');
  });

  it('creates new accounts in the file currency, else the budget currency', async () => {
    const input = multi();
    input.parsedData.rows[1] = {
      ...input.parsedData.rows[1],
      Currency: 'EUR',
    } as (typeof input.parsedData.rows)[number];
    input.importConfig.accountRoutes!['OLD-01'] = { kind: 'new', name: 'Old' };
    const rows = await buildFileImportPreview({ ...input, newCurrency: 'GBP' });
    expect(rows[1].input.currency).toBe('EUR');
    expect(rows[2].input.currency).toBe('GBP');
  });

  it('ignores a remembered route to an archived account', async () => {
    const input = multi();
    input.importConfig.accountRoutes = {};
    input.accounts = [
      { ID: 1, Name: 'Checking', Currency: 'USD' },
      { ID: 2, Name: 'Card', Currency: 'USD', Archived: true } as (typeof input.accounts)[number],
    ];
    const rows = await buildFileImportPreview({
      ...input,
      rememberedRoutes: { '12345678': 1, 'VISA-99': 2 },
    });
    expect(rows[0].input.accountId).toBe(1);
    expect(rows[1].input.accountId).toBeLessThanOrEqual(-100);
  });
});

describe('a transfer into an account that is not in the file', () => {
  function qif() {
    const input = options();
    input.parsedData.source.type = 'qif' as 'csv';
    input.parsedData.headers = ['Date', 'Amount', 'Payee', 'TransferAccount'];
    input.parsedData.rows = [
      { Date: '2026-09-01', Amount: '-100', Payee: 'To savings', TransferAccount: 'Savings' },
      { Date: '2026-09-05', Amount: '-50', Payee: 'To savings', TransferAccount: 'Savings' },
    ];
    input.accounts = [
      { ID: 1, Name: 'Checking', Currency: 'USD' },
      { ID: 2, Name: 'Savings', Currency: 'USD' },
    ];
    // Savings already has the first transfer (its own file, or bank sync).
    const plan = vi.fn((rows: DuplicateInput[]) =>
      rows.map((row) =>
        row.accountId === 2 && row.date === '2026-09-01' && row.inflow === 100000
          ? {
              index: row.index,
              status: 'needs-review' as const,
              candidates: [
                { id: 900, date: row.date, inflow: 100000, outflow: 0, payee: '', memo: '' },
              ],
              reason: 'Same date and amount in this account',
            }
          : { index: row.index, status: 'new' as const, candidates: [], reason: '' }
      )
    );
    input.duplicates = { plan } as Pick<ImportDuplicateService, 'plan'>;
    return { input, plan };
  }

  it('checks the other account for the mirror leg and never writes a second copy', async () => {
    const { input, plan } = qif();
    const tolerance = { toleranceBps: 100, dayWindow: 3 };
    const rows = await buildFileImportPreview({ ...input, tolerance });
    const mirrors = plan.mock.calls.at(-1)![0];
    expect(mirrors.map((m) => [m.accountId, m.inflow, m.outflow, m.date])).toEqual([
      [2, 100000, 0, '2026-09-01'],
      [2, 50000, 0, '2026-09-05'],
    ]);
    expect(plan.mock.calls.at(-1)![1]).toEqual({ tolerance });
    // Already there: imported as a plain transaction, and the preview says why.
    expect(rows[0].transfer).toBeUndefined();
    expect(rows[0].otherSideExists).toEqual({ counterpartName: 'Savings', transactionId: 900 });
    expect(rows[1].transfer).toEqual({ counterpartAccountId: 2, counterpartName: 'Savings' });
    expect(rows[1].otherSideExists).toBeUndefined();
  });
});
