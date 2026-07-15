import JSZip from 'jszip';
import { DatabaseAdapter } from '../../database/interface.js';
import { fromDecimal, ZERO_MILLI } from '../../money/index.js';
import { BudgetService } from '../budgets/index.js';
import { CategoryService } from '../categories/index.js';
import { AccountService } from '../accounts/index.js';
import { MonthlyBudgetService } from '../monthly-budgets/index.js';
import { TransactionService } from '../transactions/index.js';
import { ensureCategoryWithGroup } from '../transactions/category-helpers.js';
import { YNABImportConfig, YNABRegisterRow, YNABBudgetRow } from './types.js';
import { CSVParser } from './csv-parser.js';
import { CurrencyParser } from './currency-parser.js';

import { createLogger } from '../../logger.js';

const debugLog = createLogger('services:import:ynab-import-service');

/** Matches DD/MM/YYYY and MM/DD/YYYY style dates with -, / or . separators. */
const AMBIGUOUS_DATE_REGEX = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/;

export class YNABImportService {
  private budgetService: BudgetService;

  private categoryService: CategoryService;

  private accountService: AccountService;

  private monthlyBudgetService: MonthlyBudgetService;

  private transactionService: TransactionService;

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
    this.csvParser = new CSVParser();
    this.currencyParser = new CurrencyParser();
  }

  async importYNABFromZip(
    zipData: ArrayBuffer | Uint8Array,
    config: YNABImportConfig
  ): Promise<number> {
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(zipData);

    let registerData: string | undefined;
    let budgetData: string | undefined;

    for (const [filename, file] of Object.entries(zipContent.files)) {
      if (file.dir) {
        continue; // skip directories inside the archive
      }

      const lowerName = filename.toLowerCase();
      const hasSupportedExtension = lowerName.endsWith('.csv') || lowerName.endsWith('.tsv');

      if (!hasSupportedExtension) {
        continue;
      }

      if (lowerName.includes('register') && !registerData) {
        registerData = await file.async('string');
        continue;
      }

      if ((lowerName.includes('budget') || lowerName.includes('plan')) && !budgetData) {
        budgetData = await file.async('string');
      }
    }

    if (!registerData) {
      throw new Error('register CSV file not found in ZIP');
    }

    if (!budgetData) {
      throw new Error('budget CSV file not found in ZIP');
    }

    const registerRows = this.csvParser.parseRegisterCSV(registerData);
    debugLog(`Parsed ${registerRows.length} register rows`);

    this.detectAmbiguousDateOrder(registerRows.map((row) => row.Date));

    const budgetRows = this.csvParser.parseBudgetCSV(budgetData);
    debugLog(`Parsed ${budgetRows.length} budget rows`);

    // Create budget WITHOUT default categories since we're importing our own
    debugLog('Creating budget...');
    const budgetId = await this.budgetService.createBudget({
      name: config.budgetName,
      display_currency: config.currency,
      badge_icon: config.badgeIcon,
      number_format: config.numberFormat,
      create_default_categories: false,
    });
    debugLog(`Created budget with ID: ${budgetId}`);

    debugLog('Creating categories...');
    debugLog(`About to call createCategoryStructure with budgetId=${budgetId}`);
    const categories = this.createCategoryStructure(budgetId, budgetRows);
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

    debugLog('Creating accounts...');
    const accounts = await this.createAccounts(budgetId, registerRows, config.currency);
    debugLog(`Created ${Object.keys(accounts).length} accounts`);

    debugLog('Importing assignments...');
    this.importAssignments(budgetId, budgetRows, categories, config.numberFormat);
    debugLog('Assignments imported successfully');

    debugLog('Importing transactions...');
    await this.importTransactionsWithProperBalances(
      budgetId,
      registerRows,
      accounts,
      categories,
      config.numberFormat
    );
    debugLog('Transactions imported successfully');

    return budgetId;
  }

  private createCategoryStructure(
    budgetId: number,
    budgetRows: YNABBudgetRow[]
  ): Record<string, number> {
    const categories: Record<string, number> = {};
    const categoryGroups: Record<string, number> = {};

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
    categories['Income'] = incomeCategoryId; // Fallback for compatibility

    const uncategorizedCategoryId = ensureCategoryWithGroup(
      this.categoryService,
      budgetId,
      'Uncategorized',
      'Uncategorized',
      ''
    );
    categories['Uncategorized::Uncategorized'] = uncategorizedCategoryId;
    categories['Uncategorized'] = uncategorizedCategoryId; // Fallback for compatibility

    // Then map all existing category groups (system ones included) so the
    // row loop below reuses them instead of creating duplicates.
    const existingGroups = this.categoryService.getAllCategoryGroups(budgetId);
    debugLog(`Found ${existingGroups.length} existing category groups`);
    for (const group of existingGroups) {
      categoryGroups[group.Name] = group.ID;
      debugLog(`Existing group: "${group.Name}" with ID ${group.ID}`);
    }

    let rowCount = 0;
    const seenInRows: Set<string> = new Set();
    for (const row of budgetRows) {
      rowCount++;
      if (row.CategoryGroup && row.Category) {
        let groupName = row.CategoryGroup.trim();
        let categoryName = row.Category.trim();

        const rowKey = `${row.Month}::${groupName}::${categoryName}`;
        if (!seenInRows.has(rowKey)) {
          seenInRows.add(rowKey);
          debugLog(
            `Row ${rowCount}: Month="${row.Month}", Group="${groupName}", Category="${categoryName}"`
          );
        }

        // Map YNAB special categories to Income
        if (
          groupName.toLowerCase().includes('inflow') ||
          categoryName.toLowerCase().includes('ready to assign')
        ) {
          debugLog(`Mapping "${groupName}::${categoryName}" to "Income::Income"`);
          groupName = 'Income';
          categoryName = 'Income';
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
        const categoryKey = `${groupName}::${categoryName}`;
        if (!(categoryKey in categories)) {
          const categoryId = this.categoryService.addCategory(
            categoryGroups[groupName],
            budgetId,
            categoryName,
            ''
          );
          categories[categoryKey] = categoryId;
        }
      }
    }

    debugLog('Final categoryGroups:', Object.keys(categoryGroups));
    debugLog(`Total category groups created: ${Object.keys(categoryGroups).length}`);

    return categories;
  }

  private async createAccounts(
    budgetId: number,
    registerRows: YNABRegisterRow[],
    currency: string
  ): Promise<Record<string, number>> {
    const accounts: Record<string, number> = {};
    const uniqueAccounts = new Set<string>();

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

    for (const accountName of uniqueAccounts) {
      const account = await this.accountService.createAccount(
        accountName,
        budgetId,
        'Checking',
        currency,
        ZERO_MILLI
      );
      accounts[accountName] = account.ID;
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

      let categoryName = row.Category.trim();
      let groupName = row.CategoryGroup.trim();

      if (
        row.CategoryGroup.toLowerCase().includes('ready to assign') ||
        row.CategoryGroup.toLowerCase().includes('to be assigned')
      ) {
        categoryName = 'Income';
        groupName = 'Income';
      }

      // Use the same key format as in createCategoryStructure
      const categoryKey = `${groupName}::${categoryName}`;
      const categoryId = categories[categoryKey] || categories[categoryName]; // Fallback for Income/Uncategorized
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
    accounts: Record<string, number>,
    categories: Record<string, number>,
    numberFormat: string
  ): Promise<void> {
    const incomeCategoryId = categories['Income'];
    const uncategorizedCategoryId = categories['Uncategorized'];

    // Sort transactions chronologically (oldest first)
    const sortedRows = [...registerRows].sort((a, b) => {
      const dateA = this.parseYNABDate(a.Date);
      const dateB = this.parseYNABDate(b.Date);
      if (!dateA || !dateB) return 0;
      return dateA.localeCompare(dateB);
    });

    debugLog(`Processing ${sortedRows.length} transactions in chronological order`);

    for (let i = 0; i < sortedRows.length; i++) {
      const row = sortedRows[i];
      if (!row.Account || !row.Date) {
        continue;
      }

      const accountId = accounts[row.Account.trim()];
      if (!accountId) {
        continue;
      }

      const inflow = fromDecimal(
        this.currencyParser.parseYNABAmountAdvanced(row.Inflow, numberFormat)
      );
      const outflow = fromDecimal(
        this.currencyParser.parseYNABAmountAdvanced(row.Outflow, numberFormat)
      );

      let categoryId: number;
      if (row.Category) {
        const categoryName = row.Category.trim();
        const groupName = row.CategoryGroup ? row.CategoryGroup.trim() : '';

        // Try with group::category key first, then fallback to just category name
        const categoryKey = groupName ? `${groupName}::${categoryName}` : categoryName;

        if (categories[categoryKey]) {
          categoryId = categories[categoryKey];
        } else if (categories[categoryName]) {
          // Fallback for Income/Uncategorized or if no group specified
          categoryId = categories[categoryName];
        } else if (categoryName.toLowerCase().includes('ready to assign')) {
          categoryId = incomeCategoryId;
        } else {
          debugLog(
            `Category '${categoryName}' in group '${groupName}' not found in transaction, using Uncategorized`
          );
          categoryId = uncategorizedCategoryId;
        }
      } else {
        categoryId = inflow > 0 ? incomeCategoryId : uncategorizedCategoryId;
      }

      const parsedDate = this.parseYNABDate(row.Date);
      if (!parsedDate) {
        debugLog(`Skipping transaction with invalid date: ${row.Date}`);
        continue;
      }

      let memo = row.Memo;
      const rawPayee = (row.Payee || '').trim();
      const payeeLower = rawPayee.toLowerCase();
      let payee = rawPayee.length > 0 ? rawPayee : 'Budgero';
      let transferId = '';

      if (payeeLower.includes('starting balance')) {
        memo = 'Starting Balance';
        payee = 'Budgero';
      } else if (payeeLower.includes('reconciliation balance adjustment')) {
        payee = 'Budgero';
      }

      if (this.isTransfer(row)) {
        transferId = `transfer_${parsedDate}_${inflow + outflow}`;

        // YNAB transfer rows have an empty category, so the block above defaulted
        // categoryId to Uncategorized. Reset it to 0 so addTransaction assigns the
        // proper "Transfers" category — passing a non-zero, non-Transfers id would
        // trip its "user chose a custom category" heuristic and keep Uncategorized
        // on the source (outflow) leg.
        categoryId = 0;

        const currentAccount = row.Account.trim();
        if (inflow > 0) {
          // This is the receiving account
          if (rawPayee && payeeLower.includes('transfer')) {
            const payeeParts = rawPayee.split(':');
            if (payeeParts.length > 1) {
              const sourceAccount = payeeParts[1].trim();
              memo = `Transfer from ${sourceAccount} to ${currentAccount}`;
            } else {
              memo = `Transfer to ${currentAccount}`;
            }
          }
        } else if (outflow > 0) {
          // This is the sending account
          if (rawPayee && payeeLower.includes('transfer')) {
            const payeeParts = rawPayee.split(':');
            if (payeeParts.length > 1) {
              const destAccount = payeeParts[1].trim();
              memo = `Transfer from ${currentAccount} to ${destAccount}`;
            } else {
              memo = `Transfer from ${currentAccount}`;
            }
          }
        }
      }

      // Use transactions service to properly handle balances
      try {
        debugLog(
          `Importing row ${i} -> memo='${memo}' payee='${payee}' inflow=${inflow} outflow=${outflow}`
        );
        // Await so failures surface in this catch instead of as unhandled
        // rejections after the import already reported success.
        await this.transactionService.addTransaction(
          inflow,
          outflow,
          accountId,
          categoryId,
          budgetId,
          parsedDate,
          memo,
          transferId,
          payee
        );
      } catch (error) {
        console.error(`DEBUG: Error adding transaction ${i}:`, error);
        throw new Error(`Failed to add transaction ${i}: ${error}`);
      }

      if (i % 50 === 0) {
        debugLog(`Processed ${i + 1}/${sortedRows.length} transactions`);
      }
    }
  }

  private isTransfer(row: YNABRegisterRow): boolean {
    const payee = (row.Payee || '').toLowerCase();
    const category = (row.Category || '').toLowerCase();
    const memo = (row.Memo || '').toLowerCase();

    return payee.includes('transfer') || category.includes('transfer') || memo.includes('transfer');
  }

  /**
   * Two-number date formats (01/05/2025) are ambiguous between day-first
   * (DD/MM, e.g. European YNAB settings) and month-first (MM/DD, US
   * settings). One export file is always internally consistent, so scan all
   * dates once for a leading or middle component that can only be a day
   * (> 12) and lock the order in for the whole import.
   */
  private detectAmbiguousDateOrder(dates: (string | undefined)[]): void {
    let dayFirstEvidence = 0;
    let monthFirstEvidence = 0;

    for (const raw of dates) {
      const match = raw?.trim().match(AMBIGUOUS_DATE_REGEX);
      if (!match) continue;
      const first = Number(match[1]);
      const second = Number(match[2]);
      if (first > 12 && second <= 12) dayFirstEvidence++;
      else if (second > 12 && first <= 12) monthFirstEvidence++;
    }

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
