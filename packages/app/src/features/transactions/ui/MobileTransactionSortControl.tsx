import { Trans, useLingui } from '@lingui/react/macro';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import {
  isTransactionSortColumn,
  type TransactionSortColumn,
  type TransactionSortState,
} from '@features/transactions/lib/transaction-sort';

const DEFAULT_VALUE = 'default';

interface MobileTransactionSortControlProps {
  sort: TransactionSortState;
  onSortChange: (sort: TransactionSortState) => void;
  /** The register lists several accounts (All Transactions). */
  showAccountOption: boolean;
}

/** "Sort by" select plus a direction toggle, for the mobile register (no column headers there). */
export function MobileTransactionSortControl({
  sort,
  onSortChange,
  showAccountOption,
}: MobileTransactionSortControlProps) {
  const { t } = useLingui();
  const options: { value: TransactionSortColumn; label: string }[] = [
    { value: 'date', label: t`Date` },
    { value: 'amount', label: t`Amount` },
    { value: 'payee', label: t`Payee` },
    { value: 'category', label: t`Category` },
    { value: 'memo', label: t`Memo` },
    ...(showAccountOption ? [{ value: 'account' as const, label: t`Account` }] : []),
    { value: 'label', label: t`Label` },
    { value: 'status', label: t`Status` },
  ];

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">
        <Trans>Sort by:</Trans>
      </span>
      <Select
        value={sort?.column ?? DEFAULT_VALUE}
        onValueChange={(value) =>
          onSortChange(
            isTransactionSortColumn(value)
              ? { column: value, direction: sort?.direction ?? 'asc' }
              : null
          )
        }
      >
        <SelectTrigger size="sm" className="h-8 w-[120px] text-xs" aria-label={t`Sort by`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_VALUE} className="text-xs">
            <Trans>Default (date)</Trans>
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {sort && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() =>
            onSortChange({
              column: sort.column,
              direction: sort.direction === 'asc' ? 'desc' : 'asc',
            })
          }
          aria-label={sort.direction === 'asc' ? t`Ascending` : t`Descending`}
          title={
            sort.direction === 'asc'
              ? t`Ascending. Tap for descending.`
              : t`Descending. Tap for ascending.`
          }
        >
          {sort.direction === 'asc' ? (
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      )}
    </div>
  );
}
