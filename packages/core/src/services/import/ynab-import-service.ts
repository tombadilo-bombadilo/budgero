import JSZip from 'jszip';
import { DatabaseAdapter } from '../../database/interface.js';
import { asMilli, fromDecimal, ZERO_MILLI } from '../../money/index.js';
import { BudgetService } from '../budgets/index.js';
import { CategoryService } from '../categories/index.js';
import { AccountService } from '../accounts/index.js';
import { isCreditAccountType } from '../accounts/types.js';
import { MonthlyBudgetService } from '../monthly-budgets/index.js';
import { TransactionService } from '../transactions/index.js';
import { SplitService } from '../transactions/split-service.js';
import { ensureCategoryWithGroup } from '../transactions/category-helpers.js';
import {
  YNABImportConfig,
  YNABRegisterRow,
  YNABBudgetRow,
  YNABImportPreview,
  YNABImportResult,
  YNABImportCategorySummary,
  YNABApiPlanSnapshot,
  YNABImportAccountSpec,
  YNABImportCategoryMonthSpec,
  YNABCategoryMonthMismatch,
  YNABDebtBalanceAdjustment,
  YNABImportProgressUpdate,
  YNABImportReadyToAssignSpec,
  YNABReadyToAssignMismatch,
  YNABReadyToAssignCategoryCause,
  YNABReconciliationReport,
} from './types.js';
import { CSVParser } from './csv-parser.js';
import { CurrencyParser } from './currency-parser.js';
import { normalizeYNABApiSnapshot, type NormalizedYNABApiImport } from './ynab-api-normalizer.js';
import {
  inspectYNABCreditPaymentMappings,
  resolveYNABCreditPaymentMappings,
} from './ynab-credit-payment-mapping.js';

import { createLogger } from '../../logger.js';

const debugLog = createLogger('services:import:ynab-import-service');

/** Matches DD/MM/YYYY and MM/DD/YYYY style dates with -, / or . separators. */
const AMBIGUOUS_DATE_REGEX = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/;
const SPLIT_MEMO_REGEX =
  /^\s*Split\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)(?:\s*[:\-–—]\s*|\s+)?([\s\S]*)$/i;

interface ParsedYNABArchive {
  registerRows: YNABRegisterRow[];
  budgetRows: YNABBudgetRow[];
}

interface YNABCategoryDescriptor {
  categoryGroup: string;
  category: string;
  sourceId?: string;
  sourceGroupId?: string;
  systemCategory?: 'Income' | 'Uncategorized' | 'Transfers';
}

interface YNABSplitMarker {
  part: number;
  total: number;
  memo: string;
}

interface YNABSplitGroup {
  startIndex: number;
  rows: YNABRegisterRow[];
  markers: YNABSplitMarker[];
  containsTransfer: boolean;
}

interface YNABAccountBalanceMismatch {
  accountName: string;
  expectedBalance: number;
  computedBalance: number;
  difference: number;
}

const YNAB_MANAGED_DEBT_ACCOUNT_TYPES = new Set([
  'mortgage',
  'autoLoan',
  'studentLoan',
  'personalLoan',
  'medicalDebt',
  'otherDebt',
]);

function transferCounterpartyName(row: YNABRegisterRow): string | null {
  // YNAB identifies register transfers through a synthetic payee named
  // "Transfer : <account>". Ordinary payees, categories, and memos may also
  // contain the word "transfer", so they must not participate in detection.
  const match = (row.Payee || '').trim().match(/^transfer\s*:\s*(.+)$/i);
  return match?.[1].trim() || null;
}

function isTransferRow(row: YNABRegisterRow): boolean {
  if (row.SourceAccountId !== undefined) return Boolean(row.SourceTransferAccountId);
  return transferCounterpartyName(row) !== null;
}

function accountKey(name: string, sourceId?: string | null): string {
  return sourceId ? `id:${sourceId}` : `name:${name.trim()}`;
}

function rowAccountId(row: YNABRegisterRow, accounts: Map<string, number>): number | undefined {
  return accounts.get(accountKey(row.Account, row.SourceAccountId));
}

function categoryKey(category: YNABCategoryDescriptor): string {
  return category.sourceId
    ? `id:${category.sourceId}`
    : `name:${JSON.stringify([category.categoryGroup, category.category])}`;
}

function categoryDescriptor(
  row: Pick<
    YNABRegisterRow | YNABBudgetRow,
    | 'CategoryGroup'
    | 'Category'
    | 'CategoryPath'
    | 'SourceCategoryId'
    | 'SourceCategoryGroupId'
    | 'SourceCategoryInternal'
    | 'SourceCategoryGroupInternal'
  >
): YNABCategoryDescriptor | null {
  if (row.SourceCategoryId) {
    const source = {
      sourceId: row.SourceCategoryId,
      sourceGroupId: row.SourceCategoryGroupId,
    };
    const normalizedName = row.Category.trim().toLowerCase();
    if (row.SourceCategoryInternal && row.CategoryGroup !== 'Credit Card Payments') {
      if (normalizedName.includes('ready to assign') || normalizedName.includes('to be budgeted')) {
        return { ...source, categoryGroup: 'Income', category: 'Income', systemCategory: 'Income' };
      }
      if (normalizedName === 'uncategorized') {
        return {
          ...source,
          categoryGroup: 'Uncategorized',
          category: 'Uncategorized',
          systemCategory: 'Uncategorized',
        };
      }
    }
    // Budgero's system groups have financial meaning. A source user's ordinary
    // group with the same name must remain an ordinary spending envelope.
    const reservedGroup = ['Income', 'Transfers', 'Uncategorized', 'Credit Card Payments'].includes(
      row.CategoryGroup
    );
    return {
      ...source,
      categoryGroup:
        reservedGroup && !row.SourceCategoryGroupInternal
          ? `${row.CategoryGroup} (YNAB)`
          : row.CategoryGroup || 'Imported from YNAB',
      category: row.Category || 'Imported category',
    };
  }
  let categoryGroup = (row.CategoryGroup || '').trim();
  let category = (row.Category || '').trim();
  const categoryPath = (row.CategoryPath || '').trim();

  if ((!categoryGroup || !category) && categoryPath) {
    const separator = categoryPath.indexOf(':');
    if (separator >= 0) {
      categoryGroup ||= categoryPath.slice(0, separator).trim();
      category ||= categoryPath.slice(separator + 1).trim();
    } else {
      category ||= categoryPath;
    }
  }

  if (!category) return null;

  const normalizedGroup = categoryGroup.toLowerCase();
  const normalizedCategory = category.toLowerCase();
  if (
    ['inflow', 'income', 'internal master category'].includes(normalizedGroup) &&
    ['ready to assign', 'to be budgeted', 'to be assigned'].includes(normalizedCategory)
  ) {
    return { categoryGroup: 'Income', category: 'Income', systemCategory: 'Income' };
  }

  if (
    ['', 'uncategorized', 'internal master category'].includes(normalizedGroup) &&
    normalizedCategory === 'uncategorized'
  ) {
    return {
      categoryGroup: 'Uncategorized',
      category: 'Uncategorized',
      systemCategory: 'Uncategorized',
    };
  }

  if (
    ['', 'transfers', 'internal master category'].includes(normalizedGroup) &&
    ['transfer', 'transfers'].includes(normalizedCategory)
  ) {
    return { categoryGroup: 'Transfers', category: 'Transfers', systemCategory: 'Transfers' };
  }

  return {
    categoryGroup: ['Income', 'Transfers', 'Uncategorized'].includes(categoryGroup)
      ? `${categoryGroup} (YNAB)`
      : categoryGroup || 'Imported from YNAB',
    category,
  };
}

function parseSplitMarker(memo: string): YNABSplitMarker | null {
  const match = memo.match(SPLIT_MEMO_REGEX);
  if (!match) return null;

  const part = Number(match[1]);
  const total = Number(match[2]);
  if (
    !Number.isInteger(part) ||
    !Number.isInteger(total) ||
    total < 2 ||
    part < 1 ||
    part > total
  ) {
    return null;
  }

  return { part, total, memo: match[3].trim() };
}

function sameSplitContainer(left: YNABRegisterRow, right: YNABRegisterRow): boolean {
  // YNAB permits a different payee and category on every split line. Account,
  // date, contiguous position, and the complete 1/n sequence define the parent.
  return left.Account.trim() === right.Account.trim() && left.Date.trim() === right.Date.trim();
}

function distinctSplitPayees(rows: YNABRegisterRow[]): string[] {
  return [...new Set(rows.map((row) => row.Payee.trim()).filter(Boolean))];
}

