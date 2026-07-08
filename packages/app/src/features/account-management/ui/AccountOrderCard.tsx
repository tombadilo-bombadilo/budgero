import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { ArrowUpDown, ChevronUp, ChevronDown, Wallet } from 'lucide-react';
import type { Account } from '@budgero/core/browser';
import { useReorderAccounts } from '@entities/account/api/useAccounts';
import { useActiveAccounts } from '@entities/account/api/useActiveAccounts';
import { getAccountTypeDefinition } from '@entities/account/model/accountTypes';
import { useUiStore } from '@shared/store/useUiStore';

function isOnBudget(account: Account): boolean {
  if (typeof account.OnBudget === 'boolean') return account.OnBudget;
  const def = getAccountTypeDefinition(account.Type);
  return def?.budgetType !== 'always-off';
}

interface ReorderListProps {
  title: string;
  accounts: Account[];
  onMove: (orderedIds: number[]) => void;
  busy: boolean;
}

function ReorderList({ title, accounts, onMove, busy }: ReorderListProps) {
  if (accounts.length === 0) return null;

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= accounts.length) return;
    const ids = accounts.map((a) => a.ID);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onMove(ids);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="space-y-1.5">
        {accounts.map((account, index) => {
          const def = getAccountTypeDefinition(account.Type);
          const Icon = def?.icon || Wallet;
          return (
            <li
              key={account.ID}
              className="flex items-center gap-3 rounded-lg border border-border/70 bg-background px-3 py-2"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm">{account.Name}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Move ${account.Name} up`}
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Move ${account.Name} down`}
                  disabled={busy || index === accounts.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AccountOrderCard() {
  const budgetId = useUiStore((state) => state.selectedBudget?.ID || 0);
  const { data: accounts } = useActiveAccounts(budgetId);
  const reorder = useReorderAccounts();

  const { onBudget, offBudget } = React.useMemo(
    () => ({
      onBudget: accounts.filter(isOnBudget),
      offBudget: accounts.filter((a) => !isOnBudget(a)),
    }),
    [accounts]
  );

  const handleReorder = (orderedIds: number[]) => {
    if (!budgetId) return;
    reorder.mutate({ budgetId, orderedAccountIds: orderedIds });
  };

  const hasAccounts = onBudget.length > 0 || offBudget.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowUpDown className="h-5 w-5" />
          Account order
        </CardTitle>
        <CardDescription>
          Reorder how accounts appear in the sidebar and the mobile navigation. On-budget and
          off-budget accounts are ordered separately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasAccounts ? (
          <p className="text-sm text-muted-foreground">No accounts to reorder yet.</p>
        ) : (
          <>
            <ReorderList
              title="On budget"
              accounts={onBudget}
              onMove={handleReorder}
              busy={reorder.isPending}
            />
            <ReorderList
              title="Off budget"
              accounts={offBudget}
              onMove={handleReorder}
              busy={reorder.isPending}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
