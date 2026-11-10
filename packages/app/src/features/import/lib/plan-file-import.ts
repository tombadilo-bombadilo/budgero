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
import {
  IMPORT_ACCOUNT_PLACEHOLDER,
  isPlaceholderAccountId,
  planAccountRoutes,
  type RouteProblem,
} from './account-routes';
import { planFileTransfers, transferTargetsOf } from './plan-transfers';

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
  accounts: { ID: number; Name: string; Currency: string; Archived?: boolean }[];
  skippedRowIndices: Set<number>;
  selectedHeaderIndex: number | null;
  runKey: string;
  duplicates: Pick<ImportDuplicateService, 'plan'>;
  /** The duplicate-hint settings; rows within it can be matched to hand-entered transactions. */
  tolerance?: DuplicateTolerance;
  /** Earlier account choices on this device (readRememberedRoutes). */
  rememberedRoutes?: Record<string, number>;
  /**
   * Currency of accounts the import creates when the file states none:
   * the budget's. Defaults to importConfig.accountCurrency.
   */
  newCurrency?: string;
}

interface Destination {
  accountName: string;
  destinationId: number | null;
  account?: { ID: number; Name: string; Currency: string };
  currency: string;
  newAccountName?: string;
  problem?: RouteProblem;
  /** The user chose not to import this row's account. */
  skipped: boolean;
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
  rememberedRoutes,
  newCurrency,
}: FilePreviewOptions): Promise<PreviewRow[]> {
  const bytes = await parsedData.source.file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const fileHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
    ''
  );
  // The destination account decides the storage scale amounts are planned at
  // (milliunits for fiat, sats for BTC). A row that names an account follows
  // that account's route (see account-routes.ts); a row that names none goes
  // to the default account, or a new "Import Account".
  const newAccountCurrency = newCurrency ?? importConfig.accountCurrency;
  const routePlan = planAccountRoutes({
    rows: parsedData.rows,
    column: columnMapping.account,
    accounts,
    remembered: rememberedRoutes,
    chosen: importConfig.accountRoutes,
    newAccountCurrency,
    fallbackAccountId: importConfig.defaultAccountId,
  });
  const destinationOf = (row: Record<string, string>): Destination => {
    const accountName = columnMapping.account ? (row[columnMapping.account]?.trim() ?? '') : '';
    const target = accountName ? routePlan.targets.get(accountName) : undefined;
    if (target?.kind === 'skip') {
      return { accountName, destinationId: null, currency: newAccountCurrency, skipped: true };
    }
    if (target?.kind === 'unset') {
      return { accountName, destinationId: null, currency: newAccountCurrency, skipped: false };
    }
    if (target?.kind === 'new') {
      return {
        accountName,
        destinationId: target.placeholderId,
        currency: target.currency,
        newAccountName: target.name,
        problem: routePlan.problems.get(accountName),
        skipped: false,
      };
    }
    const destinationId = target ? target.accountId : importConfig.defaultAccountId;
    const account = accounts.find((a) => a.ID === destinationId);
    return {
      accountName,
      destinationId,
      account,
      currency: account?.Currency ?? newAccountCurrency,
      skipped: false,
    };
  };
  const destinations = parsedData.rows.map(destinationOf);
  const plans = planImportRows(parsedData.rows, columnMapping, importConfig, (_row, index) =>
    getCurrencyScale(destinations[index].currency)
  );
  const accountLabel = (accountId: number, destination: Destination) => {
    const existing = accounts.find((a) => a.ID === accountId)?.Name;
    if (existing) return existing;
    if (destination.newAccountName) return t`${destination.newAccountName} (new)`;
    if (accountId === IMPORT_ACCOUNT_PLACEHOLDER) return t`Import Account (new)`;
    return destination.accountName;
  };
  const inputs = plans.map((plan) => {
    const row = parsedData.rows[plan.index];
    const destination = destinations[plan.index];
    const { accountName, destinationId, account, currency } = destination;
    const valid =
      plan.status === 'ready' && !skippedRowIndices.has(plan.index) && !destination.skipped;
    const newName = destination.newAccountName ?? '';
    if (valid && destination.problem === 'name-taken')
      throw new Error(
        t`An account named "${newName}" already exists. In Configuration, choose it for "${accountName}" or give the new account another name.`
      );
    if (valid && destination.problem === 'currency')
      throw new Error(
        t`"${accountName}" and the new account "${newName}" (${currency}) are in different currencies. Give "${accountName}" its own account in Configuration.`
      );
    const isNew = destinationId != null && isPlaceholderAccountId(destinationId);
    if (valid && !account && !isNew)
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
  const transfers = planFileTransfers({
    // Rows the user skipped still count as a side: their pair stays plain
    // instead of creating the skipped side anyway.
    rows: inputs.map((input, index) => ({
      ...input,
      accountId: destinations[index].destinationId,
      ready: plans[index].status === 'ready' && !destinations[index].skipped,
    })),
    targets: transferTargetsOf(parsedData.rows, parsedData.headers, columnMapping.payee),
    routePlan,
    accounts,
    remembered: rememberedRoutes,
  });
  return inputs.map((input, index) => ({
    input,
    ...(destinations[index].skipped && plans[index].status === 'ready'
      ? { accountSkipped: true }
      : {}),
    ...(transfers.has(index) ? { transfer: transfers.get(index) } : {}),
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
      account: accountLabel(input.accountId, destinations[index]),
    },
  }));
}
