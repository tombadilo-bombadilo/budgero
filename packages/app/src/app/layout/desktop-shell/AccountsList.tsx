import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Wallet, Search } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { Badge } from '@shared/ui/badge';
import { Input } from '@shared/ui/input';
import { SidebarMenuButton } from '@shared/ui/sidebar';
import { getAccountTypeDefinition } from '@entities/account/model/accountTypes';
import { useUiStore } from '@shared/store/useUiStore';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { MAX_ACCOUNTS_PER_SECTION, ACCOUNT_SEARCH_THRESHOLD } from './constants';

interface Account {
  ID: number;
  Name: string;
  Type: string;
  /** Integer milliunits, like every stored amount. */
  Balance?: number;
  BalanceConverted?: number;
  FutureImpactOriginal?: number;
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
}

const AccountItem = React.memo(function AccountItem({
  account,
  uncategorizedCount,
  formattedBalance,
  balanceValue,
  isActive,
}: {
  account: Account;
  uncategorizedCount: number;
  formattedBalance: string;
  balanceValue: number;
  isActive: boolean;
}) {
  const accountTypeDef = getAccountTypeDefinition(account.Type);
  const AccountIcon = accountTypeDef?.icon || Wallet;

  return (
    <div className="mx-2">
      <SidebarMenuButton asChild isActive={isActive}>
        <NavLink
          to={`/accounts/${account.ID}`}
          className="flex items-center gap-2 px-3 py-2 transition-colors min-w-0"
        >
          {uncategorizedCount > 0 ? (
            <Badge variant="destructive" className="h-4 px-1 text-xs flex-shrink-0">
              {uncategorizedCount}
            </Badge>
          ) : (
            <AccountIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
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
    </div>
  );
});

const AccountSection = React.memo(function AccountSection({
  title,
  accounts,
  uncategorizedData,
  globalLocalizer,
  pathname,
}: {
  title: string;
  accounts: Account[];
  uncategorizedData: UncategorizedData | undefined;
  globalLocalizer: { format: (value: number) => string };
  pathname: string;
}) {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);

  if (accounts.length === 0) return null;

  return (
    <>
      <div className={cn('px-3 py-0.5', title === 'Off Budget' && 'mt-1')}>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </div>
      </div>
      {accounts.map((account) => {
        // Realized as-of-today balance: future-dated scheduled transactions
        // are excluded so the sidebar always reflects actual funds.
        const balanceValue =
          typeof account.BalanceConverted === 'number'
            ? account.BalanceConverted - (account.FutureImpactConverted ?? 0)
            : (account.Balance ?? 0) - (account.FutureImpactOriginal ?? 0);
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
}: AccountsListProps) {
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

  // While searching, show every match. Otherwise cap each section and offer "Show All".
  const displayOnBudget = isSearching
    ? matchedOnBudget
    : showAllAccounts
      ? matchedOnBudget
      : matchedOnBudget.slice(0, MAX_ACCOUNTS_PER_SECTION);
  const displayOffBudget = isSearching
    ? matchedOffBudget
    : showAllAccounts
      ? matchedOffBudget
      : matchedOffBudget.slice(0, MAX_ACCOUNTS_PER_SECTION);
  const hasMoreAccounts =
    !isSearching &&
    (onBudgetAccounts.length > MAX_ACCOUNTS_PER_SECTION ||
      offBudgetAccounts.length > MAX_ACCOUNTS_PER_SECTION);
  const noMatches = isSearching && matchedOnBudget.length === 0 && matchedOffBudget.length === 0;

  return (
    <>
      {showSearch && (
        <div className="mx-2 mb-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts…"
            className="h-8 pl-8 text-sm"
            aria-label="Search accounts"
          />
        </div>
      )}
      <AccountSection
        title="On Budget"
        accounts={displayOnBudget}
        uncategorizedData={uncategorizedData}
        globalLocalizer={globalLocalizer}
        pathname={location.pathname}
      />
      <AccountSection
        title="Off Budget"
        accounts={displayOffBudget}
        uncategorizedData={uncategorizedData}
        globalLocalizer={globalLocalizer}
        pathname={location.pathname}
      />
      {noMatches && (
        <div className="mx-2 px-3 py-2 text-xs text-muted-foreground">
          No accounts match “{query.trim()}”.
        </div>
      )}
      {hasMoreAccounts && (
        <div className="mx-2 pt-2">
          <button
            onClick={onToggleShowAll}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1 rounded-md hover:bg-muted"
          >
            {showAllAccounts ? 'Show Less' : `Show All (${accounts.length})`}
          </button>
        </div>
      )}
    </>
  );
});
