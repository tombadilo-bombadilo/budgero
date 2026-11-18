'use client';

/**
 * Transaction Split Section
 *
 * Section for handling split transactions with multiple categories.
 */

import * as React from 'react';

import { SplitEditor, type SplitLine } from '../form';
import type { SplitTransferAccount } from '../../lib/split-transfer';

interface TransactionSplitSectionProps {
  budgetId: number;
  isTransfer: boolean;
  isSplit: boolean;
  onToggleSplit: () => void;
  splitLines: SplitLine[];
  onSplitLinesChange: (lines: SplitLine[]) => void;
  remaining: number;
  parentAmount: number;
  formatter: Intl.NumberFormat;
  transferAccounts?: SplitTransferAccount[];
  parentAccount?: SplitTransferAccount;
  date?: string;
  templateLines?: boolean;
}

export const TransactionSplitSection = React.memo(function TransactionSplitSection({
  budgetId,
  isTransfer,
  isSplit,
  onToggleSplit,
  splitLines,
  onSplitLinesChange,
  remaining,
  parentAmount,
  formatter,
  transferAccounts,
  parentAccount,
  date,
  templateLines,
}: TransactionSplitSectionProps) {
  if (isTransfer) {
    return null;
  }

  return (
    <SplitEditor
      budgetId={budgetId}
      isSplit={isSplit}
      onToggleSplit={onToggleSplit}
      splitLines={splitLines}
      onSplitLinesChange={onSplitLinesChange}
      remaining={remaining}
      parentAmount={parentAmount}
      formatter={formatter}
      transferAccounts={transferAccounts}
      parentAccount={parentAccount}
      date={date}
      templateLines={templateLines}
    />
  );
});
