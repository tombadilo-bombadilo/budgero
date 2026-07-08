import React from 'react';
import { Button } from '@shared/ui/button';

interface TransactionTableFooterProps {
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
}

export const TransactionTableFooter = React.memo(function TransactionTableFooter({
  currentPage,
  totalPages,
  hasNextPage,
  hasPreviousPage,
  onNextPage,
  onPreviousPage,
}: TransactionTableFooterProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between">
      <Button
        variant="outline"
        size="sm"
        onClick={onPreviousPage}
        disabled={!hasPreviousPage}
        className="flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Previous
      </Button>

      <div className="text-sm text-muted-foreground">
        Page {currentPage + 1} of {totalPages}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onNextPage}
        disabled={!hasNextPage}
        className="flex items-center gap-2"
      >
        Next
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Button>
    </div>
  );
});
