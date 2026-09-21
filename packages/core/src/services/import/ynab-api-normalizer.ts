import type {
  YNABApiPlanSnapshot,
  YNABApiSubtransaction,
  YNABApiTransaction,
  YNABBudgetRow,
  YNABImportAccountSpec,
  YNABImportCategoryMonthSpec,
  YNABImportReadyToAssignSpec,
  YNABRegisterRow,
} from './types.js';
import { inspectYNABCreditPaymentMappings } from './ynab-credit-payment-mapping.js';

export interface NormalizedYNABApiImport {
  registerRows: YNABRegisterRow[];
  budgetRows: YNABBudgetRow[];
  accountSpecs: YNABImportAccountSpec[];
  categoryMonthSpecs: YNABImportCategoryMonthSpec[];
  readyToAssignSpecs: YNABImportReadyToAssignSpec[];
  source: {
    transactions: number;
    subtransactions: number;
    registerRows: number;
    moneyMovements?: number;
    categoryAssignmentsVerified?: number;
  };
}

const YNAB_MANAGED_DEBT_ACCOUNT_TYPES = new Set([
  'mortgage',
  'autoLoan',
  'studentLoan',
  'personalLoan',
  'medicalDebt',
  'otherDebt',
]);

export function normalizeYNABMilliunitPrecision(value: number, decimalDigits: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid YNAB milliunit amount: ${value}`);
  }
  const supportedDigits = Math.max(0, Math.min(3, Math.trunc(decimalDigits)));
  const increment = 10 ** (3 - supportedDigits);
  return Math.sign(value) * Math.round(Math.abs(value) / increment) * increment;
}

function milliToDecimal(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid YNAB milliunit amount: ${value}`);
  }
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / 1000);
  const fraction = String(absolute % 1000).padStart(3, '0');
  return `${sign}${whole}.${fraction}`;
}

export function mapYNABAccountType(type: string): string {
  switch (type) {
    case 'checking':
      return 'Checking';
    case 'savings':
      return 'Savings';
    case 'cash':
      return 'Cash';
    case 'creditCard':
    case 'lineOfCredit':
      return 'Credit';
    case 'mortgage':
      return 'Mortgage';
    case 'autoLoan':
    case 'studentLoan':
    case 'medicalDebt':
    case 'personalLoan':
    case 'otherDebt':
    case 'otherLiability':
      return 'Loan';
    case 'otherAsset':
      return 'Other Asset';
    default:
      return 'Checking';
  }
}

function transferIdFor(
  transaction: Pick<YNABApiTransaction, 'id'> & { transfer_transaction_id?: string | null }
): string | undefined {
  if (!transaction.transfer_transaction_id) return undefined;
  return `ynab_transfer_${[transaction.id, transaction.transfer_transaction_id].sort().join('_')}`;
}

