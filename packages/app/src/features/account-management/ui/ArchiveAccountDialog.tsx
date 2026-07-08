import React, { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Field } from '@shared/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { toast } from 'sonner';
import type { Account } from '@budgero/core/browser';
import { useSetAccountArchived } from '@entities/account/api/useAccounts';
import { useAddTransaction } from '@entities/transaction/api/useTransactions';
import { useCategories, useCategoryGroups } from '@entities/category/api/useCategories';
import { findCategoryByName } from '@entities/category/lib/find-category';
import { getTodayISO } from '@shared/lib/date-utils';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';
import { toastError } from '@shared/lib/errors';

interface ArchiveAccountDialogProps {
  account: Account;
  budgetId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArchived?: () => void;
}

/**
 * Archive flow: if balance is non-zero, creates an editable adjusting transaction
 * (user picks category, defaulting to Income) to bring the account to zero before
 * flipping the Archived flag. If balance is already zero, just flips the flag.
 */
export function ArchiveAccountDialog({
  account,
  budgetId,
  open,
  onOpenChange,
  onArchived,
}: ArchiveAccountDialogProps) {
  const balance = account.Balance ?? 0;
  const needsAdjustment = balance !== 0;

  const setArchivedMutation = useSetAccountArchived();
  const addTransactionMutation = useAddTransaction();

  const { data: categories = [] } = useCategories(budgetId);
  const { data: categoryGroups = [] } = useCategoryGroups(budgetId);

  // Default to the "Income" category if it exists.
  const defaultCategoryId = useMemo(() => {
    const income = findCategoryByName(categories, 'Income');
    return income?.ID ?? categories[0]?.ID ?? 0;
  }, [categories]);

  const [categoryId, setCategoryId] = useState<number>(defaultCategoryId);
  const [memo, setMemo] = useState<string>('Archive adjustment');
  const [date, setDate] = useState<string>(() => getTodayISO());

  // Keep default category in sync once categories load.
  React.useEffect(() => {
    if (!categoryId && defaultCategoryId) {
      setCategoryId(defaultCategoryId);
    }
  }, [defaultCategoryId, categoryId]);

  // When balance is positive we need an outflow to zero it; when negative we need an inflow.
  // All milliunits (Account.Balance is a stored amount).
  const inflow = balance < 0 ? Math.abs(balance) : 0;
  const outflow = balance > 0 ? balance : 0;

  const groupNameById = useMemo(() => {
    const map = new Map<number, string>();
    categoryGroups.forEach((g) => map.set(g.ID, g.Name));
    return map;
  }, [categoryGroups]);

  const handleArchive = async () => {
    try {
      if (needsAdjustment) {
        if (!categoryId) {
          toast.error('Please pick a category for the adjustment');
          return;
        }
        await addTransactionMutation.mutateAsync({
          inflow,
          outflow,
          accountId: account.ID,
          categoryId,
          budgetId,
          date,
          memo,
          transferId: '',
        });
      }

      await setArchivedMutation.mutateAsync({
        id: account.ID,
        budget_id: budgetId,
        archived: true,
      });

      toast.success('Account archived', {
        description: needsAdjustment
          ? `${account.Name} balanced to zero and archived.`
          : `${account.Name} has been archived.`,
      });
      onOpenChange(false);
      onArchived?.();
    } catch (error) {
      toastError('Failed to archive account', error, 'Please try again.');
    }
  };

  const isPending = addTransactionMutation.isPending || setArchivedMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-4 sm:p-6 text-sm sm:text-base max-h-[min(92vh,calc(100dvh-2rem))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">Archive account</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Archived accounts are hidden from sidebars and account pickers by default, but their
            historical transactions remain visible in reports and transaction lists. You can
            unarchive an account later from the All Accounts page.
          </DialogDescription>
        </DialogHeader>

        {needsAdjustment ? (
          <div className="space-y-3">
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs sm:text-sm">
              <p>
                <strong>{account.Name}</strong> has a current balance of{' '}
                <strong>
                  {toDecimal(asMilli(balance)).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  {account.Currency}
                </strong>
                . To archive it, Budgero will create the following adjusting transaction to bring
                the balance to zero. You can edit the details below, and the transaction will remain
                editable afterwards.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Inflow" className="space-y-1">
                <Input
                  className="h-8 sm:h-9"
                  value={toDecimal(asMilli(inflow)).toFixed(2)}
                  readOnly
                  disabled
                />
              </Field>
              <Field label="Outflow" className="space-y-1">
                <Input
                  className="h-8 sm:h-9"
                  value={toDecimal(asMilli(outflow)).toFixed(2)}
                  readOnly
                  disabled
                />
              </Field>
            </div>

            <Field
              label="Category"
              htmlFor="archive-category"
              className="space-y-1"
              hint={
                <span className="text-[11px]">
                  Defaults to Income. Pick a different category if this adjustment represents
                  something else (e.g. debt forgiveness, write-off).
                </span>
              }
            >
              <Select
                value={categoryId ? String(categoryId) : ''}
                onValueChange={(v) => setCategoryId(Number(v))}
              >
                <SelectTrigger id="archive-category" className="h-8 sm:h-9">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => {
                    const groupName = groupNameById.get(c.CategoryGroupID) ?? '';
                    return (
                      <SelectItem key={c.ID} value={String(c.ID)}>
                        {groupName ? `${groupName} / ${c.Name}` : c.Name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Memo" htmlFor="archive-memo" className="space-y-1">
              <Input
                id="archive-memo"
                className="h-8 sm:h-9"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Archive adjustment"
              />
            </Field>

            <Field label="Date" htmlFor="archive-date" className="space-y-1">
              <Input
                id="archive-date"
                type="date"
                className="h-8 sm:h-9"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs sm:text-sm">
            <p>
              <strong>{account.Name}</strong> has a zero balance and will be archived without any
              further changes.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-8 sm:h-9"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-8 sm:h-9"
            onClick={handleArchive}
            disabled={isPending || (needsAdjustment && !categoryId)}
          >
            {isPending ? 'Archiving...' : 'Archive'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
