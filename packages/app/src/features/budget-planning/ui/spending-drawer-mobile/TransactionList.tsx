import { memo, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { ChevronLeft, ChevronRight, ArrowUpRight, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { SwipeRow } from '@shared/ui/SwipeRow';
import { formatMilli, sumMilli, type MilliUnits } from '@shared/lib/currency/milli';
import { groupTransactionsByDateKey } from '@shared/lib/date-utils';
import { getTransactionSignedAmount } from './spending-drawer.utils';
import type { TransactionListProps, Transaction } from './types';

function getTransactionKey(transaction: Transaction, index: number): string {
  const primaryId = transaction.ID ?? transaction.id;
  if (primaryId !== undefined && primaryId !== null) return String(primaryId);
  return `${transaction.Date}-${transaction.Account}-${transaction.Memo}-${index}`;
}

export const TransactionList = memo(function TransactionList({
  transactions,
  loading,
  page,
  rowsPerPage,
  collapsedDates,
  globalLocalizer,
  onPageChange,
  onToggleDateCollapse,
  onTransactionClick,
  onRecategorize,
  onDelete,
}: TransactionListProps) {
  const totalPages = Math.ceil(transactions.length / rowsPerPage);

  const paginatedTransactions = useMemo(() => {
    return transactions.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  }, [transactions, page, rowsPerPage]);

  // Group paginated transactions by date, newest first (timezone-agnostic)
  const groupedTransactions = useMemo(() => {
    return groupTransactionsByDateKey(paginatedTransactions, (tx) => tx.Date);
  }, [paginatedTransactions]);

  if (loading) {
    return <div className="text-center py-8">Loading transactions...</div>;
  }

  return (
    <div className="max-w-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Transactions</h3>
        <div className="text-xs text-muted-foreground">{transactions.length} total</div>
      </div>

      {transactions.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No transactions found for this category.
        </div>
      ) : (
        <div className="max-w-full">
          <div className="space-y-4 max-w-full">
            {groupedTransactions.map(({ key: dateKey, transactions: dateTransactions }) => {
              const isCollapsed = collapsedDates.has(dateKey);
              const totalAmount = sumMilli(dateTransactions.map(getTransactionSignedAmount));

              return (
                <DateCard
                  key={dateKey}
                  dateKey={dateKey}
                  isCollapsed={isCollapsed}
                  dateTransactions={dateTransactions}
                  totalAmount={totalAmount}
                  globalLocalizer={globalLocalizer}
                  onToggleCollapse={() => onToggleDateCollapse(dateKey)}
                  onTransactionClick={onTransactionClick}
                  onRecategorize={onRecategorize}
                  onDelete={onDelete}
                />
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
          )}
        </div>
      )}
    </div>
  );
});

interface DateCardProps {
  dateKey: string;
  isCollapsed: boolean;
  dateTransactions: Transaction[];
  totalAmount: MilliUnits;
  globalLocalizer: { format: (value: number) => string };
  onToggleCollapse: () => void;
  onTransactionClick: (transaction: Transaction) => void;
  onRecategorize: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}

const DateCard = memo(function DateCard({
  dateKey,
  isCollapsed,
  dateTransactions,
  totalAmount,
  globalLocalizer,
  onToggleCollapse,
  onTransactionClick,
  onRecategorize,
  onDelete,
}: DateCardProps) {
  return (
    <Card className="max-w-full">
      <CardContent className="p-3 max-w-full">
        {/* Date Header with collapse toggle */}
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-between hover:bg-muted/20 rounded-md p-1 -m-1 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking whitespace-nowrap">
              {format(parseISO(dateKey), 'EEE, MMM d')}
            </div>
            {isCollapsed && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                <span className="flex-shrink-0">-</span>
                <span className="truncate">
                  {dateTransactions.length} transaction
                  {dateTransactions.length !== 1 ? 's' : ''}
                </span>
                <span className="flex-shrink-0">-</span>
                <span className="font-mono font-medium whitespace-nowrap">
                  {formatMilli(globalLocalizer, totalAmount)}
                </span>
              </div>
            )}
          </div>
          {isCollapsed ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-3 w-3 text-muted-foreground" />
          )}
        </button>

        {/* Transactions for this date - only show when not collapsed */}
        {!isCollapsed && (
          <div className="space-y-1 mt-2 max-w-full">
            {dateTransactions.map((transaction, index) => (
              <TransactionRow
                key={getTransactionKey(transaction, index)}
                transaction={transaction}
                globalLocalizer={globalLocalizer}
                onClick={() => onTransactionClick(transaction)}
                onRecategorize={() => onRecategorize(transaction)}
                onDelete={() => onDelete(transaction)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
});

interface TransactionRowProps {
  transaction: Transaction;
  globalLocalizer: { format: (value: number) => string };
  onClick: () => void;
  onRecategorize: () => void;
  onDelete: () => void;
}

const TransactionRow = memo(function TransactionRow({
  transaction,
  globalLocalizer,
  onClick,
  onRecategorize,
  onDelete,
}: TransactionRowProps) {
  const signedAmount = getTransactionSignedAmount(transaction);

  return (
    <SwipeRow
      onClick={onClick}
      onLeftAction={onRecategorize}
      onRightAction={onDelete}
      ignoreVerticalSwipes
    >
      <div className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors group max-w-full overflow-hidden">
        <div className="flex-1 min-w-0 pr-2">
          <div className="block max-w-[10rem] sm:max-w-[14rem] md:max-w-[18rem] lg:max-w-[22rem] text-[11px] leading-tight text-current truncate">
            {transaction.Memo || 'No memo'}
          </div>
          <div className="text-xs text-muted-foreground truncate">{transaction.Account}</div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <div
            className={cn(
              'text-sm font-mono font-medium text-right whitespace-nowrap',
              signedAmount > 0 && 'text-green-600 dark:text-green-400',
              signedAmount < 0 && 'text-red-600 dark:text-red-300'
            )}
          >
            {formatMilli(globalLocalizer, signedAmount)}
          </div>
          <ArrowUpRight className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </div>
    </SwipeRow>
  );
});

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const Pagination = memo(function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  const visiblePages = useMemo(() => {
    return Array.from({ length: totalPages })
      .map((_, i) => i)
      .slice(Math.max(0, page - 2), Math.min(totalPages, page + 3));
  }, [totalPages, page]);

  return (
    <div className="flex justify-between items-center mt-4 px-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.max(0, page - 1))}
        disabled={page === 0}
        className="flex items-center gap-1"
      >
        <ChevronLeft className="h-3 w-3" />
        Previous
      </Button>

      <div className="flex items-center gap-1">
        {visiblePages.map((i) => (
          <button
            key={i}
            onClick={() => onPageChange(i)}
            className={cn(
              'w-8 h-8 rounded text-xs transition-colors',
              i === page
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
        className="flex items-center gap-1"
      >
        Next
        <ChevronRight className="h-3 w-3" />
      </Button>
    </div>
  );
});