export function normalizeYNABApiSnapshot(snapshot: YNABApiPlanSnapshot): NormalizedYNABApiImport {
  const { plan } = snapshot;
  const creditPaymentMappings = inspectYNABCreditPaymentMappings(snapshot).automatic;
  const normalizeAmount = (value: number) =>
    normalizeYNABMilliunitPrecision(value, plan.currency_format?.decimal_digits ?? 3);
  const accountsById = new Map(plan.accounts.map((account) => [account.id, account]));
  const groupsById = new Map(plan.category_groups.map((group) => [group.id, group]));
  const categoriesById = new Map(plan.categories.map((category) => [category.id, category]));
  const payeesById = new Map(plan.payees.map((payee) => [payee.id, payee]));
  const childrenByTransactionId = new Map<string, YNABApiSubtransaction[]>();
  const splitTransferIds = new Map<string, string>();

  for (const child of plan.subtransactions) {
    if (child.deleted) continue;
    const children = childrenByTransactionId.get(child.transaction_id) || [];
    children.push(child);
    childrenByTransactionId.set(child.transaction_id, children);
    if (child.transfer_account_id && child.transfer_transaction_id) {
      const transferId = transferIdFor(child)!;
      splitTransferIds.set(child.id, transferId);
      // The receiving transaction may point back to the split parent. Use
      // the child's explicit relationship for both legs of this transfer.
      splitTransferIds.set(child.transfer_transaction_id, transferId);
    }
  }

  const categoryFields = (categoryId: string | null) => {
    const category = categoryId ? categoriesById.get(categoryId) : undefined;
    const group = category ? groupsById.get(category.category_group_id) : undefined;
    return {
      CategoryPath: category ? `${group?.name || 'Imported from YNAB'}: ${category.name}` : '',
      CategoryGroup: category ? group?.name || 'Imported from YNAB' : '',
      Category: category?.name || '',
      ...(category
        ? {
            SourceCategoryId: category.id,
            SourceCategoryGroupId: category.category_group_id,
            SourceCategoryInternal: category.internal,
            SourceCategoryGroupInternal: group?.internal ?? false,
          }
        : {}),
    };
  };

  const transactionPayee = (
    payeeId: string | null,
    transferAccountId: string | null,
    fallbackPayeeId?: string | null
  ) => {
    if (transferAccountId) {
      const targetAccount = accountsById.get(transferAccountId);
      return targetAccount ? `Transfer : ${targetAccount.name}` : 'Transfer : Unknown account';
    }
    return (
      (payeeId ? payeesById.get(payeeId)?.name : undefined) ||
      (fallbackPayeeId ? payeesById.get(fallbackPayeeId)?.name : undefined) ||
      ''
    );
  };

  const amountFields = (amount: number) => {
    const normalized = normalizeAmount(amount);
    return {
      Outflow: normalized < 0 ? milliToDecimal(-normalized) : '0.000',
      Inflow: normalized > 0 ? milliToDecimal(normalized) : '0.000',
    };
  };

  const isCategorylessBudgetBoundaryTransfer = (
    accountId: string,
    transferAccountId: string | null,
    categoryId: string | null
  ) => {
    if (!transferAccountId || categoryId) return false;
    const source = accountsById.get(accountId);
    const destination = accountsById.get(transferAccountId);
    return Boolean(source && destination && source.on_budget !== destination.on_budget);
  };

  const registerRows: YNABRegisterRow[] = [];
  const transactionNetByAccount = new Map<string, number>();
  let sourceTransactions = 0;
  let sourceSubtransactions = 0;
  let expectedRegisterRows = 0;
  for (const transaction of plan.transactions) {
    if (transaction.deleted) continue;
    const account = accountsById.get(transaction.account_id);
    if (!account || account.deleted) continue;

    sourceTransactions++;
    const transactionAmount = normalizeAmount(transaction.amount);
    transactionNetByAccount.set(
      transaction.account_id,
      (transactionNetByAccount.get(transaction.account_id) || 0) + transactionAmount
    );
    const children = childrenByTransactionId.get(transaction.id) || [];
    if (children.length > 0) {
      const childTotal = children.reduce(
        (total, child) => total + normalizeAmount(child.amount),
        0
      );
      if (childTotal !== transactionAmount) {
        throw new Error(
          `YNAB source integrity check failed: split transaction ${transaction.id} has parent amount ${transactionAmount} but its active parts total ${childTotal}.`
        );
      }
      sourceSubtransactions += children.length;
      expectedRegisterRows += children.length;
      for (const child of children) {
        registerRows.push({
          Account: account.name,
          Flag: '',
          Date: transaction.date,
          Payee: transactionPayee(child.payee_id, child.transfer_account_id, transaction.payee_id),
          ...categoryFields(child.category_id),
          Memo: child.memo || '',
          ...amountFields(child.amount),
          Cleared: transaction.cleared,
          SourceId: transaction.id,
          SourceAccountId: account.id,
          SourceSubtransactionId: child.id,
          SourceParentMemo: transaction.memo || '',
          SourceParentPayee: transactionPayee(transaction.payee_id, null),
          SourceTransferAccountId: child.transfer_account_id,
          TransferID: splitTransferIds.get(child.id),
          ExcludeFromReadyToAssign: isCategorylessBudgetBoundaryTransfer(
            transaction.account_id,
            child.transfer_account_id,
            child.category_id
          ),
        });
      }
      continue;
    }

    expectedRegisterRows++;

    registerRows.push({
      Account: account.name,
      Flag: '',
      Date: transaction.date,
      Payee: transactionPayee(transaction.payee_id, transaction.transfer_account_id),
      ...categoryFields(transaction.category_id),
      Memo: transaction.memo || '',
      ...amountFields(transaction.amount),
      Cleared: transaction.cleared,
      SourceId: transaction.id,
      SourceAccountId: account.id,
      SourceTransferAccountId: transaction.transfer_account_id,
      TransferID: splitTransferIds.get(transaction.id) || transferIdFor(transaction),
      ExcludeFromReadyToAssign: isCategorylessBudgetBoundaryTransfer(
        transaction.account_id,
        transaction.transfer_account_id,
        transaction.category_id
      ),
    });
  }

  if (registerRows.length !== expectedRegisterRows) {
    throw new Error(
      `YNAB source integrity check failed: expected ${expectedRegisterRows} normalized register rows but produced ${registerRows.length}.`
    );
  }

  const budgetRows: YNABBudgetRow[] = [];
  const categoryMonthSpecs: YNABImportCategoryMonthSpec[] = [];
  const categoryMonthIds: string[] = [];
  const representedCategoryIds = new Set<string>();
  for (const month of plan.months) {
    if (month.deleted) continue;
    for (const category of month.categories || []) {
      if (category.deleted) continue;
      const fields = categoryFields(category.id);
      budgetRows.push({
        Month: month.month,
        ...fields,
        Assigned: milliToDecimal(normalizeAmount(category.budgeted || 0)),
        Activity: milliToDecimal(normalizeAmount(category.activity || 0)),
        Available: milliToDecimal(normalizeAmount(category.balance || 0)),
      });
      representedCategoryIds.add(category.id);

      const group = groupsById.get(category.category_group_id);
      if (!category.internal || group?.name === 'Credit Card Payments') {
        categoryMonthSpecs.push({
          month: month.month.slice(0, 7),
          ynabCategoryId: category.id,
          categoryGroup: group?.name || 'Imported from YNAB',
          category: category.name,
          expectedAssigned: normalizeAmount(category.budgeted || 0),
          expectedActivity: normalizeAmount(category.activity || 0),
          expectedAvailable: normalizeAmount(category.balance || 0),
        });
        categoryMonthIds.push(category.id);
      }
    }
  }

  // Categories without a month row (often hidden or recently created) still
  // belong in the imported hierarchy and may be referenced by old history.
  for (const category of plan.categories) {
    if (category.deleted || representedCategoryIds.has(category.id)) continue;
    budgetRows.push({
      Month: plan.first_month || plan.last_month,
      ...categoryFields(category.id),
      Assigned: '0.000',
      Activity: milliToDecimal(normalizeAmount(category.activity || 0)),
      Available: milliToDecimal(normalizeAmount(category.balance || 0)),
    });
  }

  let categoryAssignmentsVerified: number | undefined;
  if (snapshot.moneyMovements) {
    const movementNet = new Map<string, number>();
    const monthsWithMovements = new Set<string>();
    const activeMovements = snapshot.moneyMovements.filter((movement) => !movement.deleted);
    // YNAB permits movements without a month. Their assignments remain in
    // the monthly category data, but we cannot attribute these auxiliary
    // records to a month or claim that any month's movement total is complete.
    const hasUnknownMovementMonth = activeMovements.some((movement) => !movement.month);
    for (const movement of activeMovements) {
      if (!movement.month) continue;
      const month = movement.month.slice(0, 7);
      monthsWithMovements.add(month);
      const amount = normalizeAmount(movement.amount);
      if (movement.from_category_id) {
        const key = `${month}::${movement.from_category_id}`;
        movementNet.set(key, (movementNet.get(key) || 0) - amount);
      }
      if (movement.to_category_id) {
        const key = `${month}::${movement.to_category_id}`;
        movementNet.set(key, (movementNet.get(key) || 0) + amount);
      }
    }

    let verifiedAssignments = 0;
    const mismatches = categoryMonthSpecs.flatMap((spec, index) => {
      // YNAB may omit historical Money Movements. A month without active
      // records is unverifiable, not evidence that every assignment was zero.
      if (hasUnknownMovementMonth || !monthsWithMovements.has(spec.month)) return [];
      const actual = movementNet.get(`${spec.month}::${categoryMonthIds[index]}`) || 0;
      if (actual === spec.expectedAssigned) {
        verifiedAssignments++;
        return [];
      }
      return [{ ...spec, movementNet: actual }];
    });
    if (mismatches.length > 0) {
      const visible = mismatches
        .slice(0, 6)
        .map(
          (item) =>
            `${item.month} ${item.categoryGroup} › ${item.category}: monthly assignment ${item.expectedAssigned}, Money Movements ${item.movementNet}`
        )
        .join('; ');
      const omitted = mismatches.length - Math.min(mismatches.length, 6);
      console.warn(
        `YNAB Money Movements warning: Money Movements disagree with ${mismatches.length} monthly category assignment${mismatches.length === 1 ? '' : 's'} (${visible}${omitted > 0 ? `; and ${omitted} more` : ''}). Continuing import using monthly category assignments.`
      );
    }
    categoryAssignmentsVerified = verifiedAssignments;
  }

  const latestTransactionDateByAccount = new Map<string, string>();
  const linkedCategoryCandidatesByAccount = new Map<string, Set<string>>();
  const recordDebtPaymentCategory = (
    categoryId: string | null,
    transferAccountId: string | null
  ) => {
    if (!categoryId || !transferAccountId) return;
    const transferAccount = accountsById.get(transferAccountId);
    if (!transferAccount || !YNAB_MANAGED_DEBT_ACCOUNT_TYPES.has(transferAccount.type)) return;

    const candidates =
      linkedCategoryCandidatesByAccount.get(transferAccount.id) || new Set<string>();
    candidates.add(categoryId);
    linkedCategoryCandidatesByAccount.set(transferAccount.id, candidates);
  };

  for (const transaction of plan.transactions) {
    if (transaction.deleted) continue;
    const existing = latestTransactionDateByAccount.get(transaction.account_id);
    if (!existing || transaction.date > existing) {
      latestTransactionDateByAccount.set(transaction.account_id, transaction.date);
    }

    recordDebtPaymentCategory(transaction.category_id, transaction.transfer_account_id);
  }

  for (const child of plan.subtransactions) {
    if (child.deleted) continue;
    recordDebtPaymentCategory(child.category_id, child.transfer_account_id);
  }

  return {
    registerRows,
    budgetRows,
    accountSpecs: plan.accounts
      .filter((account) => !account.deleted)
      .map((account) => {
        const candidates = linkedCategoryCandidatesByAccount.get(account.id);
        const linkedCategoryId = candidates?.size === 1 ? [...candidates][0] : undefined;
        const linkedCategory = linkedCategoryId ? categoriesById.get(linkedCategoryId) : undefined;
        const linkedGroup = linkedCategory
          ? groupsById.get(linkedCategory.category_group_id)
          : undefined;
        const creditPaymentCategoryId = creditPaymentMappings.get(account.id);
        return {
          name: account.name,
          type: mapYNABAccountType(account.type),
          onBudget: account.on_budget,
          archived: account.closed,
          ynabAccountId: account.id,
          expectedBalance: normalizeAmount(account.balance),
          expectedLedgerBalance: transactionNetByAccount.get(account.id) || 0,
          ynabAccountType: account.type,
          balanceAdjustmentDate:
            latestTransactionDateByAccount.get(account.id) || plan.last_month || plan.first_month,
          ...(linkedCategory && linkedGroup
            ? {
                linkedCategoryGroup: linkedGroup.name,
                linkedCategory: linkedCategory.name,
                linkedYNABCategoryId: linkedCategory.id,
              }
            : {}),
          ...(creditPaymentCategoryId
            ? { creditPaymentYNABCategoryId: creditPaymentCategoryId }
            : {}),
        };
      }),
    categoryMonthSpecs,
    readyToAssignSpecs: plan.months
      .filter((month) => !month.deleted)
      .map((month) => ({
        month: month.month.slice(0, 7),
        expectedReadyToAssign: normalizeAmount(month.to_be_budgeted),
      })),
    source: {
      transactions: sourceTransactions,
      subtransactions: sourceSubtransactions,
      registerRows: registerRows.length,
      ...(snapshot.moneyMovements
        ? { moneyMovements: snapshot.moneyMovements.filter((movement) => !movement.deleted).length }
        : {}),
      ...(categoryAssignmentsVerified === undefined ? {} : { categoryAssignmentsVerified }),
    },
  };
}
