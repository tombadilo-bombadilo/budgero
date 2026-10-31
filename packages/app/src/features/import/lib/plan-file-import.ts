import { t } from '@lingui/core/macro';
import {
  planImportRows,
  importSourceKey,
  getCurrencyScale,
  scaledToDecimal,
  type ImportDuplicateService,
  type DuplicateTolerance,
} from '@budgero/core/browser';
import type { ParsedData, ColumnMapping, ImportConfig, PreviewRow } from '../model/types';

const DEFAULT_TOLERANCE: DuplicateTolerance = { toleranceBps: 100, dayWindow: 7 };

/** The hand-entry duplicate settings (Settings → Duplicate transactions), reused for imports. */
export function importTolerance(services: unknown): DuplicateTolerance {
  const settings = (
    services as { userMeta?: { getDuplicateHintSettings?: () => DuplicateTolerance } }
  ).userMeta?.getDuplicateHintSettings?.();
  return settings
    ? { toleranceBps: settings.toleranceBps, dayWindow: settings.dayWindow }
    : DEFAULT_TOLERANCE;
}

interface FilePreviewOptions {
  parsedData: ParsedData;
  budgetId: number;
  columnMapping: ColumnMapping;
  importConfig: ImportConfig;
  accounts: { ID: number; Name: string; Currency: string }[];
  skippedRowIndices: Set<number>;
  selectedHeaderIndex: number | null;
  runKey: string;
  duplicates: Pick<ImportDuplicateService, 'plan'>;
  /** The duplicate-hint settings; rows within it can be matched to hand-entered transactions. */
  tolerance?: DuplicateTolerance;
}

export async function buildFileImportPreview({
  parsedData,
  budgetId,
  columnMapping,
  importConfig,
  accounts,
  skippedRowIndices,
  selectedHeaderIndex,
  runKey,
  duplicates,
  tolerance,
}: FilePreviewOptions): Promise<PreviewRow[]> {
  const bytes = await parsedData.source.file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const fileHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
    ''
  );
  // The destination account (Account column match, else the default, else a
  // new "Import Account" in importConfig.accountCurrency) decides the storage
  // scale amounts are planned at: milliunits for fiat, sats for BTC.
  const destinationOf = (row: Record<string, string>) => {
    const accountName = columnMapping.account ? row[columnMapping.account]?.trim() : '';
    const matches = accountName
      ? accounts?.filter((a) => a.Name.toLowerCase() === accountName.toLowerCase())
      : [];
    const destinationId = matches?.length === 1 ? matches[0].ID : importConfig.defaultAccountId;
    const account = accounts?.find((a) => a.ID === destinationId);
    return {
      accountName,
      destinationId,
      account,
      currency: account?.Currency ?? importConfig.accountCurrency,
    };
  };
  const plans = planImportRows(parsedData.rows, columnMapping, importConfig, (row) =>
    getCurrencyScale(destinationOf(row).currency)
  );
  const inputs = plans.map((plan) => {
    const row = parsedData.rows[plan.index];
    const { accountName, destinationId, account, currency } = destinationOf(row);
    const valid = plan.status === 'ready' && !skippedRowIndices.has(plan.index);
    if (valid && !account && destinationId !== -1)
      throw new Error(
        t`Choose a destination account in Configuration for row ${plan.index + 1}${accountName ? ` (${accountName})` : ''}.`
      );
    if (
      valid &&
      (parsedData.source.type === 'ofx' || parsedData.source.type === 'camt') &&
      row.Currency &&
      row.Currency !== currency
    ) {
      throw new Error(
        t`Row ${plan.index + 1} is in ${row.Currency}; choose an account in that currency.`
      );
    }
    const interpretation = [
      plan.date,
      plan.inflow,
      plan.outflow,
      plan.payee,
      plan.memo,
      currency,
      columnMapping.category ? row[columnMapping.category] : '',
      importConfig.skipRows,
      selectedHeaderIndex,
    ];
    const fileRowKey = JSON.stringify(['v1', fileHash, plan.index, interpretation]);
    return {
      ...plan,
      valid,
      budgetId,
      accountId: destinationId ?? 0,
      currency,
      operationId: `${runKey}:${budgetId}:${destinationId}:${fileRowKey}`,
      fileRowKey,
      sourceKey: importSourceKey(parsedData.source.type, row),
    };
  });
  const matches = duplicates.plan(inputs, tolerance ? { tolerance } : {});
  return inputs.map((input, index) => ({
    input,
    duplicate: matches[index],
    decision:
      matches[index].status === 'already-imported'
        ? 'skip'
        : matches[index].suggestMatch
          ? 'match'
          : undefined,
    original: parsedData.rows[index],
    errors: plans[index].errors,
    parsed: {
      date: input.date,
      amount: scaledToDecimal(input.inflow - input.outflow, input.currency),
      payee: input.payee,
      memo: input.memo,
      account: accounts?.find((a) => a.ID === input.accountId)?.Name ?? 'Import Account (new)',
    },
  }));
}
