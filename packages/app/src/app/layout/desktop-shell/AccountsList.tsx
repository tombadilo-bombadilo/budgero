import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Pin, Search } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { Badge } from '@shared/ui/badge';
import { Input } from '@shared/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import { SidebarMenuButton } from '@shared/ui/sidebar';
import { getAccountTypeDefinition } from '@entities/account/model/accountTypes';
import { AccountGlyph } from '@entities/account/ui/AccountGlyph';
import { useUiStore } from '@shared/store/useUiStore';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { pickShortList } from '@features/account-management/model/account-short-list';
import { MAX_ACCOUNTS_PER_SECTION, ACCOUNT_SEARCH_THRESHOLD } from './constants';

interface Account {
  ID: number;
  Name: string;
  Type: string;
  Currency?: string;
  /** Integer milliunits, like every stored amount. */
  BalanceNative?: number;
  BalanceConverted?: number;
  FutureImpactNative?: number;
  FutureImpactConverted?: number;
  OnBudget?: boolean;
}

interface UncategorizedData {
  total: number;
  byAccount: Record<number, { count: number }>;
}

interface AccountsListProps {
  accounts: Account[];
  uncategorizedData: UncategorizedData | undefined;
  showAllAccounts: boolean;
  onToggleShowAll: () => void;
  globalLocalizer: { format: (value: number) => string };
  /** Accounts pinned to the collapsed list (see account-short-list.ts). */
  pinnedIds?: ReadonlySet<number>;
  /** Pins/unpins an account; omitted where pins can't be changed. */
  onTogglePinned?: (accountId: number) => void;
}

const NO_PINS: ReadonlySet<number> = new Set();

// Realized as-of-today balance: future-dated scheduled transactions are
// excluded so the sidebar always reflects actual funds.
function realizedBalance(account: Account): number {
  return typeof account.BalanceConverted === 'number'
    ? account.BalanceConverted - (account.FutureImpactConverted ?? 0)
    : (account.BalanceNative ?? 0) - (account.FutureImpactNative ?? 0);
}

function sumRealized(accounts: Account[]): number {
  return accounts.reduce((sum, account) => sum + realizedBalance(account), 0);
}