function detectSplitGroups(registerRows: YNABRegisterRow[]): YNABSplitGroup[] {
  const groups: YNABSplitGroup[] = [];

  for (let index = 0; index < registerRows.length; index++) {
    const firstRow = registerRows[index];
    if (firstRow.SourceId !== undefined) {
      // API children are emitted together by their parent. Text in ordinary
      // transaction memos is never evidence of an API split.
      if (!firstRow.SourceSubtransactionId) continue;
      let endIndex = index + 1;
      while (
        endIndex < registerRows.length &&
        registerRows[endIndex].SourceSubtransactionId &&
        registerRows[endIndex].SourceId === firstRow.SourceId &&
        registerRows[endIndex].SourceAccountId === firstRow.SourceAccountId
      ) {
        endIndex++;
      }
      const rows = registerRows.slice(index, endIndex);
      if (rows.length > 0) {
        groups.push({
          startIndex: index,
          rows,
          markers: rows.map((row, partIndex) => ({
            part: partIndex + 1,
            total: rows.length,
            memo: row.Memo,
          })),
          containsTransfer: rows.some(isTransferRow),
        });
      }
      index = endIndex - 1;
      continue;
    }
    const firstMarker = parseSplitMarker(registerRows[index].Memo || '');
    if (!firstMarker || firstMarker.part !== 1) continue;

    const rows = registerRows.slice(index, index + firstMarker.total);
    if (rows.length !== firstMarker.total) continue;

    const markers = rows.map((row) => parseSplitMarker(row.Memo || ''));
    const complete = markers.every(
      (marker, partIndex) =>
        marker?.part === partIndex + 1 &&
        marker.total === firstMarker.total &&
        sameSplitContainer(registerRows[index], rows[partIndex])
    );

    if (!complete) continue;

    groups.push({
      startIndex: index,
      rows,
      markers: markers as YNABSplitMarker[],
      containsTransfer: rows.some(isTransferRow),
    });
    index += firstMarker.total - 1;
  }

  return groups;
}

function inspectDateOrder(dates: (string | undefined)[]): {
  dayFirstEvidence: number;
  monthFirstEvidence: number;
  ambiguous: boolean;
} {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  let hasDistinctDayAndMonth = false;

  for (const raw of dates) {
    const match = raw?.trim().match(AMBIGUOUS_DATE_REGEX);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second >= 1 && second <= 12) dayFirstEvidence++;
    else if (second > 12 && first >= 1 && first <= 12) monthFirstEvidence++;
    else if (first >= 1 && first <= 12 && second >= 1 && second <= 12 && first !== second) {
      hasDistinctDayAndMonth = true;
    }
  }

  return {
    dayFirstEvidence,
    monthFirstEvidence,
    ambiguous: hasDistinctDayAndMonth && dayFirstEvidence === 0 && monthFirstEvidence === 0,
  };
}

function inspectYNABRows(
  registerRows: YNABRegisterRow[],
  budgetRows: YNABBudgetRow[]
): YNABImportPreview {
  const planCategoryKeys = new Set<string>([
    'Income::Income',
    'Uncategorized::Uncategorized',
    'Transfers::Transfers',
  ]);
  const exportedPlanCategoryKeys = new Set<string>();

  for (const row of budgetRows) {
    const descriptor = categoryDescriptor(row);
    if (descriptor) {
      const key = categoryKey(descriptor);
      planCategoryKeys.add(key);
      exportedPlanCategoryKeys.add(key);
    }
  }

  const missing = new Map<string, YNABImportCategorySummary>();
  for (const row of registerRows) {
    const descriptor = categoryDescriptor(row);
    if (!descriptor) continue;
    const key = categoryKey(descriptor);
    if (planCategoryKeys.has(key)) continue;

    const existing = missing.get(key);
    if (existing) {
      existing.transactionCount++;
    } else {
      missing.set(key, { ...descriptor, transactionCount: 1 });
    }
  }

  const splitGroups = detectSplitGroups(registerRows);

  return {
    dateOrderAmbiguous: inspectDateOrder(registerRows.map((row) => row.Date)).ambiguous,
    registerRowCount: registerRows.length,
    accountCount: new Set(
      registerRows
        .filter((row) => row.SourceAccountId || row.Account.trim())
        .map((row) => accountKey(row.Account, row.SourceAccountId))
    ).size,
    categoryCount: exportedPlanCategoryKeys.size + missing.size,
    missingCategories: [...missing.values()],
    splitTransactions: splitGroups
      .filter((group) => !group.containsTransfer)
      .map((group) => ({
        account: group.rows[0].Account.trim(),
        date: group.rows[0].Date.trim(),
        payees: distinctSplitPayees(group.rows),
        partCount: group.rows.length,
      })),
  };
}

async function parseYNABArchive(
  zipData: ArrayBuffer | Uint8Array,
  csvParser: CSVParser
): Promise<ParsedYNABArchive> {
  const zip = new JSZip();
  const zipContent = await zip.loadAsync(zipData);

  let registerData: string | undefined;
  let budgetData: string | undefined;

  for (const [filename, file] of Object.entries(zipContent.files)) {
    if (file.dir) continue;

    const lowerName = filename.toLowerCase();
    if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.tsv')) continue;

    if (lowerName.includes('register') && !registerData) {
      registerData = await file.async('string');
      continue;
    }

    if ((lowerName.includes('budget') || lowerName.includes('plan')) && !budgetData) {
      budgetData = await file.async('string');
    }
  }

  if (!registerData) throw new Error('register CSV file not found in ZIP');
  if (!budgetData) throw new Error('budget CSV file not found in ZIP');

  return {
    registerRows: csvParser.parseRegisterCSV(registerData),
    budgetRows: csvParser.parseBudgetCSV(budgetData),
  };
}

export class YNABImportService {
  private budgetService: BudgetService;

  private categoryService: CategoryService;

  private accountService: AccountService;

  private monthlyBudgetService: MonthlyBudgetService;

  private transactionService: TransactionService;

  private splitService: SplitService;

  private csvParser: CSVParser;

  private currencyParser: CurrencyParser;

  /**
   * Whether ambiguous two-number date formats (01/05/2025) in the current
   * file read day-first (DD/MM) or month-first (MM/DD). Decided once per
   * import by detectAmbiguousDateOrder; day-first is the historical default.
   */
  private ambiguousDayFirst = true;

  constructor(private db: DatabaseAdapter) {
    this.budgetService = new BudgetService(db);
    this.categoryService = new CategoryService(db);
    this.accountService = new AccountService(db);
    this.monthlyBudgetService = new MonthlyBudgetService(db);
    this.transactionService = new TransactionService(db);
    this.splitService = new SplitService(db);
    this.csvParser = new CSVParser();
    this.currencyParser = new CurrencyParser();
  }

  static async inspectYNABZip(zipData: ArrayBuffer | Uint8Array): Promise<YNABImportPreview> {
    const { registerRows, budgetRows } = await parseYNABArchive(zipData, new CSVParser());
    return inspectYNABRows(registerRows, budgetRows);
  }

  static inspectYNABApiSnapshot(snapshot: YNABApiPlanSnapshot): YNABImportPreview {
    const { registerRows, budgetRows, accountSpecs } = normalizeYNABApiSnapshot(snapshot);
    const { matching } = inspectYNABCreditPaymentMappings(snapshot);
    return {
      ...inspectYNABRows(registerRows, budgetRows),
      accountCount: accountSpecs.length,
      ...(matching ? { creditPaymentMatching: matching } : {}),
    };
  }

  async importYNABFromZip(
    zipData: ArrayBuffer | Uint8Array,
    config: YNABImportConfig
  ): Promise<number> {
    const result = await this.importYNABFromZipWithSummary(zipData, config);
    return result.budgetId;
  }

  async importYNABFromZipWithSummary(
    zipData: ArrayBuffer | Uint8Array,
    config: YNABImportConfig
  ): Promise<YNABImportResult> {
    const { registerRows, budgetRows } = await parseYNABArchive(zipData, this.csvParser);
    return this.importYNABRowsWithSummary(
      registerRows,
      budgetRows,
      config,
      config.sourceNumberFormat ?? config.numberFormat
    );
  }

  async importYNABFromApiSnapshotWithSummary(
    snapshot: YNABApiPlanSnapshot,
    config: YNABImportConfig
  ): Promise<YNABImportResult> {
    const creditPaymentMappings = resolveYNABCreditPaymentMappings(
      snapshot,
      config.creditPaymentMappings
    );
    const {
      registerRows,
      budgetRows,
      accountSpecs,
      categoryMonthSpecs,
      readyToAssignSpecs,
      source,
    } = normalizeYNABApiSnapshot(snapshot);
    return this.importYNABRowsWithSummary(
      registerRows,
      budgetRows,
      config,
      '123,456.78',
      accountSpecs.map((spec) => ({
        ...spec,
        ...(creditPaymentMappings.has(spec.ynabAccountId)
          ? { creditPaymentYNABCategoryId: creditPaymentMappings.get(spec.ynabAccountId)! }
          : {}),
      })),
      readyToAssignSpecs,
      categoryMonthSpecs,
      source
    );
  }

