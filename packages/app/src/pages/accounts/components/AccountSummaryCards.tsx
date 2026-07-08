import React from 'react';
import { Card, CardContent } from '@shared/ui/card';
import { ArrowUpRight, ArrowDownRight, CheckCircle2 } from 'lucide-react';
import { PayoffSimulator } from '@features/debt/ui/PayoffSimulator';
import { asMilli, formatMilli } from '@shared/lib/currency/milli';
import type { LiabilityInfo, TransactionStats } from '../account-page.utils';
import { FlowStat } from './FlowStat';

export interface AccountSummaryCardsProps {
  displayBalanceToday: number;
  transactionStats: TransactionStats;
  displayLiabilityInfo: LiabilityInfo | null;
  balanceAccountToday: number;
  formatter: Intl.NumberFormat;
}

export const AccountSummaryCards = React.memo(function AccountSummaryCards({
  displayBalanceToday,
  transactionStats,
  displayLiabilityInfo,
  balanceAccountToday,
  formatter,
}: AccountSummaryCardsProps) {
  return (
    <div className="space-y-3 mb-4">
      <div className="flex items-center gap-6 flex-wrap">
        <div>
          <span className="text-xs text-muted-foreground">Balance</span>
          <p className="text-base font-bold tabular-nums text-foreground">
            {formatMilli(formatter, asMilli(displayBalanceToday))}
          </p>
        </div>

        <div className="w-px h-8 bg-border" />

        <FlowStat
          icon={ArrowUpRight}
          label="Inflow"
          value={formatMilli(formatter, asMilli(transactionStats.totalInflow))}
          color="success"
          tooltip={`Total inflow from recent ${transactionStats.recentCount} transactions`}
        />

        <FlowStat
          icon={ArrowDownRight}
          label="Outflow"
          value={formatMilli(formatter, asMilli(transactionStats.totalOutflow))}
          color="destructive"
          tooltip={`Total outflow from recent ${transactionStats.recentCount} transactions`}
        />
      </div>

      {displayLiabilityInfo && (
        <Card>
          <CardContent className="p-4">
            {balanceAccountToday > 0 ? (
              <div className="flex items-start gap-2">
                <div className="mt-0.5 text-success">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-medium text-success">Paid off - congratulations!</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    This liability now has a positive balance. There's nothing to pay off right now.
                  </div>
                </div>
              </div>
            ) : (
              <PayoffSimulator
                outstanding={displayLiabilityInfo.outstanding}
                apr={displayLiabilityInfo.apr}
                minPayment={displayLiabilityInfo.minPayment}
                formatter={formatter}
                initial={displayLiabilityInfo.minPayment}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
});
