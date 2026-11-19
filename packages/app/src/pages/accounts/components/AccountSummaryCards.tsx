import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { Card, CardContent } from '@shared/ui/card';
import { ArrowUpRight, ArrowDownRight, CheckCircle2 } from 'lucide-react';
import { PayoffSimulator } from '@features/debt/ui/PayoffSimulator';
import { formatSafeMilli } from '@shared/lib/currency/milli';
import type { LiabilityInfo, TransactionStats } from '../account-page.utils';
import { FlowStat } from './FlowStat';

export interface AccountSummaryCardsProps {
  displayBalanceToday: number;
  /** Balance of cleared and reconciled transactions */
  displayClearedBalance: number;
  transactionStats: TransactionStats;
  displayLiabilityInfo: LiabilityInfo | null;
  balanceAccountToday: number;
  formatter: Intl.NumberFormat;
  /** Rate-driven value-change stat (foreign-currency accounts only). */
  valueChangeSlot?: React.ReactNode;
}

export const AccountSummaryCards = React.memo(function AccountSummaryCards({
  displayBalanceToday,
  displayClearedBalance,
  transactionStats,
  displayLiabilityInfo,
  balanceAccountToday,
  formatter,
  valueChangeSlot,
}: AccountSummaryCardsProps) {
  const { t } = useLingui();

  return (
    <div className="space-y-3 mb-4">
      <div className="flex items-center gap-6 flex-wrap">
        <div>
          <span className="text-xs text-muted-foreground">
            <Trans>Balance</Trans>
          </span>
          <p className="text-base font-bold tabular-nums text-foreground">
            {formatSafeMilli(formatter, displayBalanceToday)}
          </p>
        </div>

        <div>
          <span className="text-xs text-muted-foreground">
            <Trans>Cleared</Trans>
          </span>
          <p className="text-base font-medium tabular-nums text-muted-foreground">
            {formatSafeMilli(formatter, displayClearedBalance)}
          </p>
        </div>

        <div className="w-px h-8 bg-border" />

        <FlowStat
          icon={ArrowUpRight}
          label={t`Inflow`}
          value={formatSafeMilli(formatter, transactionStats.totalInflow)}
          color="success"
          tooltip={t`Total inflow from recent ${transactionStats.recentCount} transactions`}
        />

        <FlowStat
          icon={ArrowDownRight}
          label={t`Outflow`}
          value={formatSafeMilli(formatter, transactionStats.totalOutflow)}
          color="destructive"
          tooltip={t`Total outflow from recent ${transactionStats.recentCount} transactions`}
        />

        {valueChangeSlot && (
          <>
            <div className="w-px h-8 bg-border" />
            {valueChangeSlot}
          </>
        )}
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
                  <div className="font-medium text-success">
                    <Trans>Paid off - congratulations!</Trans>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    <Trans>
                      This liability now has a positive balance. There's nothing to pay off right
                      now.
                    </Trans>
                  </div>
                </div>
              </div>
            ) : (
              <PayoffSimulator
                outstanding={displayLiabilityInfo.outstanding}
                apr={displayLiabilityInfo.apr}
                aprSchedule={displayLiabilityInfo.aprSchedule}
                nextAprChange={displayLiabilityInfo.nextAprChange}
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