  private async importYNABRowsWithSummary(
    registerRows: YNABRegisterRow[],
    budgetRows: YNABBudgetRow[],
    config: YNABImportConfig,
    sourceNumberFormat: string,
    accountSpecs?: YNABImportAccountSpec[],
    readyToAssignSpecs?: YNABImportReadyToAssignSpec[],
    categoryMonthSpecs?: YNABImportCategoryMonthSpec[],
    source?: NormalizedYNABApiImport['source']
  ): Promise<YNABImportResult> {
    const reportProgress = async (update: YNABImportProgressUpdate) => {
      await config.onProgress?.(update);
    };
    const preview = inspectYNABRows(registerRows, budgetRows);
    await reportProgress({
      stage: 'preparing',
      status: 'running',
      progress: 2,
      label: 'Preparing import',
      detail: `Read ${registerRows.length} register rows`,
    });
    debugLog(`Parsed ${registerRows.length} register rows`);

    if (source) {
      await reportProgress({
        stage: 'source-verification',
        status: 'passed',
        progress: 6,
        label: 'YNAB source verified',
        detail:
          source.categoryAssignmentsVerified === undefined
            ? `${source.registerRows.toLocaleString()} source rows accounted for`
            : `${source.registerRows.toLocaleString()} source rows · ${source.categoryAssignmentsVerified.toLocaleString()} assignments confirmed by Money Movements`,
      });
    }

    this.detectAmbiguousDateOrder(
      registerRows.map((row) => row.Date),
      config.dateOrder
    );
    debugLog(`Parsed ${budgetRows.length} budget rows`);

    // Create budget WITHOUT default categories since we're importing our own
    debugLog('Creating budget...');
    const budgetId = await this.budgetService.createBudget({
      space_id: config.spaceId,
      name: config.budgetName,
      display_currency: config.currency,
      badge_icon: config.badgeIcon,
      number_format: config.numberFormat,
      create_default_categories: false,
    });
    try {
      // YNAB's Ready to Assign changes with the viewed month. Imported budgets
      // should preserve that expectation, while ordinary Budgero budgets keep
      // the application's cumulative default.
      this.budgetService.updateRtaMode(budgetId, 'monthly');
      debugLog(`Created budget with ID: ${budgetId}`);
      await reportProgress({
        stage: 'preparing',
        status: 'passed',
        progress: 10,
        label: 'Budget created',
      });

      await reportProgress({
        stage: 'categories',
        status: 'running',
        progress: 12,
        label: 'Importing categories',
      });
      debugLog('Creating categories...');
      debugLog(`About to call createCategoryStructure with budgetId=${budgetId}`);
      const categories = this.createCategoryStructure(budgetId, budgetRows, registerRows);
      debugLog(`Created ${Object.keys(categories).length} categories`);

      // Check what's actually in the database after creation
      const finalGroups = this.categoryService.getAllCategoryGroups(budgetId);
      debugLog(`After createCategoryStructure, database has ${finalGroups.length} groups`);
      const groupCounts: Record<string, number> = {};
      for (const g of finalGroups) {
        groupCounts[g.Name] = (groupCounts[g.Name] || 0) + 1;
      }
      for (const [name, count] of Object.entries(groupCounts)) {
        if (count > 1) {
          debugLog(`DUPLICATE GROUP: "${name}" appears ${count} times`);
        }
      }
      await reportProgress({
        stage: 'categories',
        status: 'passed',
        progress: 28,
        label: 'Categories imported',
        detail: `${Object.keys(categories).length} category mappings`,
      });

      await reportProgress({
        stage: 'accounts',
        status: 'running',
        progress: 30,
        label: 'Importing accounts',
      });
      debugLog('Creating accounts...');
      const accounts = await this.createAccounts(
        budgetId,
        registerRows,
        budgetRows,
        config.currency,
        categories,
        accountSpecs
      );
      debugLog(`Created ${accounts.size} accounts`);
      await reportProgress({
        stage: 'accounts',
        status: 'passed',
        progress: 42,
        label: 'Accounts imported',
        detail: `${accounts.size} accounts`,
      });

      await reportProgress({
        stage: 'assignments',
        status: 'running',
        progress: 44,
        label: 'Importing assignments',
      });
      debugLog('Importing assignments...');
      this.importAssignments(budgetId, budgetRows, categories, sourceNumberFormat);
      debugLog('Assignments imported successfully');
      await reportProgress({
        stage: 'assignments',
        status: 'passed',
        progress: 58,
        label: 'Assignments imported',
      });

      await reportProgress({
        stage: 'transactions',
        status: 'running',
        progress: 60,
        label: 'Importing transactions',
        detail: `${registerRows.length} register rows`,
      });
      debugLog('Importing transactions...');
      const transactionSummary = await this.importTransactionsWithProperBalances(
        budgetId,
        registerRows,
        accounts,
        categories,
        sourceNumberFormat,
        async (processed, total, transactionsCreated) => {
          const progress = Math.min(79, 60 + Math.floor((processed / total) * 19));
          await reportProgress({
            stage: 'transactions',
            status: 'running',
            progress,
            label: 'Importing transactions',
            detail: `${processed.toLocaleString()} of ${total.toLocaleString()} entries processed · ${transactionsCreated.toLocaleString()} transactions created`,
          });
        }
      );
      if (transactionSummary.sourceRowsProcessed !== registerRows.length) {
        throw new Error(
          `YNAB source completeness check failed: imported ${transactionSummary.sourceRowsProcessed} of ${registerRows.length} register rows. The incomplete budget was removed.`
        );
      }
      debugLog('Transactions imported successfully');
      await reportProgress({
        stage: 'transactions',
        status: 'passed',
        progress: 80,
        label: 'Transactions imported',
        detail: `${transactionSummary.transactionsCreated} transactions`,
      });

      let accountVerification:
        { verified: number; debtBalanceAdjustments: YNABDebtBalanceAdjustment[] } | undefined;
      if (accountSpecs) {
        await reportProgress({
          stage: 'account-verification',
          status: 'running',
          progress: 82,
          label: 'Verifying account balances',
        });
        accountVerification = await this.verifyYNABAccountBalances(
          budgetId,
          accounts,
          accountSpecs
        );
        await reportProgress({
          stage: 'account-verification',
          status: 'passed',
          progress: 90,
          label: 'Account balances verified',
          detail: `${accountVerification.verified} balances match YNAB${
            accountVerification.debtBalanceAdjustments.length > 0
              ? ` · ${accountVerification.debtBalanceAdjustments.length} visible debt interest adjustment${accountVerification.debtBalanceAdjustments.length === 1 ? '' : 's'}`
              : ''
          }`,
        });
      }

      let categoryVerification:
        | {
            checked: number;
            matched: number;
            mismatches: YNABCategoryMonthMismatch[];
            allMismatches?: YNABCategoryMonthMismatch[];
            omittedMismatches: number;
          }
        | undefined;
      if (categoryMonthSpecs) {
        await reportProgress({
          stage: 'category-verification',
          status: 'running',
          progress: 91,
          label: 'Verifying category history',
        });
        categoryVerification = await this.verifyYNABCategoryMonths(
          budgetId,
          categoryMonthSpecs,
          categories,
          async (processed, total, month) => {
            const progress = Math.min(94, 91 + Math.floor((processed / total) * 3));
            await reportProgress({
              stage: 'category-verification',
              status: 'running',
              progress,
              label: 'Verifying category history',
              detail: `${processed.toLocaleString()} of ${total.toLocaleString()} months checked · ${month}`,
            });
          }
        );
        const categoryWarning = categoryVerification.mismatches.length > 0;
        await reportProgress({
          stage: 'category-verification',
          status: categoryWarning ? 'warning' : 'passed',
          progress: 94,
          label: categoryWarning ? 'Category differences found' : 'Category history verified',
          detail: categoryWarning
            ? `${categoryVerification.checked - categoryVerification.matched} value${categoryVerification.checked - categoryVerification.matched === 1 ? '' : 's'} differ from YNAB`
            : `${categoryVerification.checked} values match YNAB`,
        });
      }

      let readyToAssignVerification:
        { checked: number; matched: number; mismatches: YNABReadyToAssignMismatch[] } | undefined;
      if (readyToAssignSpecs) {
        await reportProgress({
          stage: 'rta-verification',
          status: 'running',
          progress: 95,
          label: 'Verifying Ready to Assign',
        });
        readyToAssignVerification = await this.verifyYNABReadyToAssign(
          budgetId,
          readyToAssignSpecs,
          categoryVerification?.allMismatches,
          async (processed, total, month) => {
            const progress = Math.min(98, 95 + Math.floor((processed / total) * 3));
            await reportProgress({
              stage: 'rta-verification',
              status: 'running',
              progress,
              label: 'Verifying Ready to Assign',
              detail: `${processed.toLocaleString()} of ${total.toLocaleString()} months checked · ${month}`,
            });
          }
        );
        const rtaWarning = readyToAssignVerification.mismatches.length > 0;
        let rtaDetail = `${readyToAssignVerification.matched} months match YNAB`;
        if (rtaWarning) {
          const formatAmt = (milli: number) =>
            (milli / 1000).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
          rtaDetail = `${readyToAssignVerification.mismatches.length} of ${readyToAssignVerification.checked} months differ from YNAB`;

          for (const m of readyToAssignVerification.mismatches) {
            const causesSummary =
              m.affectedCategories && m.affectedCategories.length > 0
                ? ` | Causes: ${m.affectedCategories
                    .map(
                      (c) =>
                        `${c.categoryGroup} › ${c.category} (${formatAmt(c.amount)} in ${c.month}: ${c.reason})`
                    )
                    .join(', ')}`
                : '';
            console.warn(
              `[YNAB RTA Mismatch] ${m.month}: YNAB ${formatAmt(m.expectedReadyToAssign)} | Budgero ${formatAmt(m.computedReadyToAssign)} (Δ ${formatAmt(m.difference)}) ` +
                `[Income: ${formatAmt(m.breakdown.income)}, Assigned: ${formatAmt(m.breakdown.assignments)}, ` +
                `OffBudget: ${formatAmt(m.breakdown.offBudgetTransfers)}, InBudget: ${formatAmt(m.breakdown.inBudgetTransfers)}, ` +
                `PriorOverspend: ${formatAmt(m.breakdown.priorCashOverspend)}]${causesSummary}`
            );
          }
        }
        await reportProgress({
          stage: 'rta-verification',
          status: rtaWarning ? 'warning' : 'passed',
          progress: 98,
          label: rtaWarning ? 'Ready to Assign differences found' : 'Ready to Assign verified',
          detail: rtaDetail,
        });
      }

      const verification: YNABReconciliationReport | undefined =
        source && accountVerification && categoryVerification && readyToAssignVerification
          ? {
              status:
                categoryVerification.mismatches.length > 0 ||
                readyToAssignVerification.mismatches.length > 0
                  ? 'warning'
                  : 'passed',
              source,
              accounts: {
                checked: accountVerification.verified,
                matched: accountVerification.verified,
                debtBalanceAdjustments: accountVerification.debtBalanceAdjustments,
              },
              categories: categoryVerification,
              readyToAssign: readyToAssignVerification,
            }
          : undefined;

      const totalTransactionsCreated =
        transactionSummary.transactionsCreated +
        (accountVerification?.debtBalanceAdjustments.length ?? 0);

      return {
        budgetId,
        summary: {
          registerRowsImported: registerRows.length,
          transactionsCreated: totalTransactionsCreated,
          missingCategoriesCreated: preview.missingCategories,
          splitTransactionsImported: transactionSummary.splitTransactionsImported,
          sourceRowsVerified: transactionSummary.sourceRowsProcessed,
          ...(accountVerification === undefined
            ? {}
            : {
                accountBalancesVerified: accountVerification.verified,
                debtBalanceAdjustmentsCreated: accountVerification.debtBalanceAdjustments.length,
              }),
          ...(categoryVerification === undefined
            ? {}
            : { categoryMonthsVerified: categoryVerification.matched }),
          ...(readyToAssignVerification === undefined
            ? {}
            : { readyToAssignMonthsVerified: readyToAssignVerification.matched }),
          ...(source?.categoryAssignmentsVerified === undefined
            ? {}
            : { moneyMovementAssignmentsVerified: source.categoryAssignmentsVerified }),
        },
        ...(verification ? { verification } : {}),
      };
    } catch (error) {
      this.budgetService.deleteBudget(budgetId);
      throw error;
    }
  }

