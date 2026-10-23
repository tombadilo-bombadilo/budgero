import { Trans, useLingui } from '@lingui/react/macro';
import { useLocation, Link } from 'react-router-dom';
import { cn } from '@shared/lib/utils';
import {
  CreditCard,
  Plus,
  ChartPie,
  Settings2,
  Home,
  Shield,
  ClipboardList,
  LogOut,
  Wallet,
  ChevronDown,
  List,
  ShieldCheck,
  Search,
} from 'lucide-react';
import { Dialog, DialogTrigger, DialogContent } from '@shared/ui/dialog';
import { AddTransactionForm } from '@features/transactions/ui/add-transaction';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useUiStore } from '@shared/store/useUiStore';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';
import {
  getLastUsedTransactionStorageKey,
  readLastUsedAccountId,
} from '@features/transactions/lib/last-used-storage';
import { useAddTransactionHandler } from '@features/transactions/api/useAddTransactionHandler';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { AddAccountDialog } from '@features/account-management/ui/AddAccountDialog';
import { Badge } from '@shared/ui/badge';
import { useUncategorizedTransactions } from '@entities/transaction/api/useUncategorizedTransactions';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@shared/ui/collapsible';
import { useLogout } from '@entities/user/api/useAuth';
import { AccountGlyph } from '@entities/account/ui/AccountGlyph';
import { getAccountTypeDefinition } from '@entities/account/model/accountTypes';
import {
  NAV_REPORTS,
  NAV_SETTINGS_ACCOUNT,
  NAV_SETTINGS_DATA,
  NAV_SETTINGS_AUTOMATION,
  NAV_SETTINGS_PREFERENCES,
} from '@shared/model/nav-registry';

