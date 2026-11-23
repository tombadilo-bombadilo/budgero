import { useCallback, useEffect, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { toast } from 'sonner';
import type { UndatedTransaction } from '@budgero/core/browser';
import { getRuntime } from '@shared/runtime/global';
import { useUiStore } from '@shared/store/useUiStore';
import { useUpdateTransactionColumn } from '@entities/transaction/api/mutations';
import { getErrorMessage } from '@shared/lib/errors';
import { Button } from '@shared/ui/button';
import { DatePickerButton } from '@shared/ui/DatePickerButton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';

const CLEAN_PREFIX = 'budgero:undated-transactions-clean:';

function formatAmount(row: UndatedTransaction): string {
  const amount = (row.inflow - row.outflow) / 1000;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: row.currency }).format(
      amount
    );
  } catch {
    // Not an ISO currency code (crypto, custom).
    return `${amount} ${row.currency}`;
  }
}

/**
 * Older builds could save a transaction with an empty date (clicking the
 * selected day in the date cell cleared it). Such a row is in no month, so it
 * is hidden from the register while still counting in balances. On start this
 * looks for them once per space and asks for a date for each. A clean result
 * is remembered per browser; only builds that refuse new empty dates write
 * that marker, so the check then never needs to run again.
 */
export function UndatedTransactionsCheck() {
  const { t } = useLingui();
  const spaceId = useUiStore((state) => state.selectedBudget?.SpaceID);
  const updateColumn = useUpdateTransactionColumn();
  const [rows, setRows] = useState<UndatedTransaction[]>([]);
  const [dates, setDates] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const check = useCallback((space: string): UndatedTransaction[] | null => {
    const runtime = getRuntime();
    if (!runtime || runtime.getActiveSpaceId() !== space || !runtime.servicesReady()) return null;
    const found = runtime.services().transactions.listUndatedTransactions();
    if (found.length === 0) {
      try {
        window.localStorage.setItem(`${CLEAN_PREFIX}${space}`, '1');
      } catch {
        // Without storage the check simply runs again next start.
      }
    }
    return found;
  }, []);

  useEffect(() => {
    setRows([]);
    setOpen(false);
    if (!spaceId) return;
    try {
      if (window.localStorage.getItem(`${CLEAN_PREFIX}${spaceId}`) === '1') return;
    } catch {
      // Fall through and check.
    }
    try {
      const found = check(spaceId);
      if (!found || found.length === 0) return;
      setRows(found);
      setDates(Object.fromEntries(found.map((row) => [row.id, row.suggestedDate ?? ''])));
      setOpen(true);
    } catch {
      // Best-effort: try again on the next start.
    }
  }, [spaceId, check]);

  const save = async (row: UndatedTransaction) => {
    const date = dates[row.id];
    if (!date || !spaceId) return;
    setSavingId(row.id);
    try {
      await updateColumn.mutateAsync({
        transactionId: row.id,
        column: 'Date',
        value: date,
        accountId: row.accountId,
      });
      const left = check(spaceId) ?? rows.filter((other) => other.id !== row.id);
      setRows(left);
      if (left.length === 0) {
        setOpen(false);
        toast.success(t`All transactions have a date again`);
      }
    } catch (error) {
      toast.error(t`Could not save the date`, { description: getErrorMessage(error) });
    } finally {
      setSavingId(null);
    }
  };

  if (rows.length === 0) return null;
  const severalBudgets = new Set(rows.map((row) => row.budgetId)).size > 1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Some transactions have no date</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              An earlier version could clear a transaction's date by mistake. These transactions
              still count in your balances, but they are in no month, so they are hidden from your
              accounts and can throw off Ready to Assign. Pick a date for each one to bring it back.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">
                  {row.payee || row.memo || t`No payee`}
                </span>
                <span className="shrink-0 tabular-nums">{formatAmount(row)}</span>
              </div>
              <div className="text-muted-foreground min-w-0 truncate text-sm">
                {severalBudgets ? `${row.budgetName} · ${row.accountName}` : row.accountName}
                {row.payee && row.memo ? ` · ${row.memo}` : ''}
              </div>
              {row.suggestedDate && (
                <div className="text-muted-foreground text-sm">
                  <Trans>We filled in the date it had before. Change it if it is wrong.</Trans>
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <DatePickerButton
                    value={dates[row.id] ?? ''}
                    onChange={(value) => {
                      if (value) setDates((current) => ({ ...current, [row.id]: value }));
                    }}
                    placeholder={t`Pick a date`}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={!dates[row.id] || savingId !== null}
                  onClick={() => void save(row)}
                >
                  <Trans>Save date</Trans>
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            <Trans>Later</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