  private async verifyYNABAccountBalances(
    budgetId: number,
    accounts: Map<string, number>,
    accountSpecs: YNABImportAccountSpec[]
  ): Promise<{ verified: number; debtBalanceAdjustments: YNABDebtBalanceAdjustment[] }> {
    const verifiableSpecs = accountSpecs.filter(
      (spec): spec is YNABImportAccountSpec & { expectedBalance: number } =>
        spec.expectedBalance !== undefined
    );
    const mismatches: YNABAccountBalanceMismatch[] = [];
    const debtBalanceAdjustments: YNABDebtBalanceAdjustment[] = [];
    const transfersCategoryId = ensureCategoryWithGroup(
      this.categoryService,
      budgetId,
      'Transfers',
      'Transfers',
      ''
    );

    for (const spec of verifiableSpecs) {
      const accountId = accounts.get(accountKey(spec.name, spec.ynabAccountId));
      let account = accountId === undefined ? undefined : this.accountService.getAccount(accountId);
      let computedBalance = account?.BalanceNative;

      if (
        spec.expectedLedgerBalance !== undefined &&
        computedBalance !== spec.expectedLedgerBalance
      ) {
        mismatches.push({
          accountName: `${spec.name} (exported transaction ledger)`,
          expectedBalance: spec.expectedLedgerBalance,
          computedBalance: computedBalance ?? 0,
          difference: (computedBalance ?? 0) - spec.expectedLedgerBalance,
        });
        continue;
      }

      if (computedBalance === spec.expectedBalance) continue;

      // YNAB's debt engine applies calculated interest directly to special
      // loan balances without exporting a corresponding transaction. Preserve
      // both truths by materializing that exact delta as a visible transaction
      // instead of hiding it in account metadata or silently accepting drift.
      if (
        accountId !== undefined &&
        computedBalance !== undefined &&
        spec.ynabAccountType &&
        YNAB_MANAGED_DEBT_ACCOUNT_TYPES.has(spec.ynabAccountType)
      ) {
        const amount = spec.expectedBalance - computedBalance;
        const date = (spec.balanceAdjustmentDate || '').slice(0, 10) || '1970-01-01';
        await this.transactionService.addTransaction(
          amount > 0 ? asMilli(amount) : ZERO_MILLI,
          amount < 0 ? asMilli(-amount) : ZERO_MILLI,
          accountId,
          transfersCategoryId,
          budgetId,
          date,
          'Imported YNAB debt interest adjustment',
          '',
          'Budgero',
          undefined,
          undefined,
          true
        );
        debtBalanceAdjustments.push({
          accountName: spec.name,
          date,
          amount,
          balanceBefore: computedBalance,
          expectedBalance: spec.expectedBalance,
        });
        account = this.accountService.getAccount(accountId);
        computedBalance = account?.BalanceNative;
        if (computedBalance === spec.expectedBalance) continue;
      }

      mismatches.push({
        accountName: spec.name,
        expectedBalance: spec.expectedBalance,
        computedBalance: computedBalance ?? 0,
        difference: (computedBalance ?? 0) - spec.expectedBalance,
      });
    }

    if (mismatches.length > 0) {
      const details = mismatches
        .map(
          ({ accountName, expectedBalance, computedBalance, difference }) =>
            `${accountName}: YNAB ${expectedBalance}, Budgero ${computedBalance}, difference ${difference}`
        )
        .join('; ');
      throw new Error(
        `YNAB account balance integrity check failed for ${mismatches.length} account${mismatches.length === 1 ? '' : 's'} (${details}). The incomplete budget was removed.`
      );
    }

    debugLog(`Verified ${verifiableSpecs.length} YNAB account balances`);
    return { verified: verifiableSpecs.length, debtBalanceAdjustments };
  }

  private async verifyYNABCategoryMonths(
    budgetId: number,
    specs: YNABImportCategoryMonthSpec[],
    categories: Record<string, number>,
    onMonth?: (processed: number, total: number, month: string) => void | Promise<void>
  ): Promise<{
    checked: number;
    matched: number;
    mismatches: YNABCategoryMonthMismatch[];
    allMismatches: YNABCategoryMonthMismatch[];
    omittedMismatches: number;
  }> {
    const MAX_VISIBLE_MISMATCHES = 100;
    const allMismatches: YNABCategoryMonthMismatch[] = [];
    let mismatchCount = 0;
    const specsByMonth = new Map<string, YNABImportCategoryMonthSpec[]>();

    for (const spec of specs) {
      const monthSpecs = specsByMonth.get(spec.month) || [];
      monthSpecs.push(spec);
      specsByMonth.set(spec.month, monthSpecs);
    }

    const months = [...specsByMonth.entries()].sort(([left], [right]) => left.localeCompare(right));
    for (let monthIndex = 0; monthIndex < months.length; monthIndex++) {
      const [month, monthSpecs] = months[monthIndex];
      const rows = new Map(
        this.monthlyBudgetService
          .getMonthlyBudget(month, budgetId)
          .map((row) => [row.CategoryID, row])
      );

      for (const spec of monthSpecs) {
        const categoryId =
          categories[
            categoryKey({
              categoryGroup: spec.categoryGroup,
              category: spec.category,
              sourceId: spec.ynabCategoryId,
            })
          ];
        const row = categoryId === undefined ? undefined : rows.get(categoryId);
        const comparisons = [
          ['assigned', spec.expectedAssigned, Number(row?.Assigned ?? 0)],
          ['activity', spec.expectedActivity, Number(row?.Activity ?? 0)],
          ['available', spec.expectedAvailable, Number(row?.Available ?? 0)],
        ] as const;

        for (const [field, expectedAmount, computedAmount] of comparisons) {
          if (expectedAmount === computedAmount) continue;
          mismatchCount++;
          allMismatches.push({
            month: spec.month,
            categoryGroup: spec.categoryGroup,
            category: spec.category,
            field,
            expectedAmount,
            computedAmount,
            difference: computedAmount - expectedAmount,
          });
        }
      }

      await onMonth?.(monthIndex + 1, months.length, month);
    }

    const checked = specs.length * 3;
    debugLog(`Verified ${checked - mismatchCount}/${checked} YNAB category-month values`);
    return {
      checked,
      matched: checked - mismatchCount,
      mismatches: allMismatches.slice(0, MAX_VISIBLE_MISMATCHES),
      allMismatches,
      omittedMismatches: Math.max(0, mismatchCount - MAX_VISIBLE_MISMATCHES),
    };
  }

