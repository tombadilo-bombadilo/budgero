import type { GetTransactionsByAccountRow } from '@budgero/core/browser';

type TransferBudgetState = Pick<
  GetTransactionsByAccountRow,
  'TransferID' | 'AccountOnBudget' | 'TransferAccountOnBudget'
>;

/** Categories for transfers between two on-budget accounts are system-managed. */
export function hasReadOnlyTransferCategory(transaction: TransferBudgetState): boolean {
  return Boolean(
    transaction.TransferID?.trim() &&
    transaction.AccountOnBudget &&
    transaction.TransferAccountOnBudget
  );
}

/** Off-budget transfer legs may choose Transfers (RTA) or a regular category. */
export function transferHasOffBudgetLeg(transaction: TransferBudgetState): boolean {
  if (!transaction.TransferID?.trim()) return false;
  const isOffBudget = (value: boolean | number | null | undefined) =>
    value != null && Number(value) === 0;
  return (
    isOffBudget(transaction.AccountOnBudget) || isOffBudget(transaction.TransferAccountOnBudget)
  );
}

/** A transfer target with its direction arrow, as the payee cell shows it. */
const transferArrowLabel = (accountName: string, sent: boolean) =>
  `${sent ? '→' : '←'} ${accountName}`;

type TransferPayeeSource = Pick<
  GetTransactionsByAccountRow,
  'TransferID' | 'TransferAccountName' | 'Payee' | 'OutflowConverted'
>;

/**
 * What the payee cell shows for a transfer without a payee: the other account,
 * with an arrow for direction ("→ Savings" sent, "← Checking" received), so the
 * destination stays visible however long the memo is.
 */
export function transferPayeeLabel(transaction: TransferPayeeSource): string | null {
  if (!transaction.TransferID?.trim() || transaction.Payee || !transaction.TransferAccountName) {
    return null;
  }
  return transferArrowLabel(
    transaction.TransferAccountName,
    Number(transaction.OutflowConverted) > 0
  );
}

/**
 * What the payee cell shows for a split without a payee of its own: its
 * lines' payees and transfer targets (with an arrow, as for a transfer), each
 * once, in line order ("→ Checking EUR, Walmart"). Null when it has a payee,
 * is no split, or its lines have none.
 */
export function splitPayeesLabel(
  transaction: Pick<GetTransactionsByAccountRow, 'Payee' | 'SplitPayees'>
): string | null {
  if (transaction.Payee || !transaction.SplitPayees) return null;
  let lines: unknown;
  try {
    lines = JSON.parse(transaction.SplitPayees);
  } catch {
    return null;
  }
  if (!Array.isArray(lines)) return null;
  const labels: string[] = [];
  for (const line of lines) {
    if (!Array.isArray(line)) continue;
    const [payee, target, sent] = line as unknown[];
    const label =
      typeof payee === 'string' && payee.trim()
        ? payee.trim()
        : typeof target === 'string' && target
          ? transferArrowLabel(target, Boolean(Number(sent)))
          : '';
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.length ? labels.join(', ') : null;
}

/**
 * What a split line shows as its payee when it is not being edited: its own
 * payee, else its transfer target (with an arrow), else the parent's payee.
 */
export function splitLinePayeeLabel(
  line: {
    payee?: string | null;
    Payee?: string | null;
    transfer_account_name?: string | null;
    TransferAccountName?: string | null;
    outflow?: number | null;
    OutflowConverted?: number | null;
    OutflowNative?: number | null;
  },
  parentPayee?: string | null
): string | null {
  const own = (line.payee || line.Payee || '').trim();
  if (own) return own;
  const target = line.transfer_account_name || line.TransferAccountName;
  if (target) {
    const sent = Number(line.outflow ?? line.OutflowNative ?? line.OutflowConverted ?? 0) > 0;
    return transferArrowLabel(target, sent);
  }
  return parentPayee || null;
}
