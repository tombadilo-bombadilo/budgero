import { Trans, useLingui } from '@lingui/react/macro';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import type { TransactionTableColumns } from '@features/transactions/lib/table-columns';

interface TransactionColumnsMenuProps {
  columns: TransactionTableColumns;
  onChange: (patch: Partial<TransactionTableColumns>) => void;
  /** Label column (on by default). */
  showLabelColumn: boolean;
  onToggleLabelColumn: () => void;
  /** Running balance column (off by default). */
  showBalanceColumn: boolean;
  onToggleBalanceColumn: () => void;
}

/**
 * Desktop register "Columns" menu: show or hide Payee, Memo, Label and the
 * running Balance, and wrap long memos. Stays open between choices so several can be changed in one go.
 */
export function TransactionColumnsMenu({
  columns,
  onChange,
  showLabelColumn,
  onToggleLabelColumn,
  showBalanceColumn,
  onToggleBalanceColumn,
}: TransactionColumnsMenuProps) {
  const { t } = useLingui();
  const keepOpen = (event: Event) => event.preventDefault();
  const changed =
    !columns.showMemo ||
    !columns.showPayee ||
    columns.wrapMemo ||
    !showLabelColumn ||
    showBalanceColumn;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={changed ? 'default' : 'outline'}
          size="sm"
          className="flex items-center gap-1.5 text-xs"
          title={t`Choose columns and memo wrapping`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <Trans>Columns</Trans>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          <Trans>Show columns</Trans>
        </DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={columns.showPayee}
          onCheckedChange={(checked) => onChange({ showPayee: checked === true })}
          onSelect={keepOpen}
        >
          <Trans>Payee</Trans>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={columns.showMemo}
          onCheckedChange={(checked) => onChange({ showMemo: checked === true })}
          onSelect={keepOpen}
        >
          <Trans>Memo</Trans>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={showLabelColumn}
          onCheckedChange={onToggleLabelColumn}
          onSelect={keepOpen}
        >
          <Trans>Label</Trans>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={showBalanceColumn}
          onCheckedChange={onToggleBalanceColumn}
          onSelect={keepOpen}
        >
          <Trans>Balance</Trans>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={columns.wrapMemo}
          disabled={!columns.showMemo}
          onCheckedChange={(checked) => onChange({ wrapMemo: checked === true })}
          onSelect={keepOpen}
        >
          <Trans>Wrap long memos</Trans>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