  private async verifyYNABReadyToAssign(
    budgetId: number,
    specs: YNABImportReadyToAssignSpec[],
    categoryMismatches?: YNABCategoryMonthMismatch[],
    onMonth?: (processed: number, total: number, month: string) => void | Promise<void>
  ): Promise<{ checked: number; matched: number; mismatches: YNABReadyToAssignMismatch[] }> {
    const mismatches: YNABReadyToAssignMismatch[] = [];
    if (specs.length === 0) {
      return { checked: 0, matched: 0, mismatches };
    }

    const months = specs.map((s) => s.month);
    const breakdownMap = this.monthlyBudgetService.getReadyToAssignBreakdownMap(budgetId, months);

    let lastProgressReportTime = 0;
    for (let index = 0; index < specs.length; index++) {
      const spec = specs[index];
      const breakdown =
        breakdownMap.get(spec.month) ??
        this.monthlyBudgetService.getReadyToAssignBreakdown(budgetId, spec.month);
      const computedReadyToAssign = Number(breakdown.readyToAssign);
      if (computedReadyToAssign !== spec.expectedReadyToAssign) {
        const affectedCategories: YNABReadyToAssignCategoryCause[] = [];
        const causesKeySet = new Set<string>();

        // 1. Cash overspends prior to spec.month
        if (breakdown.priorCashOverspendDetails) {
          for (const o of breakdown.priorCashOverspendDetails) {
            const key = `cash_overspend:${o.categoryGroupName}:${o.categoryName}:${o.month}`;
            if (!causesKeySet.has(key)) {
              causesKeySet.add(key);
              affectedCategories.push({
                categoryGroup: o.categoryGroupName,
                category: o.categoryName,
                reason: 'cash_overspend',
                month: o.month,
                amount: -Number(o.amount),
                details: `Cash overspend in ${o.month}`,
              });
            }
          }
        }

        // 2. Category assignment differences in or before spec.month
        if (categoryMismatches) {
          for (const cm of categoryMismatches) {
            if (cm.field === 'assigned' && cm.month <= spec.month) {
              const key = `assigned_diff:${cm.categoryGroup}:${cm.category}:${cm.month}`;
              if (!causesKeySet.has(key)) {
                causesKeySet.add(key);
                affectedCategories.push({
                  categoryGroup: cm.categoryGroup,
                  category: cm.category,
                  reason: 'assigned_diff',
                  month: cm.month,
                  amount: -cm.difference,
                  expectedAmount: cm.expectedAmount,
                  computedAmount: cm.computedAmount,
                  details:
                    cm.month === spec.month
                      ? `Assigned mismatch in ${cm.month}`
                      : `Assigned mismatch from ${cm.month} carried forward`,
                });
              }
            }
          }
        }

        // Sort causes: chronologically by origin month, then absolute amount descending
        affectedCategories.sort((a, b) => {
          const monthCmp = a.month.localeCompare(b.month);
          if (monthCmp !== 0) return monthCmp;
          return Math.abs(b.amount) - Math.abs(a.amount);
        });

        mismatches.push({
          month: spec.month,
          expectedReadyToAssign: spec.expectedReadyToAssign,
          computedReadyToAssign,
          difference: computedReadyToAssign - spec.expectedReadyToAssign,
          breakdown: {
            income: Number(breakdown.income),
            assignments: Number(breakdown.assignments),
            offBudgetTransfers: Number(breakdown.offBudgetTransfers),
            inBudgetTransfers: Number(breakdown.inBudgetTransfers),
            revaluations: Number(breakdown.revaluations),
            priorCashOverspend: Number(breakdown.priorCashOverspend),
            priorCashOverspendDetails: breakdown.priorCashOverspendDetails?.map((o) => ({
              categoryId: o.categoryId,
              categoryName: o.categoryName,
              categoryGroupName: o.categoryGroupName,
              month: o.month,
              amount: Number(o.amount),
            })),
          },
          affectedCategories,
        });
      }

      const processed = index + 1;
      const now = Date.now();
      if (
        onMonth &&
        (processed === specs.length || processed === 1 || now - lastProgressReportTime >= 150)
      ) {
        lastProgressReportTime = now;
        await onMonth(processed, specs.length, spec.month);
      }
    }

    debugLog(
      `Verified Ready to Assign for ${specs.length - mismatches.length}/${specs.length} YNAB months`
    );
    return {
      checked: specs.length,
      matched: specs.length - mismatches.length,
      mismatches,
    };
  }

  private createCategoryStructure(
    budgetId: number,
    budgetRows: YNABBudgetRow[],
    registerRows: YNABRegisterRow[]
  ): Record<string, number> {
    const categories: Record<string, number> = Object.create(null);
    const categoryGroups: Record<string, number> = Object.create(null);

    debugLog('Starting createCategoryStructure');
    debugLog(`Processing ${budgetRows.length} budget rows`);

    // Resolve the Income and Uncategorized category ids UNCONDITIONALLY.
    // Every budget gets the system categories (Income/Uncategorized/Transfers)
    // at creation even with create_default_categories: false, so the old
    // only-if-group-missing branches never ran — categories['Income'] stayed
    // unset and every income row ("Inflow: Ready to Assign") imported as
    // Uncategorized, while "Ready to Assign" assignment rows were dropped.
    const incomeCategoryId = ensureCategoryWithGroup(
      this.categoryService,
      budgetId,
      'Income',
      'Income',
      ''
    );
    categories['Income::Income'] = incomeCategoryId;
    categories[categoryKey({ categoryGroup: 'Income', category: 'Income' })] = incomeCategoryId;
    categories['Income'] = incomeCategoryId; // Fallback for compatibility

    const uncategorizedCategoryId = ensureCategoryWithGroup(
      this.categoryService,
      budgetId,
      'Uncategorized',
      'Uncategorized',
      ''
    );
    categories['Uncategorized::Uncategorized'] = uncategorizedCategoryId;
    categories[categoryKey({ categoryGroup: 'Uncategorized', category: 'Uncategorized' })] =
      uncategorizedCategoryId;
    categories['Uncategorized'] = uncategorizedCategoryId; // Fallback for compatibility

    // Then map all existing category groups (system ones included) so the
    // row loop below reuses them instead of creating duplicates.
    const existingGroups = this.categoryService.getAllCategoryGroups(budgetId);
    debugLog(`Found ${existingGroups.length} existing category groups`);
    for (const group of existingGroups) {
      categoryGroups[group.Name] = group.ID;
      debugLog(`Existing group: "${group.Name}" with ID ${group.ID}`);
    }

    const sourceGroups = new Map<string, number>();
    for (const row of [...budgetRows, ...registerRows]) {
      if (!row.SourceCategoryId) continue;
      const descriptor = categoryDescriptor(row)!;
      const key = categoryKey(descriptor);
      if (categories[key] !== undefined) continue;
      if (descriptor.systemCategory) {
        categories[key] = ensureCategoryWithGroup(
          this.categoryService,
          budgetId,
          descriptor.systemCategory,
          descriptor.systemCategory,
          ''
        );
        continue;
      }
      const groupKey = descriptor.sourceGroupId || descriptor.categoryGroup;
      let groupId = sourceGroups.get(groupKey);
      if (groupId === undefined) {
        groupId = this.categoryService.addCategoryGroup(descriptor.categoryGroup, budgetId);
        sourceGroups.set(groupKey, groupId);
      }
      categories[key] = this.categoryService.addCategory(
        groupId,
        budgetId,
        descriptor.category,
        ''
      );
    }

    let rowCount = 0;
    const seenInRows: Set<string> = new Set();
    for (const row of budgetRows) {
      if (row.SourceCategoryId) continue;
      rowCount++;
      const descriptor = categoryDescriptor(row);
      if (descriptor) {
        const groupName = descriptor.categoryGroup;
        const categoryName = descriptor.category;

        const rowKey = `${row.Month}::${groupName}::${categoryName}`;
        if (!seenInRows.has(rowKey)) {
          seenInRows.add(rowKey);
          debugLog(
            `Row ${rowCount}: Month="${row.Month}", Group="${groupName}", Category="${categoryName}"`
          );
        }

        if (!(groupName in categoryGroups)) {
          debugLog(
            `Row ${rowCount}: Creating category group: "${groupName}" (from Month: ${row.Month})`
          );
          const groupId = this.categoryService.addCategoryGroup(groupName, budgetId);
          categoryGroups[groupName] = groupId;
          debugLog(`Created group "${groupName}" with ID ${groupId}`);
        } else {
          debugLog(
            `Row ${rowCount}: Group "${groupName}" already in dictionary with ID ${categoryGroups[groupName]}`
          );
        }

        // Create category with unique key per group
        // Use groupName::categoryName as the key to allow same category names in different groups
        const key = categoryKey({ categoryGroup: groupName, category: categoryName });
        if (!(key in categories)) {
          const categoryId = this.categoryService.addCategory(
            categoryGroups[groupName],
            budgetId,
            categoryName,
            ''
          );
          categories[key] = categoryId;
        }
      }
    }

    // A YNAB register can reference categories absent from Plan.csv (for
    // example after historical category changes). Preserve those transactions
    // by creating the exact group/category pair instead of silently routing
    // them to Uncategorized.
    for (const row of registerRows) {
      if (row.SourceCategoryId) continue;
      const descriptor = categoryDescriptor(row);
      if (!descriptor) continue;

      const key = categoryKey(descriptor);
      if (categories[key]) continue;

      let groupId = categoryGroups[descriptor.categoryGroup];
      if (groupId === undefined) {
        groupId = this.categoryService.addCategoryGroup(descriptor.categoryGroup, budgetId);
        categoryGroups[descriptor.categoryGroup] = groupId;
      }
      // The generic helper reuses a category by name across all groups. A
      // register-only source category still belongs to its exact source group.
      const categoryId = descriptor.systemCategory
        ? ensureCategoryWithGroup(
            this.categoryService,
            budgetId,
            descriptor.categoryGroup,
            descriptor.category,
            ''
          )
        : this.categoryService.addCategory(groupId, budgetId, descriptor.category, '');
      categories[key] = categoryId;

      if (descriptor.systemCategory) {
        categories[descriptor.systemCategory] = categoryId;
      }
    }

    debugLog('Final categoryGroups:', Object.keys(categoryGroups));
    debugLog(`Total category groups created: ${Object.keys(categoryGroups).length}`);

    return categories;
  }