export function MobileBottomNav() {
  const { t } = useLingui();

  const location = useLocation();
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const spaceId = useActiveSpaceId();
  const lastUsedStorageKey = getLastUsedTransactionStorageKey(spaceId, selectedBudget?.ID);
  const { data: accountsData = [] } = useAccounts(selectedBudget?.ID || 0);
  const { data: uncategorizedData } = useUncategorizedTransactions(selectedBudget?.ID || 0);
  const [addTransactionOpen, setAddTransactionOpen] = useState(false);
  const { handleAddTransaction, handleAddTransfer } = useAddTransactionHandler({
    onDialogClose: () => setAddTransactionOpen(false),
    entry: 'mobile_dialog',
  });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const [openSettingsSections, setOpenSettingsSections] = useState<Record<string, boolean>>({
    account: true,
    budgets: false,
    automation: false,
    preferences: false,
  });
  const [isStandaloneMode, setIsStandaloneMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const iosStandalone =
      ((window.navigator as Navigator & { standalone?: boolean }).standalone ?? false) === true;
    return window.matchMedia('(display-mode: standalone)').matches || iosStandalone;
  });

  const safeAreaInsetBottom = isStandaloneMode
    ? t`max(calc(env(safe-area-inset-bottom, 0px) - 12px), 0px)`
    : t`env(safe-area-inset-bottom, 0px)`;

  const toggleSettingsSection = (section: string) => {
    setOpenSettingsSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const [rememberedAccount, setRememberedAccount] = useState(() => ({
    storageKey: lastUsedStorageKey,
    accountId: readLastUsedAccountId(lastUsedStorageKey),
  }));
  const lastUsedAccountId =
    rememberedAccount.storageKey === lastUsedStorageKey ? rememberedAccount.accountId : undefined;

  const logout = useLogout();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(display-mode: standalone)');

    const updateDisplayMode = () => {
      const iosStandalone =
        ((window.navigator as Navigator & { standalone?: boolean }).standalone ?? false) === true;
      setIsStandaloneMode(mediaQuery.matches || iosStandalone);
    };

    updateDisplayMode();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateDisplayMode);
      return () => mediaQuery.removeEventListener('change', updateDisplayMode);
    }

    mediaQuery.addListener(updateDisplayMode);
    return () => mediaQuery.removeListener(updateDisplayMode);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;

    const updateNavHeight = () => {
      const navHeight = navRef.current?.getBoundingClientRect().height;
      if (!navHeight) return;
      root.style.setProperty('--mobile-bottom-nav-height', `${Math.ceil(navHeight)}px`);
    };

    updateNavHeight();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateNavHeight()) : null;

    if (resizeObserver && navRef.current) {
      resizeObserver.observe(navRef.current);
    }

    window.addEventListener('resize', updateNavHeight);
    window.addEventListener('orientationchange', updateNavHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateNavHeight);
      window.removeEventListener('orientationchange', updateNavHeight);
      root.style.removeProperty('--mobile-bottom-nav-height');
    };
  }, [isStandaloneMode]);

  // Close any open dropdown after navigation to avoid render-time setState loops.
  useEffect(() => {
    // eslint-disable-next-line react-compiler/react-compiler
    setOpenDropdown(null);
  }, [location.pathname]);

  // Refresh when the dialog opens or its owning space/budget changes.
  useEffect(() => {
    // eslint-disable-next-line react-compiler/react-compiler
    setRememberedAccount({
      storageKey: lastUsedStorageKey,
      accountId: readLastUsedAccountId(lastUsedStorageKey),
    });
  }, [addTransactionOpen, lastUsedStorageKey]);

  // Ensure we have arrays even if data is null/undefined; hide archived accounts from nav.
  const safeAccountsData = (accountsData || []).filter((a) => !a.Archived);

  const onBudgetAccounts = safeAccountsData.filter((account) => {
    if (typeof account.OnBudget === 'boolean') {
      return account.OnBudget;
    }
    const accountTypeDef = getAccountTypeDefinition(account.Type);
    return accountTypeDef?.budgetType !== 'always-off';
  });

  const offBudgetAccounts = safeAccountsData.filter((account) => {
    if (typeof account.OnBudget === 'boolean') {
      return !account.OnBudget;
    }
    const accountTypeDef = getAccountTypeDefinition(account.Type);
    return accountTypeDef?.budgetType === 'always-off';
  });

  // The mobile accounts dropdown is a quick-jump, not a browser: cap each section
  // and point to the searchable All Accounts page when there are more than fit.
  const MOBILE_ACCOUNTS_PER_SECTION = 4;
  const displayedOnBudget = onBudgetAccounts.slice(0, MOBILE_ACCOUNTS_PER_SECTION);
  const displayedOffBudget = offBudgetAccounts.slice(0, MOBILE_ACCOUNTS_PER_SECTION);
  const accountsTruncated =
    onBudgetAccounts.length > MOBILE_ACCOUNTS_PER_SECTION ||
    offBudgetAccounts.length > MOBILE_ACCOUNTS_PER_SECTION;
  const totalAccountsCount = onBudgetAccounts.length + offBudgetAccounts.length;

  const defaultAccountId =
    (lastUsedAccountId && safeAccountsData.some((account) => account.ID === lastUsedAccountId)
      ? lastUsedAccountId
      : undefined) ?? safeAccountsData[0]?.ID;

  const dashboardPath = '/dashboard';
  const accountsPath = '/accounts';
  const budgetingPath = '/budgeting';
  const reportsPath = '/reports';
  const settingsPath = '/settings';

  const navItems = [
    {
      id: 'budgeting',
      title: t`Budgeting`,
      icon: ClipboardList,
      path: dashboardPath,
      isActive: location.pathname === dashboardPath || location.pathname.startsWith(budgetingPath),
      options: [
        {
          title: t`Dashboard`,
          path: dashboardPath,
          icon: Home,
        },
        {
          title: t`Planning`,
          path: budgetingPath,
          icon: ClipboardList,
        },
      ],
    },
    {
      id: 'accounts',
      title: t`Accounts`,
      icon: CreditCard,
      path: accountsPath,
      isActive: location.pathname.startsWith(accountsPath),
      hasDropdown: true,
    },
    {
      id: 'add',
      title: t`Add`,
      icon: Plus,
      path: '#',
      isAction: true,
    },
    {
      id: 'reports',
      title: t`Reports`,
      icon: ChartPie,
      path: reportsPath,
      isActive: location.pathname.startsWith(reportsPath),
      hasDropdown: true,
    },
    {
      id: 'settings',
      title: t`Settings`,
      icon: Settings2,
      path: settingsPath,
      isActive:
        location.pathname.startsWith(settingsPath) || location.pathname.startsWith('/automations'),
      hasDropdown: true,
    },
  ];

  const triggerContainerClassName =
    'group relative flex min-w-0 flex-1 flex-col items-center gap-0 px-0.5';

  const getTriggerButtonClassName = (isActive: boolean) =>
    cn(
      'p-2 transition-all duration-200 active:scale-95 relative',
      isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
    );

  const getTriggerLabelClassName = (isActive: boolean) =>
    cn(
      'max-w-full truncate text-center text-xs font-medium transition-colors',
      isActive ? 'text-foreground' : 'text-muted-foreground'
    );

  const renderTrigger = (
    item: (typeof navItems)[number],
    opts?: { testId?: string; badge?: ReactNode }
  ) => (
    <DropdownMenuTrigger asChild>
      <div
        className={triggerContainerClassName}
        data-testid={opts?.testId ? `mobile-nav-trigger-${opts.testId}` : undefined}
      >
        {item.isActive ? (
          <span aria-hidden="true" className="absolute -top-1 h-1 w-8 rounded-full bg-primary" />
        ) : null}
        <button
          className={getTriggerButtonClassName(Boolean(item.isActive))}
          data-testid={opts?.testId ? `mobile-nav-${opts.testId}-button` : undefined}
        >
          <item.icon className="h-6 w-6" />
          {opts?.badge}
        </button>
        <span className={getTriggerLabelClassName(Boolean(item.isActive))}>{item.title}</span>
      </div>
    </DropdownMenuTrigger>
  );

  const renderAccountItem = (account: (typeof displayedOnBudget)[number]) => {
    // (icon resolution moved into AccountGlyph)
    const uncategorizedCount = uncategorizedData?.byAccount[account.ID]?.count || 0;
    return (
      <DropdownMenuItem key={account.ID} asChild onSelect={() => setOpenDropdown(null)}>
        <Link
          to={`${accountsPath}/${account.ID}`}
          className="flex items-center justify-between gap-2 w-full"
        >
          <span className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted">
              <AccountGlyph
                type={account.Type}
                currency={account.Currency}
                variant="chip"
                className="h-3.5 w-3.5"
              />
            </span>
            <span className="truncate">{account.Name}</span>
          </span>
          {uncategorizedCount > 0 && (
            <Badge variant="destructive" className="h-4 px-1 text-[10px]">
              {uncategorizedCount}
            </Badge>
          )}
        </Link>
      </DropdownMenuItem>
    );
  };

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 bg-background"
        style={{ height: safeAreaInsetBottom }}
      />
      <nav
        ref={navRef}
        className="pointer-events-auto relative flex items-center justify-between w-full bg-background border-t border-border shadow-[0_-8px_24px_rgba(15,15,16,0.2)] px-4 py-2 sm:px-8 md:px-10"
        style={{ paddingBottom: `calc(${safeAreaInsetBottom} + 0.125rem)` }}
      >
        {navItems.map((item) => {
          if (item.isAction) {
            return (
              <Dialog key={item.id} open={addTransactionOpen} onOpenChange={setAddTransactionOpen}>
                <DialogTrigger asChild>
                  <div
                    className="flex min-w-0 flex-1 flex-col items-center gap-0 px-0.5"
                    data-testid="mobile-add-transaction-button"
                  >
                    <button
                      aria-label={item.title}
                      className="p-2 transition-all duration-200 active:scale-95"
                    >
                      <item.icon className="h-6 w-6 text-foreground" />
                    </button>
                    <span className="max-w-full truncate text-center text-xs text-muted-foreground font-medium">
                      {item.title}
                    </span>
                  </div>
                </DialogTrigger>
                <DialogContent onInteractOutside={(e) => e.preventDefault()}>
                  <AddTransactionForm
                    onAddTransaction={handleAddTransaction}
                    onAddTransfer={handleAddTransfer}
                    onCancel={() => setAddTransactionOpen(false)}
                    budgetId={selectedBudget?.ID || 0}
                    selectedAccountId={defaultAccountId}
                  />
                </DialogContent>
              </Dialog>
            );
          }

          if (item.options) {
            return (
              <DropdownMenu
                key={item.id}
                open={openDropdown === item.id}
                onOpenChange={(open) => setOpenDropdown(open ? item.id : null)}
              >
                {renderTrigger(item, { testId: item.id })}
                <DropdownMenuContent align="center" className="w-[200px] mb-4">
                  {item.options.map((option) => (
                    <DropdownMenuItem
                      key={option.path}
                      asChild
                      onSelect={() => setOpenDropdown(null)}
                    >
                      <Link
                        to={option.path}
                        className="flex items-center gap-2"
                        data-testid={`mobile-nav-${option.title.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        <option.icon className="h-4 w-4" />
                        {option.title}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          }

          if (item.hasDropdown) {
            if (item.id === 'settings') {
              return (
                <DropdownMenu
                  key={item.id}
                  open={openDropdown === item.id}
                  onOpenChange={(open) => setOpenDropdown(open ? item.id : null)}
                >
                  {renderTrigger(item)}
                  <DropdownMenuContent align="center" className="w-[220px] mb-4">
                    {/* Account & Access */}
                    {!IS_SELF_HOSTABLE_BUILD && (
                      <Collapsible
                        open={openSettingsSections.account}
                        onOpenChange={() => toggleSettingsSection('account')}
                      >
                        <CollapsibleTrigger asChild>
                          <button className="flex w-full items-center justify-between px-2 py-1.5 text-sm font-medium hover:bg-accent rounded-sm">
                            <Trans>
                              Account
                              <ChevronDown
                                className={cn(
                                  'h-4 w-4 transition-transform',
                                  openSettingsSections.account && 'rotate-180'
                                )}
                              />
                            </Trans>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-0.5">
                          {NAV_SETTINGS_ACCOUNT.map((link) => (
                            <DropdownMenuItem
                              key={link.to}
                              asChild
                              onSelect={() => setOpenDropdown(null)}
                            >
                              <Link to={link.to} className="flex items-center gap-2">
                                <link.icon className="h-4 w-4" />
                                {t(link.label)}
                              </Link>
                            </DropdownMenuItem>
                          ))}
                        </CollapsibleContent>
                        <DropdownMenuSeparator className="my-1" />
                      </Collapsible>
                    )}
                    {IS_SELF_HOSTABLE_BUILD && (
                      <DropdownMenuItem asChild onSelect={() => setOpenDropdown(null)}>
                        <Link to="/settings/security" className="flex items-center gap-2">
                          <Trans>
                            <Shield className="h-4 w-4" />
                            Security & Privacy
                          </Trans>
                        </Link>
                      </DropdownMenuItem>
                    )}

                    {/* Budgets & Data */}
                    <Collapsible
                      open={openSettingsSections.budgets}
                      onOpenChange={() => toggleSettingsSection('budgets')}
                    >
                      <CollapsibleTrigger asChild>
                        <button className="flex w-full items-center justify-between px-2 py-1.5 text-sm font-medium hover:bg-accent rounded-sm">
                          <Trans>
                            Budgets & Data
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 transition-transform',
                                openSettingsSections.budgets && 'rotate-180'
                              )}
                            />
                          </Trans>
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-0.5">
                        {NAV_SETTINGS_DATA.map((link) => (
                          <DropdownMenuItem
                            key={link.to}
                            asChild
                            onSelect={() => setOpenDropdown(null)}
                          >
                            <Link to={link.to} className="flex items-center gap-2">
                              <link.icon className="h-4 w-4" />
                              {t(link.label)}
                            </Link>
                          </DropdownMenuItem>
                        ))}
                      </CollapsibleContent>
                      <DropdownMenuSeparator className="my-1" />
                    </Collapsible>

                    {/* Automation & Integrations */}
                    <Collapsible
                      open={openSettingsSections.automation}
                      onOpenChange={() => toggleSettingsSection('automation')}
                    >
                      <CollapsibleTrigger asChild>
                        <button className="flex w-full items-center justify-between px-2 py-1.5 text-sm font-medium hover:bg-accent rounded-sm">
                          <Trans>
                            Automation
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 transition-transform',
                                openSettingsSections.automation && 'rotate-180'
                              )}
                            />
                          </Trans>
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-0.5">
                        {NAV_SETTINGS_AUTOMATION.map((link) => (
                          <DropdownMenuItem
                            key={link.to}
                            asChild
                            onSelect={() => setOpenDropdown(null)}
                          >
                            <Link to={link.to} className="flex items-center gap-2">
                              <link.icon className="h-4 w-4" />
                              {t(link.label)}
                            </Link>
                          </DropdownMenuItem>
                        ))}
                      </CollapsibleContent>
                      <DropdownMenuSeparator className="my-1" />
                    </Collapsible>

                    {/* Preferences & Info */}
                    <Collapsible
                      open={openSettingsSections.preferences}
                      onOpenChange={() => toggleSettingsSection('preferences')}
                    >
                      <CollapsibleTrigger asChild>
                        <button className="flex w-full items-center justify-between px-2 py-1.5 text-sm font-medium hover:bg-accent rounded-sm">
                          <Trans>
                            Preferences
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 transition-transform',
                                openSettingsSections.preferences && 'rotate-180'
                              )}
                            />
                          </Trans>
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-0.5">
                        {NAV_SETTINGS_PREFERENCES.map((link) => (
                          <DropdownMenuItem
                            key={link.to}
                            asChild
                            onSelect={() => setOpenDropdown(null)}
                          >
                            <Link to={link.to} className="flex items-center gap-2">
                              <link.icon className="h-4 w-4" />
                              {t(link.label)}
                            </Link>
                          </DropdownMenuItem>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>

                    <>
                      <DropdownMenuSeparator className="my-1" />
                      <DropdownMenuItem
                        disabled={logout.isPending}
                        onSelect={(event) => {
                          event.preventDefault();
                          setOpenDropdown(null);
                          if (!logout.isPending) {
                            logout.mutate();
                          }
                        }}
                        className="flex items-center gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
                      >
                        <LogOut className="h-4 w-4" />
                        {logout.isPending ? t`Signing out...` : t`Sign out`}
                      </DropdownMenuItem>
                    </>
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }

            if (item.id === 'reports') {
              return (
                <DropdownMenu
                  key={item.id}
                  open={openDropdown === item.id}
                  onOpenChange={(open) => setOpenDropdown(open ? item.id : null)}
                >
                  {renderTrigger(item)}
                  <DropdownMenuContent align="center" className="w-[200px] mb-4">
                    {NAV_REPORTS.map((link) => (
                      <DropdownMenuItem
                        key={link.to}
                        asChild
                        onSelect={() => setOpenDropdown(null)}
                      >
                        <Link to={link.to} className="flex items-center gap-2">
                          <link.icon className="h-4 w-4" />
                          {t(link.label)}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }

            return (
              <DropdownMenu
                key={item.id}
                open={openDropdown === item.id}
                onOpenChange={(open) => setOpenDropdown(open ? item.id : null)}
              >
                {renderTrigger(item, {
                  testId: 'accounts',
                  badge: uncategorizedData && uncategorizedData.total > 0 && (
                    <Badge
                      variant="destructive"
                      className="absolute -top-1 -right-1 h-4 min-w-[1rem] px-1 text-[10px] font-semibold"
                    >
                      {uncategorizedData.total}
                    </Badge>
                  ),
                })}
                <DropdownMenuContent align="center" className="w-[200px] mb-4">
                  <DropdownMenuItem asChild onSelect={() => setOpenDropdown(null)}>
                    <Link
                      to={accountsPath}
                      className="flex items-center gap-2 font-medium"
                      data-testid="mobile-nav-all-accounts"
                    >
                      <Trans>
                        <Wallet className="h-4 w-4" />
                        All Accounts
                      </Trans>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild onSelect={() => setOpenDropdown(null)}>
                    <Link
                      to="/accounts/all"
                      className="flex items-center gap-2"
                      data-testid="mobile-nav-all-transactions"
                    >
                      <Trans>
                        <List className="h-4 w-4" />
                        All Transactions
                      </Trans>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild onSelect={() => setOpenDropdown(null)}>
                    <Link to="/warranties" className="flex items-center gap-2">
                      <Trans>
                        <ShieldCheck className="h-4 w-4" />
                        Warranties
                      </Trans>
                    </Link>
                  </DropdownMenuItem>
                  {(onBudgetAccounts.length > 0 || offBudgetAccounts.length > 0) && (
                    <DropdownMenuSeparator />
                  )}
                  {onBudgetAccounts.length > 0 && (
                    <>
                      <DropdownMenuLabel>
                        <Trans>On Budget</Trans>
                      </DropdownMenuLabel>
                      {displayedOnBudget.map(renderAccountItem)}
                    </>
                  )}
                  {onBudgetAccounts.length > 0 && offBudgetAccounts.length > 0 && (
                    <DropdownMenuSeparator />
                  )}
                  {offBudgetAccounts.length > 0 && (
                    <>
                      <DropdownMenuLabel>
                        <Trans>Off Budget</Trans>
                      </DropdownMenuLabel>
                      {displayedOffBudget.map(renderAccountItem)}
                    </>
                  )}
                  {accountsTruncated && (
                    <DropdownMenuItem asChild onSelect={() => setOpenDropdown(null)}>
                      <Link
                        to={accountsPath}
                        className="flex items-center gap-2 font-medium text-muted-foreground"
                        data-testid="mobile-nav-search-accounts"
                      >
                        <Trans>
                          <Search className="h-4 w-4" />
                          Search all {totalAccountsCount} accounts
                        </Trans>
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {(onBudgetAccounts.length > 0 || offBudgetAccounts.length > 0) && (
                    <DropdownMenuSeparator />
                  )}
                  <AddAccountDialog />
                </DropdownMenuContent>
              </DropdownMenu>
            );
          }

          return (
            <Link key={item.id} to={item.path} className="flex flex-col items-center gap-0">
              <div
                className={cn(
                  'p-2 transition-all duration-200 active:scale-95',
                  item.isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <item.icon className="h-6 w-6" />
              </div>
              <span
                className={cn(
                  'text-xs font-medium',
                  item.isActive ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {item.title}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