const AccountItem = React.memo(function AccountItem({
  account,
  uncategorizedCount,
  formattedBalance,
  balanceValue,
  isActive,
  pinned,
  showPin,
  onTogglePinned,
}: {
  account: Account;
  uncategorizedCount: number;
  formattedBalance: string;
  balanceValue: number;
  isActive: boolean;
  pinned: boolean;
  /** Keep the pin visible without hover (the full list is open). */
  showPin: boolean;
  onTogglePinned?: (accountId: number) => void;
}) {
  const { t } = useLingui();
  const pinVisible = Boolean(onTogglePinned) && pinned && showPin;
  const pinLabel = pinned
    ? t`Remove ${account.Name} from the short list`
    : t`Keep ${account.Name} in the short list`;
  return (
    <div className="group/account relative mx-2">
      <SidebarMenuButton asChild isActive={isActive}>
        <NavLink
          to={`/accounts/${account.ID}`}
          className={cn(
            'flex items-center gap-2 px-3 py-2 transition-colors min-w-0',
            onTogglePinned &&
              (pinVisible ? 'pr-8' : 'group-hover/account:pr-8 group-focus-within/account:pr-8')
          )}
        >
          {uncategorizedCount > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="h-4 px-1 text-xs flex-shrink-0">
                  {uncategorizedCount}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="right">
                {plural(uncategorizedCount, {
                  one: '# uncategorized transaction',
                  other: '# uncategorized transactions',
                })}
              </TooltipContent>
            </Tooltip>
          ) : (
            <AccountGlyph
              type={account.Type}
              currency={account.Currency}
              variant="chip"
              className="h-3.5 w-3.5 flex-shrink-0"
            />
          )}
          <span className="truncate flex-1 min-w-0">{account.Name}</span>
          <span
            className={cn(
              'text-[11px] font-mono text-right tabular-nums flex-shrink-0',
              balanceValue < 0 ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {formattedBalance}
          </span>
        </NavLink>
      </SidebarMenuButton>
      {onTogglePinned && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={pinLabel}
              aria-pressed={pinned}
              data-testid={`account-pin-${account.ID}`}
              onClick={() => onTogglePinned(account.ID)}
              className={cn(
                'absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md transition-opacity hover:bg-sidebar-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring outline-hidden',
                pinned ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                pinVisible ? 'opacity-100' : 'opacity-0 group-hover/account:opacity-100'
              )}
            >
              <Pin className={cn('h-3.5 w-3.5', pinned && 'fill-current')} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{pinLabel}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
});

const AccountSection = React.memo(function AccountSection({
  title,
  accounts,
  total,
  spaced = false,
  uncategorizedData,
  globalLocalizer,
  pathname,
  pinnedIds,
  showPins,
  onTogglePinned,
}: {
  title: string;
  accounts: Account[];
  /** Sum of every account in the section, including ones hidden by "Show All". */
  total: number;
  spaced?: boolean;
  uncategorizedData: UncategorizedData | undefined;
  globalLocalizer: { format: (value: number) => string };
  pathname: string;
  pinnedIds: ReadonlySet<number>;
  showPins: boolean;
  onTogglePinned?: (accountId: number) => void;
}) {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);

  if (accounts.length === 0) return null;

  return (
    <>
      <div className={cn('mx-2 flex items-baseline gap-2 px-3 py-0.5', spaced && 'mt-1')}>
        <div className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </div>
        <div
          className={cn(
            'text-[11px] font-mono font-semibold tabular-nums',
            total < 0 ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {formatMaskedMilli(globalLocalizer, total, privacyMaskNumbers)}
        </div>
      </div>
      {accounts.map((account) => {
        const balanceValue = realizedBalance(account);
        const formattedBalance = formatMaskedMilli(
          globalLocalizer,
          balanceValue,
          privacyMaskNumbers
        );
        const uncategorizedCount = uncategorizedData?.byAccount[account.ID]?.count ?? 0;

        return (
          <AccountItem
            key={account.ID}
            account={account}
            uncategorizedCount={uncategorizedCount}
            formattedBalance={formattedBalance}
            balanceValue={balanceValue}
            isActive={pathname === `/accounts/${account.ID}`}
            pinned={pinnedIds.has(account.ID)}
            showPin={showPins}
            onTogglePinned={onTogglePinned}
          />
        );
      })}
    </>
  );
});

export const AccountsList = React.memo(function AccountsList({
  accounts,
  uncategorizedData,
  showAllAccounts,
  onToggleShowAll,
  globalLocalizer,
  pinnedIds = NO_PINS,
  onTogglePinned,
}: AccountsListProps) {
  const { t } = useLingui();

  const location = useLocation();
  const [query, setQuery] = useState('');

  // Group accounts by persisted on/off budget flag, fallback to type defaults if missing
  const onBudgetAccounts = accounts.filter((account) => {
    if (typeof account.OnBudget === 'boolean') {
      return account.OnBudget;
    }
    const accountTypeDef = getAccountTypeDefinition(account.Type);
    return accountTypeDef?.budgetType !== 'always-off';
  });

  const offBudgetAccounts = accounts.filter((account) => {
    if (typeof account.OnBudget === 'boolean') {
      return !account.OnBudget;
    }
    const accountTypeDef = getAccountTypeDefinition(account.Type);
    return accountTypeDef?.budgetType === 'always-off';
  });

  const showSearch = accounts.length > ACCOUNT_SEARCH_THRESHOLD;
  const trimmed = query.trim().toLowerCase();
  const isSearching = showSearch && trimmed.length > 0;
  const matchesQuery = (account: Account) => account.Name.toLowerCase().includes(trimmed);

  const matchedOnBudget = isSearching ? onBudgetAccounts.filter(matchesQuery) : onBudgetAccounts;
  const matchedOffBudget = isSearching ? offBudgetAccounts.filter(matchesQuery) : offBudgetAccounts;

  // While searching, show every match. Otherwise collapse each section to a
  // short list with "Show All": the accounts pinned to it, or, in a section
  // with no pins, a capped pick that hides zero-balance accounts first
  // (active accounts claim the slots, zeroed ones fill what's left, and the
  // picks keep their original order).
  const truncatePreferringActive = (list: Account[]): Account[] => {
    if (list.length <= MAX_ACCOUNTS_PER_SECTION) return list;
    const active = list.filter((account) => realizedBalance(account) !== 0);
    const zeroed = list.filter((account) => realizedBalance(account) === 0);
    const picked = new Set([...active, ...zeroed].slice(0, MAX_ACCOUNTS_PER_SECTION));
    return list.filter((account) => picked.has(account));
  };
  const shortList = (list: Account[]) => pickShortList(list, pinnedIds, truncatePreferringActive);

  const shortOnBudget = shortList(onBudgetAccounts);
  const shortOffBudget = shortList(offBudgetAccounts);
  const showFullLists = isSearching || showAllAccounts;
  const displayOnBudget = showFullLists ? matchedOnBudget : shortOnBudget;
  const displayOffBudget = showFullLists ? matchedOffBudget : shortOffBudget;
  const hasMoreAccounts =
    !isSearching &&
    (shortOnBudget.length < onBudgetAccounts.length ||
      shortOffBudget.length < offBudgetAccounts.length);
  const noMatches = isSearching && matchedOnBudget.length === 0 && matchedOffBudget.length === 0;

  return (
    <>
      {showSearch && (
        <div className="mx-2 mb-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t`Search accounts…`}
            className="h-8 pl-8 text-sm"
            aria-label={t`Search accounts`}
          />
        </div>
      )}
      <AccountSection
        title={t`On Budget`}
        accounts={displayOnBudget}
        total={sumRealized(onBudgetAccounts)}
        uncategorizedData={uncategorizedData}
        globalLocalizer={globalLocalizer}
        pathname={location.pathname}
        pinnedIds={pinnedIds}
        showPins={showFullLists}
        onTogglePinned={onTogglePinned}
      />
      <AccountSection
        title={t`Off Budget`}
        accounts={displayOffBudget}
        total={sumRealized(offBudgetAccounts)}
        spaced
        uncategorizedData={uncategorizedData}
        globalLocalizer={globalLocalizer}
        pathname={location.pathname}
        pinnedIds={pinnedIds}
        showPins={showFullLists}
        onTogglePinned={onTogglePinned}
      />
      {noMatches && (
        <div className="mx-2 px-3 py-2 text-xs text-muted-foreground">
          <Trans>No accounts match “{query.trim()}”.</Trans>
        </div>
      )}
      {hasMoreAccounts && (
        <div className="mx-2 pt-2">
          <button
            onClick={onToggleShowAll}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1 rounded-md hover:bg-muted"
          >
            {showAllAccounts ? t`Show Less` : t`Show All (${accounts.length})`}
          </button>
        </div>
      )}
    </>
  );
});
