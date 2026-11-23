import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { ArrowUpDown, ChevronUp, ChevronDown, Pin } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import type { Account } from '@budgero/core/browser';
import { useReorderAccounts } from '@entities/account/api/useAccounts';
import { useActiveAccounts } from '@entities/account/api/useActiveAccounts';
import { AccountGlyph } from '@entities/account/ui/AccountGlyph';
import { getAccountTypeDefinition } from '@entities/account/model/accountTypes';
import { useUiStore } from '@shared/store/useUiStore';
import { useAccountShortList } from '../model/useAccountShortList';

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
  pinnedIds: ReadonlySet<number>;
  onTogglePinned?: (accountId: number) => void;
}

function ReorderList({
  title,
  accounts,
  onMove,
  busy,
  pinnedIds,
  onTogglePinned,
}: ReorderListProps) {
  const { t } = useLingui();

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
          // (icon resolution moved into AccountGlyph)
          return (
            <li
              key={account.ID}
              className="flex items-center gap-3 rounded-lg border border-border/70 bg-background px-3 py-2"
            >
              <AccountGlyph
                type={account.Type}
                currency={account.Currency}
                variant="chip"
                className="h-5 w-5 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-sm">{account.Name}</span>
              <div className="flex items-center gap-1">
                {onTogglePinned && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-7 w-7',
                      pinnedIds.has(account.ID) ? 'text-foreground' : 'text-muted-foreground'
                    )}
                    aria-label={
                      pinnedIds.has(account.ID)
                        ? t`Remove ${account.Name} from the short list`
                        : t`Keep ${account.Name} in the short list`
                    }
                    aria-pressed={pinnedIds.has(account.ID)}
                    onClick={() => onTogglePinned(account.ID)}
                  >
                    <Pin className={cn('h-4 w-4', pinnedIds.has(account.ID) && 'fill-current')} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={t`Move ${account.Name} up`}
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={t`Move ${account.Name} down`}
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
  const { t } = useLingui();

  const budgetId = useUiStore((state) => state.selectedBudget?.ID || 0);
  const { data: accounts } = useActiveAccounts(budgetId);
  const reorder = useReorderAccounts();
  const shortList = useAccountShortList();
  const onTogglePinned = shortList.canEdit ? shortList.togglePinned : undefined;

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
          <Trans>
            <ArrowUpDown className="h-5 w-5" />
            Account order
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Reorder how accounts appear in the sidebar and the mobile navigation. On-budget and
            off-budget accounts are ordered separately.
          </Trans>{' '}
          <Trans>
            Pin accounts to choose which ones a collapsed list shows (Show Less); a list with no
            pinned accounts picks them automatically.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasAccounts ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No accounts to reorder yet.</Trans>
          </p>
        ) : (
          <>
            <ReorderList
              title={t`On budget`}
              accounts={onBudget}
              onMove={handleReorder}
              busy={reorder.isPending}
              pinnedIds={shortList.pinnedIds}
              onTogglePinned={onTogglePinned}
            />
            <ReorderList
              title={t`Off budget`}
              accounts={offBudget}
              onMove={handleReorder}
              busy={reorder.isPending}
              pinnedIds={shortList.pinnedIds}
              onTogglePinned={onTogglePinned}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
