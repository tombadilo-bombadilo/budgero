import { Trans, useLingui } from '@lingui/react/macro';
import { plural } from '@lingui/core/macro';
import React, { useState } from 'react';
import type { CategoryDeletionImpact } from '@budgero/core/browser';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { toDecimal, type MilliUnits } from '@shared/lib/currency/milli';

interface DeleteCategoryDialogProps {
  open: boolean;
  onClose: () => void;
  categories: { categoryId: number; name: string; isGroup?: boolean; available?: MilliUnits }[];
  currentCategoryId: number;
  currentCategoryTotalTransactions?: number;
  currentCategoryAssigned?: MilliUnits;
  /** Everything the delete moves or removes, all months (read when the dialog opens). */
  impact?: CategoryDeletionImpact;
  incomeOnly?: boolean;
  onDelete: (selectedCategoryId: number) => Promise<void> | void;
  isLoading?: boolean;
  /** Formats a stored integer-milliunit amount for display. */
  formatAmount?: (value: MilliUnits) => string;
}

export const DeleteCategoryDialog: React.FC<DeleteCategoryDialogProps> = ({
  open,
  onClose,
  categories,
  currentCategoryTotalTransactions,
  currentCategoryAssigned,
  currentCategoryId,
  impact,
  incomeOnly = false,
  onDelete,
  isLoading = false,
  formatAmount = (value) => toDecimal(value).toLocaleString(),
}) => {
  const { t } = useLingui();

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const assignedTotal = impact ? formatAmount(impact.assignedTotal as MilliUnits) : '';

  const handleDelete = async () => {
    if (selectedCategoryId === null || isLoading) {
      return;
    }

    try {
      await onDelete(selectedCategoryId);
      onClose();
    } catch (error) {
      console.error('Failed to reassign and delete category', error);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isLoading) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Delete Category</Trans>
          </DialogTitle>
          <DialogDescription>
            {incomeOnly ? (
              t`Choose another income category to receive this category’s transactions and any assignments. Your income totals will stay the same.`
            ) : (
              <Trans>
                Before you can delete the category, you need to reassign all
                {(currentCategoryTotalTransactions ?? 0) > 0 && (currentCategoryAssigned ?? 0) !== 0
                  ? t` transactions and assignments`
                  : (currentCategoryTotalTransactions ?? 0) > 0
                    ? ' transactions'
                    : ' assignments'}{' '}
                to a new category.
              </Trans>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm">
            <Trans>
              Select a category to reassign transactions, assigned amounts, and any remaining
              available amounts.
            </Trans>
          </p>
          <Select
            disabled={isLoading}
            onValueChange={(value) => setSelectedCategoryId(parseInt(value, 10))}
          >
            <SelectTrigger aria-label={t`Destination category`}>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories
                .filter(
                  (category) => category.categoryId !== currentCategoryId && !category.isGroup
                )
                .sort(
                  (a, b) => (b.available ?? 0) - (a.available ?? 0) || a.name.localeCompare(b.name)
                )
                .map((category) => (
                  <SelectItem key={category.categoryId} value={String(category.categoryId)}>
                    {category.name}
                    {!incomeOnly &&
                      category.available !== undefined &&
                      ` (${formatAmount(category.available)})`}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <div className="text-sm mt-4">
            <p>
              <Trans>Here's what will be reassigned to the new category:</Trans>
            </p>
            <ul className="list-disc pl-6 space-y-1">
              {(incomeOnly || (currentCategoryTotalTransactions ?? 0) > 0) && (
                <li>
                  <Trans>
                    All transactions
                    {currentCategoryTotalTransactions !== undefined &&
                      ` (${currentCategoryTotalTransactions})`}
                    , including split lines
                  </Trans>
                </li>
              )}
              {impact
                ? impact.assignedMonths > 0 && (
                    <li>
                      {plural(impact.assignedMonths, {
                        one: `Assigned amounts in # month (total ${assignedTotal})`,
                        other: `Assigned amounts in # months (total ${assignedTotal})`,
                      })}
                    </li>
                  )
                : currentCategoryAssigned !== undefined &&
                  currentCategoryAssigned !== 0 && (
                    <li>
                      <Trans>Assigned amount ({formatAmount(currentCategoryAssigned)})</Trans>
                    </li>
                  )}
              <li>
                <Trans>Any remaining available amount</Trans>
              </li>
              <li>
                <Trans>Scheduled transactions using this category</Trans>
                {impact !== undefined && impact.scheduled > 0 && ` (${impact.scheduled})`}
              </li>
            </ul>
            {impact !== undefined && impact.goals > 0 && (
              <p className="mt-2">
                <Trans>
                  Its goal is deleted with it. Set a goal on the new category if you still need one.
                </Trans>
              </p>
            )}
            <p className="mt-2 text-muted-foreground">
              <Trans>You can undo this.</Trans>
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={selectedCategoryId === null || isLoading}
          >
            {isLoading ? t`Deleting...` : t`Delete`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