  /**
   * Account names that YNAB treats as credit cards. The export carries no
   * account types, but every credit card gets a same-named category in the
   * "Credit Card Payments" group of the plan file.
   */
  private creditCardAccountNames(budgetRows: YNABBudgetRow[]): Set<string> {
    const names = new Set<string>();
    for (const row of budgetRows) {
      if (row.CategoryGroup?.trim().toLowerCase() === 'credit card payments' && row.Category) {
        names.add(row.Category.trim());
      }
    }
    return names;
  }

  private async createAccounts(
    budgetId: number,
    registerRows: YNABRegisterRow[],
    budgetRows: YNABBudgetRow[],
    currency: string,
    categories: Record<string, number>,
    accountSpecs?: YNABImportAccountSpec[]
  ): Promise<Map<string, number>> {
    const accounts = new Map<string, number>();
    const uniqueAccounts = new Set<string>();
    const creditCards = this.creditCardAccountNames(budgetRows);

    for (let i = 0; i < registerRows.length; i++) {
      const row = registerRows[i];
      if (i < 5) {
        // Debug first 5 rows
        debugLog(
          `Row ${i} - Account: '${row.Account}', Date: '${row.Date}', Payee: '${row.Payee}'`
        );
      }
      if (row.Account) {
        uniqueAccounts.add(row.Account.trim());
      }
    }
    debugLog(`Found ${uniqueAccounts.size} unique accounts from ${registerRows.length} rows`);

    const specs: YNABImportAccountSpec[] =
      accountSpecs ||
      [...uniqueAccounts].map((name) => ({
        name,
        type: creditCards.has(name) ? 'Credit' : 'Checking',
        onBudget: true,
        archived: false,
        ynabAccountId: '',
      }));

    for (const spec of specs) {
      const accountName = spec.name;
      const inferredLinkedCategoryId = spec.linkedYNABCategoryId
        ? categories[`id:${spec.linkedYNABCategoryId}`]
        : spec.linkedCategoryGroup && spec.linkedCategory
          ? categories[
              categoryKey({
                categoryGroup: spec.linkedCategoryGroup,
                category: spec.linkedCategory,
              })
            ]
          : undefined;
      const creditPaymentCategoryId = spec.creditPaymentYNABCategoryId
        ? categories[`id:${spec.creditPaymentYNABCategoryId}`]
        : undefined;
      if (spec.creditPaymentYNABCategoryId && creditPaymentCategoryId === undefined) {
        throw new Error('The selected YNAB payment category was not created during import.');
      }
      const account = await this.accountService.createAccount(
        accountName,
        budgetId,
        spec.type,
        currency,
        ZERO_MILLI,
        spec.ynabAccountId || inferredLinkedCategoryId
          ? {
              ...(spec.ynabAccountId ? { ynab_account_id: spec.ynabAccountId } : {}),
              ...(inferredLinkedCategoryId ? { linked_category_id: inferredLinkedCategoryId } : {}),
              ...(creditPaymentCategoryId
                ? {
                    cc_payment_category_id: creditPaymentCategoryId,
                    ynab_credit_payment_category_id: spec.creditPaymentYNABCategoryId,
                  }
                : {}),
            }
          : undefined,
        spec.onBudget
      );
      accounts.set(accountKey(accountName, spec.ynabAccountId), account.ID);
      if (spec.archived) {
        this.accountService.setAccountArchived(account.ID, true);
      }
      if (isCreditAccountType(spec.type)) {
        debugLog(`Account '${accountName}' imported as a credit card`);
      }
    }

    return accounts;
  }

  private importAssignments(
    budgetId: number,
    budgetRows: YNABBudgetRow[],
    categories: Record<string, number>,
    numberFormat: string
  ): void {
    debugLog(`Starting assignment import with ${budgetRows.length} budget rows`);
    let createdAssignments = 0;

    for (let i = 0; i < budgetRows.length; i++) {
      const row = budgetRows[i];
      if (i < 5) {
        // Debug first 5 rows
        debugLog(
          `Assignment row ${i} - Month: '${row.Month}', Category: '${row.Category}', Group: '${row.CategoryGroup}', Assigned: '${row.Assigned}'`
        );
      }

      if (!row.Category || !row.Assigned || !row.Month) {
        continue;
      }

      const descriptor = categoryDescriptor(row);
      if (!descriptor) continue;
      const categoryName = descriptor.category;
      const groupName = descriptor.categoryGroup;
      const categoryId =
        categories[categoryKey(descriptor)] ||
        (descriptor.systemCategory ? categories[descriptor.systemCategory] : undefined);
      if (!categoryId) {
        debugLog(
          `Category '${categoryName}' in group '${groupName}' not found, skipping assignment`
        );
        continue;
      }

      const assignedAmount = fromDecimal(
        this.currencyParser.parseYNABAmountAdvanced(row.Assigned, numberFormat)
      );
      if (assignedAmount === 0) {
        debugLog(`Zero assigned amount for category '${categoryName}', skipping`);
        continue;
      }

      const month = this.parseYNABMonth(row.Month);
      if (!month) {
        debugLog(`Could not parse month '${row.Month}', skipping`);
        continue;
      }

      debugLog(
        `Creating assignment - Category: '${categoryName}' (ID: ${categoryId}), Amount: ${assignedAmount.toFixed(2)}, Month: '${month}'`
      );

      this.monthlyBudgetService.upsertMonthlyAssignment(
        categoryId,
        assignedAmount,
        month,
        budgetId
      );
      createdAssignments++;
    }

    debugLog(`Assignment import complete - Created: ${createdAssignments}`);
  }

