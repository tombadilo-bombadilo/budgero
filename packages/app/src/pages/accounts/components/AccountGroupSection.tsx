/**
 * Account Group Section Component
 *
 * Collapsible section displaying a group of accounts with trends and sparklines.
 */

import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@shared/ui/collapsible';
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { trendTextClass } from '@shared/lib/amount-color';
import { getAccountTypeDefinition } from '@entities/account/model/accountTypes';
import { AccountSparkline } from './AccountSparkline';

interface Account {
  ID: number;
  Name?: string;
  Type?: string;
  Balance?: number;
  BalanceConverted?: number;
  Metadata?: string | Record<string, unknown>;
}

interface GroupTrend {
  change: number;
  percentage: number;
}

interface AccountGroupSectionProps {
  title: string;
  accounts: Account[];
  isOpen: boolean;
  onToggle: () => void;
  trend: GroupTrend;
  periodLabel: string;
  periodMonths: number;
  chartColor: string;
  isLiability?: boolean;
  formatCurrency: (value: number) => string;
}

function getAccountTypeStyle(acc: {
  Type?: string;
  Name?: string;
  Metadata?: string | Record<string, unknown>;
}) {
  const accountTypeDef = getAccountTypeDefinition(acc.Type || '');

  if (accountTypeDef) {
    return {
      bgColor: accountTypeDef.color,
      Icon: accountTypeDef.icon,
    };
  }

  // Investment types (for legacy support)
  const type = (acc?.Type || '').toLowerCase();
  const name = (acc?.Name || '').toLowerCase();

  if (
    ['investment', '401k', 'ira', 'brokerage'].includes(type) ||
    /invest|401k|ira|brokerage/.test(name)
  ) {
    return { bgColor: 'hsl(270, 50%, 50%)', Icon: TrendingUp };
  }

  return { bgColor: 'hsl(210, 10%, 50%)', Icon: Wallet };
}

export function AccountGroupSection({
  title,
  accounts,
  isOpen,
  onToggle,
  trend,
  periodLabel,
  periodMonths,
  chartColor,
  isLiability = false,
  formatCurrency,
}: AccountGroupSectionProps) {
  if (accounts.length === 0) return null;

  const total = accounts.reduce((sum, acc) => sum + (acc.BalanceConverted ?? acc.Balance ?? 0), 0);

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  <span className="font-semibold text-sm sm:text-base">{title}</span>
                </div>
                <div className="hidden sm:flex items-center gap-2 text-sm">
                  {trend.change >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  )}
                  <div className="flex flex-col leading-tight">
                    <span className={cn('font-medium', trendTextClass(trend.change))}>
                      {trend.percentage >= 0 ? '+' : ''}
                      {trend.percentage.toFixed(1)}%
                    </span>
                    <span className="text-muted-foreground text-xs">{periodLabel} change</span>
                  </div>
                </div>
              </div>
              <div className="text-sm sm:text-xl font-bold tabular-nums shrink-0">
                {formatCurrency(isLiability ? Math.abs(total) : total)}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-1 sm:space-y-3">
            {accounts.map((account) => {
              const { bgColor, Icon } = getAccountTypeStyle(account);
              const balance = account.BalanceConverted ?? account.Balance ?? 0;

              return (
                <Link key={account.ID} to={`/accounts/${account.ID}`}>
                  <div className="flex items-center justify-between p-1.5 sm:p-3 rounded-lg hover:bg-muted/50 transition-colors group gap-2">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <div
                        className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor: `${bgColor}20`,
                          color: bgColor,
                        }}
                      >
                        <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-xs sm:text-base truncate">
                          {account.Name}
                        </div>
                        <div className="text-[10px] sm:text-sm text-muted-foreground capitalize">
                          {account.Type}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                      <div className="hidden sm:block">
                        <AccountSparkline
                          accountId={account.ID}
                          strokeColor={chartColor}
                          accountName={account.Name || ''}
                          periodMonths={periodMonths}
                        />
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-xs sm:text-base tabular-nums">
                          {formatCurrency(isLiability ? Math.abs(balance) : balance)}
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