  private async importTransactionsWithProperBalances(
    budgetId: number,
    registerRows: YNABRegisterRow[],
    accounts: Map<string, number>,
    categories: Record<string, number>,
    numberFormat: string,
    onBatch?: (
      processed: number,
      total: number,
      transactionsCreated: number
    ) => void | Promise<void>
  ): Promise<{
    transactionsCreated: number;
    splitTransactionsImported: number;
    sourceRowsProcessed: number;
  }> {
    const incomeCategoryId = categories['Income'];
    const uncategorizedCategoryId = categories['Uncategorized'];
    const transfersCategoryId = ensureCategoryWithGroup(
      this.categoryService,
      budgetId,
      'Transfers',
      'Transfers',
      ''
    );
    const creditCardAccountIds = new Set(
      [...accounts.values()].filter((id) =>
        isCreditAccountType(this.accountService.getAccount(id).Type)
      )
    );
    const transferIdsByRowIndex = this.buildTransferIds(registerRows, accounts, numberFormat);

    type ImportUnit =
      | { kind: 'row'; row: YNABRegisterRow; originalIndex: number }
      | { kind: 'split'; group: YNABSplitGroup; originalIndex: number };

    const groupsByStart = new Map(
      detectSplitGroups(registerRows).map((group) => [group.startIndex, group])
    );
    const units: ImportUnit[] = [];

    for (let index = 0; index < registerRows.length; index++) {
      const splitGroup = groupsByStart.get(index);
      if (splitGroup) {
        units.push({ kind: 'split', group: splitGroup, originalIndex: index });
        index += splitGroup.rows.length - 1;
      } else {
        units.push({ kind: 'row', row: registerRows[index], originalIndex: index });
      }
    }

    // Sort transactions chronologically (oldest first), retaining register
    // order within a day so YNAB's running history remains deterministic.
    const sortedUnits = units.sort((a, b) => {
      const dateA = this.parseYNABDate(a.kind === 'row' ? a.row.Date : a.group.rows[0].Date);
      const dateB = this.parseYNABDate(b.kind === 'row' ? b.row.Date : b.group.rows[0].Date);
      if (!dateA || !dateB) return 0;
      return dateA.localeCompare(dateB) || a.originalIndex - b.originalIndex;
    });

    // API credit purchases need a stable same-day tie order. Reorder only their
    // existing slots: changing transfer/debt import order can change the running
    // balance used by the transaction service when categorizing a loan payment.
    const creditSlotsByDate = new Map<string, number[]>();
    sortedUnits.forEach((unit, index) => {
      const rows = unit.kind === 'row' ? [unit.row] : unit.group.rows;
      const row = rows[0];
      const accountId = rowAccountId(row, accounts);
      if (
        !row.SourceId ||
        accountId === undefined ||
        !creditCardAccountIds.has(accountId) ||
        rows.some((part) => this.isTransfer(part))
      )
        return;
      const date = this.parseYNABDate(row.Date);
      if (!date) return;
      const slots = creditSlotsByDate.get(date) ?? [];
      slots.push(index);
      creditSlotsByDate.set(date, slots);
    });
    for (const slots of creditSlotsByDate.values()) {
      const ordered = slots
        .map((index) => sortedUnits[index])
        .sort((a, b) => {
          const rowA = a.kind === 'row' ? a.row : a.group.rows[0];
          const rowB = b.kind === 'row' ? b.row : b.group.rows[0];
          return rowA.SourceId!.localeCompare(rowB.SourceId!);
        });
      slots.forEach((index, position) => {
        sortedUnits[index] = ordered[position];
      });
    }

    debugLog(`Processing ${sortedUnits.length} transaction units in chronological order`);

    let transactionsCreated = 0;
    let splitTransactionsImported = 0;
    let sourceRowsProcessed = 0;

    for (let index = 0; index < sortedUnits.length; index++) {
      const unit = sortedUnits[index];

      if (unit.kind === 'split') {
        if (unit.group.containsTransfer) {
          for (let partIndex = 0; partIndex < unit.group.rows.length; partIndex++) {
            const created = await this.importRegisterRow(
              budgetId,
              { ...unit.group.rows[partIndex], Memo: unit.group.markers[partIndex].memo },
              unit.originalIndex + partIndex,
              accounts,
              categories,
              numberFormat,
              incomeCategoryId,
              uncategorizedCategoryId,
              transfersCategoryId,
              creditCardAccountIds,
              transferIdsByRowIndex.get(unit.originalIndex + partIndex)
            );
            if (created) {
              transactionsCreated++;
              sourceRowsProcessed++;
            }
          }
        } else {
          const created = await this.importSplitGroup(
            budgetId,
            unit.group,
            accounts,
            categories,
            numberFormat,
            incomeCategoryId,
            uncategorizedCategoryId
          );
          if (created) {
            transactionsCreated++;
            splitTransactionsImported++;
            sourceRowsProcessed += unit.group.rows.length;
          }
        }
      } else {
        const created = await this.importRegisterRow(
          budgetId,
          unit.row,
          unit.originalIndex,
          accounts,
          categories,
          numberFormat,
          incomeCategoryId,
          uncategorizedCategoryId,
          transfersCategoryId,
          creditCardAccountIds,
          transferIdsByRowIndex.get(unit.originalIndex)
        );
        if (created) {
          transactionsCreated++;
          sourceRowsProcessed++;
        }
      }

      const processed = index + 1;
      if (processed % 50 === 0) {
        debugLog(`Processed ${processed}/${sortedUnits.length} transaction units`);
        await onBatch?.(processed, sortedUnits.length, transactionsCreated);
      }
    }

    return { transactionsCreated, splitTransactionsImported, sourceRowsProcessed };
  }

  private buildTransferIds(
    registerRows: YNABRegisterRow[],
    accounts: Map<string, number>,
    numberFormat: string
  ): Map<number, string> {
    interface TransferPairingState {
      unmatchedInflows: string[];
      unmatchedOutflows: string[];
    }

    const idsByRowIndex = new Map<number, string>();
    const pairingStates = new Map<string, TransferPairingState>();
    // Transfer IDs are used by transaction editing/deletion across this database.
    // Source IDs repeat when a plan is imported again, so each import needs its
    // own namespace (also safe when separately imported budgets later sync).
    const namespace = crypto.randomUUID();

    for (let rowIndex = 0; rowIndex < registerRows.length; rowIndex++) {
      const row = registerRows[rowIndex];
      if (!isTransferRow(row)) continue;
      const counterpartyName = transferCounterpartyName(row);
      if (row.TransferID) {
        idsByRowIndex.set(rowIndex, `ynab_${namespace}_${row.TransferID}`);
        continue;
      }

      // Even an unmatched leg must have an identity local to this import.
      idsByRowIndex.set(rowIndex, `ynab_${namespace}_row_${rowIndex}`);

      const currentAccountId = rowAccountId(row, accounts);
      const counterpartyAccountId = accounts.get(
        accountKey(counterpartyName || '', row.SourceTransferAccountId)
      );
      if (!currentAccountId || !counterpartyAccountId) continue;

      const parsedDate = this.parseYNABDate(row.Date);
      if (!parsedDate) continue;

      const inflow = fromDecimal(
        this.currencyParser.parseYNABAmountAdvanced(row.Inflow, numberFormat)
      );
      const outflow = fromDecimal(
        this.currencyParser.parseYNABAmountAdvanced(row.Outflow, numberFormat)
      );
      const amount = Number(inflow) + Number(outflow);
      const [firstAccountId, secondAccountId] = [currentAccountId, counterpartyAccountId].sort(
        (left, right) => left - right
      );
      const splitMarker = row.SourceId ? null : parseSplitMarker(row.Memo || '');
      const normalizedMemo = row.SourceId
        ? ''
        : (splitMarker?.memo ?? row.Memo ?? '').trim().toLocaleLowerCase();
      const pairingKey = JSON.stringify([
        parsedDate,
        amount,
        firstAccountId,
        secondAccountId,
        normalizedMemo,
      ]);
      const state = pairingStates.get(pairingKey) || {
        unmatchedInflows: [],
        unmatchedOutflows: [],
      };

      const oppositeQueue = inflow > 0 ? state.unmatchedOutflows : state.unmatchedInflows;
      const ownQueue = inflow > 0 ? state.unmatchedInflows : state.unmatchedOutflows;
      let transferId = oppositeQueue.shift();
      if (!transferId) {
        transferId = `ynab_${namespace}_pair_${rowIndex}`;
        ownQueue.push(transferId);
      }

      idsByRowIndex.set(rowIndex, transferId);
      pairingStates.set(pairingKey, state);
    }

    return idsByRowIndex;
  }

  private resolveTransactionCategory(
    row: YNABRegisterRow,
    inflow: number,
    categories: Record<string, number>,
    incomeCategoryId: number,
    uncategorizedCategoryId: number
  ): number {
    const descriptor = categoryDescriptor(row);
    if (!descriptor) {
      if (row.SourceAccountId !== undefined) return uncategorizedCategoryId;
      return inflow > 0 ? incomeCategoryId : uncategorizedCategoryId;
    }

    return (
      categories[categoryKey(descriptor)] ||
      (descriptor.systemCategory ? categories[descriptor.systemCategory] : undefined) ||
      uncategorizedCategoryId
    );
  }

  private async importSplitGroup(
    budgetId: number,
    group: YNABSplitGroup,
    accounts: Map<string, number>,
    categories: Record<string, number>,
    numberFormat: string,
    incomeCategoryId: number,
    uncategorizedCategoryId: number
  ): Promise<boolean> {
    const firstRow = group.rows[0];
    const accountId = rowAccountId(firstRow, accounts);
    const parsedDate = this.parseYNABDate(firstRow.Date);
    if (!accountId || !parsedDate) return false;

    const prepared = group.rows.map((row, index) => {
      const inflow = fromDecimal(
        this.currencyParser.parseYNABAmountAdvanced(row.Inflow, numberFormat)
      );
      const outflow = fromDecimal(
        this.currencyParser.parseYNABAmountAdvanced(row.Outflow, numberFormat)
      );
      return {
        row,
        inflow,
        outflow,
        categoryId: this.resolveTransactionCategory(
          row,
          inflow,
          categories,
          incomeCategoryId,
          uncategorizedCategoryId
        ),
        memo: group.markers[index].memo,
        payee: row.Payee.trim(),
      };
    });

    const inflow = asMilli(prepared.reduce((sum, part) => sum + Number(part.inflow), 0));
    const outflow = asMilli(prepared.reduce((sum, part) => sum + Number(part.outflow), 0));
    // CSV exports omit the parent details; API snapshots supply them explicitly.
    const parentMemo = firstRow.SourceParentMemo ?? 'Imported YNAB split';
    const payee = firstRow.SourceParentPayee ?? '';

    try {
      const parentId = await this.transactionService.addTransaction(
        inflow,
        outflow,
        accountId,
        prepared[0].categoryId,
        budgetId,
        parsedDate,
        parentMemo,
        '',
        payee
      );

      await this.splitService.upsertSplits(
        parentId,
        prepared.map((part, orderIndex) => ({
          CategoryID: part.categoryId,
          Memo: part.memo,
          Payee: part.payee,
          InflowConverted: part.inflow,
          OutflowConverted: part.outflow,
          InflowNative: part.inflow,
          OutflowNative: part.outflow,
          OrderIndex: orderIndex,
        }))
      );

      if (group.rows.every((row) => row.Cleared.trim().toLowerCase() === 'reconciled')) {
        this.db
          .prepare('UPDATE transactions SET Reconciled = 1 WHERE ID = ? AND BudgetID = ?')
          .run(parentId, budgetId);
      }

      return true;
    } catch (error) {
      throw new Error(
        `Failed to import ${group.rows.length}-part split transaction at register row ${group.startIndex + 1}: ${error}`
      );
    }
  }

  private async importRegisterRow(
    budgetId: number,
    row: YNABRegisterRow,
    rowIndex: number,
    accounts: Map<string, number>,
    categories: Record<string, number>,
    numberFormat: string,
    incomeCategoryId: number,
    uncategorizedCategoryId: number,
    transfersCategoryId: number,
    creditCardAccountIds: Set<number>,
    transferIdOverride?: string
  ): Promise<boolean> {
    if (!row.Account || !row.Date) return false;

    const accountId = rowAccountId(row, accounts);
    if (!accountId) return false;

    const inflow = fromDecimal(
      this.currencyParser.parseYNABAmountAdvanced(row.Inflow, numberFormat)
    );
    const outflow = fromDecimal(
      this.currencyParser.parseYNABAmountAdvanced(row.Outflow, numberFormat)
    );

    let categoryId = this.resolveTransactionCategory(
      row,
      inflow,
      categories,
      incomeCategoryId,
      uncategorizedCategoryId
    );

    const parsedDate = this.parseYNABDate(row.Date);
    if (!parsedDate) {
      debugLog(`Skipping transaction with invalid date: ${row.Date}`);
      return false;
    }

    let memo = row.Memo;
    if (row.SourceSubtransactionId) {
      // Transfer-containing splits are expanded into individual ledger rows.
      // Keep their parent-only context alongside the original child note.
      const parentDetails: string[] = [];
      if (row.SourceParentMemo && row.SourceParentMemo !== memo) {
        parentDetails.push(`YNAB split memo: ${row.SourceParentMemo}`);
      }
      if (row.SourceParentPayee && row.SourceParentPayee !== row.Payee) {
        parentDetails.push(`YNAB split payee: ${row.SourceParentPayee}`);
      }
      memo = [memo, ...parentDetails].filter(Boolean).join('\n');
    }
    const rawPayee = (row.Payee || '').trim();
    const payeeLower = rawPayee.toLowerCase();
    let payee = rawPayee.length > 0 ? rawPayee : 'Budgero';
    let transferId = '';

    if (payeeLower === 'starting balance') {
      memo ||= 'Starting Balance';
      payee = 'Budgero';
      // A credit card's opening balance is existing debt, not budget money:
      // YNAB leaves it out of Ready to Assign, and so does Budgero (credit
      // opening balances use the Transfers category). Keep that parity here.
      if (creditCardAccountIds.has(accountId)) {
        categoryId = transfersCategoryId;
      }
    } else if (payeeLower === 'reconciliation balance adjustment') {
      payee = 'Budgero';
    }

    if (this.isTransfer(row)) {
      // Use the precomputed, occurrence-aware ID so repeated equal transfers
      // on one day remain distinct pairs. Keep a fallback for malformed exports
      // whose counterparty account is absent.
      transferId = transferIdOverride || `transfer_${parsedDate}_${inflow + outflow}_${rowIndex}`;

      // Empty-category transfers use Budgero's system Transfers category. API
      // transfers that do carry a spending/income category keep it so YNAB's
      // envelope activity and subsequent cash-overspend rollover are preserved.
      if (!row.ExcludeFromReadyToAssign) {
        const descriptor = categoryDescriptor(row);
        if (!descriptor) categoryId = 0;
      } else {
        // YNAB records a categoryless transfer across the budget boundary as
        // Uncategorized activity: it does not change current-month RTA, but a
        // cash outflow rolls into the following month's RTA as overspending.
        // Only the on-budget leg participates in that envelope activity.
        const currentAccount = this.accountService.getAccount(accountId);
        categoryId = currentAccount.OnBudget ? uncategorizedCategoryId : 0;
      }

      const currentAccount = row.Account.trim();
      if (!memo && inflow > 0) {
        // This is the receiving account
        const sourceAccount = transferCounterpartyName(row);
        memo = sourceAccount
          ? `Transfer from ${sourceAccount} to ${currentAccount}`
          : `Transfer to ${currentAccount}`;
      } else if (!memo && outflow > 0) {
        // This is the sending account
        const destinationAccount = transferCounterpartyName(row);
        memo = destinationAccount
          ? `Transfer from ${currentAccount} to ${destinationAccount}`
          : `Transfer from ${currentAccount}`;
      }
    }

    // Use transactions service to properly handle balances
    try {
      debugLog(
        `Importing row ${rowIndex} -> memo='${memo}' payee='${payee}' inflow=${inflow} outflow=${outflow}`
      );
      const transactionId = await this.transactionService.addTransaction(
        inflow,
        outflow,
        accountId,
        categoryId,
        budgetId,
        parsedDate,
        memo,
        transferId,
        payee,
        undefined,
        undefined,
        row.ExcludeFromReadyToAssign === true
      );
      if (row.Cleared.trim().toLowerCase() === 'reconciled') {
        this.db
          .prepare('UPDATE transactions SET Reconciled = 1 WHERE ID = ? AND BudgetID = ?')
          .run(transactionId, budgetId);
      }
      return true;
    } catch (error) {
      console.error(`DEBUG: Error adding transaction ${rowIndex}:`, error);
      throw new Error(`Failed to add transaction ${rowIndex}: ${error}`);
    }
  }

  private isTransfer(row: YNABRegisterRow): boolean {
    return isTransferRow(row);
  }

  /**
   * Two-number date formats (01/05/2025) are ambiguous between day-first
   * (DD/MM, e.g. European YNAB settings) and month-first (MM/DD, US
   * settings). One export file is always internally consistent, so scan all
   * dates once for a leading or middle component that can only be a day
   * (> 12) and lock the order in for the whole import.
   */
  private detectAmbiguousDateOrder(
    dates: (string | undefined)[],
    dateOrder?: YNABImportConfig['dateOrder']
  ): void {
    if (dateOrder) {
      this.ambiguousDayFirst = dateOrder === 'day-first';
      return;
    }
    const { dayFirstEvidence, monthFirstEvidence } = inspectDateOrder(dates);

    // Ties (no evidence either way) keep the historical day-first default.
    this.ambiguousDayFirst = monthFirstEvidence <= dayFirstEvidence;
    debugLog(
      `Ambiguous date order: ${this.ambiguousDayFirst ? 'day-first' : 'month-first'} ` +
        `(day-first evidence: ${dayFirstEvidence}, month-first evidence: ${monthFirstEvidence})`
    );
  }

  private parseYNABDate(dateStr: string): string {
    const trimmed = dateStr.trim();
    if (!trimmed) {
      return '';
    }

    const yearFirst = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    const yearLast = trimmed.match(AMBIGUOUS_DATE_REGEX);

    let year: string, month: string, day: string;
    if (yearFirst) {
      [, year, month, day] = yearFirst;
    } else if (yearLast) {
      if (this.ambiguousDayFirst) {
        [, day, month, year] = yearLast;
      } else {
        [, month, day, year] = yearLast;
      }
      // A month above 12 means the detected order is wrong for this row
      // (possible when a short file had no disambiguating dates) — swap.
      if (Number(month) > 12 && Number(day) <= 12) {
        [day, month] = [month, day];
      }
    } else {
      debugLog(`Could not parse date '${dateStr}' with any known format`);
      return '';
    }

    // Return in standard format (YYYY-MM-DD)
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  private parseYNABMonth(monthStr: string): string {
    const monthAbbreviations: Record<string, string> = {
      Jan: '01',
      Feb: '02',
      Mar: '03',
      Apr: '04',
      May: '05',
      Jun: '06',
      Jul: '07',
      Aug: '08',
      Sep: '09',
      Oct: '10',
      Nov: '11',
      Dec: '12',
    };

    const trimmed = monthStr.trim();
    if (!trimmed) {
      return '';
    }

    const isoMonth = trimmed.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
    if (isoMonth) return `${isoMonth[1]}-${isoMonth[2]}`;

    const parts = trimmed.split(' ');
    if (parts.length !== 2) {
      debugLog(`Invalid month format '${monthStr}', expected 'Mon YYYY'`);
      return '';
    }

    const monthNum = monthAbbreviations[parts[0]];
    if (!monthNum) {
      debugLog(`Unknown month abbreviation '${parts[0]}' in '${monthStr}'`);
      return '';
    }

    const result = `${parts[1]}-${monthNum}`;
    debugLog(`Parsed month '${monthStr}' -> '${result}'`);
    return result;
  }
}
