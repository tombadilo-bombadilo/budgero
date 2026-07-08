import React from 'react';
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from '@shared/ui/sidebar';
import { cn } from '@shared/lib/utils';
import {
  LayoutDashboard,
  Wallet,
  BarChart3,
  Settings,
  ChevronDown,
  Shield,
  ClipboardList,
  Building2,
  List,
  ShieldCheck,
  CreditCard,
} from 'lucide-react';
import { Badge } from '@shared/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@shared/ui/collapsible';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useUiStore } from '@shared/store/useUiStore';
import { AddAccountDialog } from '@features/account-management/ui/AddAccountDialog';
import { useUncategorizedTransactions } from '@entities/transaction/api/useUncategorizedTransactions';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import {
  NAV_REPORTS,
  NAV_SETTINGS_ACCOUNT,
  NAV_SETTINGS_DATA,
  NAV_SETTINGS_AUTOMATION,
  NAV_SETTINGS_PREFERENCES,
  type NavRouteItem,
} from '@shared/model/nav-registry';
import { useSidebarNavState } from './useDesktopShellState';
import { AccountsList } from './AccountsList';
import { SidebarNavLink, type SidebarNavLinkProps } from './SidebarNavLink';

const toLinkProps = (item: NavRouteItem): SidebarNavLinkProps => ({
  to: item.to,
  icon: item.icon,
  label: item.label,
  match: item.exact === false ? 'startsWith' : 'exact',
});

const SETTINGS_SECTION_LABEL_CLASS =
  'text-[10px] font-medium text-muted-foreground uppercase tracking-wider';

export const SidebarNav = React.memo(function SidebarNav() {
  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const globalLocalizer = useUiStore((s) => s.globalLocalizer);
  const { data: accountsData = [] } = useAccounts(selectedBudget?.ID || 0);
  const { data: uncategorizedData } = useUncategorizedTransactions(selectedBudget?.ID || 0);

  const { state, handlers, activeStates } = useSidebarNavState();
  const { accountsOpen, reportsOpen, settingsOpen, showAllAccounts } = state;
  const { handleAccountsToggle, handleReportsToggle, handleSettingsToggle, toggleShowAllAccounts } =
    handlers;
  const { isAccountsActive, isReportsActive, isSettingsActive } = activeStates;

  return (
    <SidebarMenu className="space-y-1 min-w-0">
      {/* Dashboard */}
      <SidebarNavLink topLevel to="/dashboard" icon={LayoutDashboard} label="Dashboard" />

      <SidebarNavLink
        topLevel
        to="/budgeting"
        icon={ClipboardList}
        label="Planning"
        match="startsWith"
        testId="nav-planning"
      />

      {/* All Transactions - Top Level */}
      <SidebarNavLink topLevel to="/accounts/all" icon={List} label="All Transactions" />

      {/* Warranties */}
      <SidebarNavLink topLevel to="/warranties" icon={ShieldCheck} label="Warranties" />

      {/* Accounts Dropdown */}
      <SidebarMenuItem>
        <Collapsible open={accountsOpen} onOpenChange={handleAccountsToggle}>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              className={cn(
                'flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-colors w-full min-w-0',
                isAccountsActive && 'bg-sidebar-accent text-sidebar-accent-foreground'
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <CreditCard className="h-4 w-4 flex-shrink-0" />
                <span className="font-medium truncate">Accounts</span>
                {uncategorizedData && uncategorizedData.total > 0 && !accountsOpen && (
                  <Badge variant="destructive" className="h-5 px-1.5 text-xs">
                    {uncategorizedData.total}
                  </Badge>
                )}
              </div>
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', accountsOpen && 'rotate-180')}
              />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-0.5 mt-1">
            {/* All Accounts */}
            <SidebarNavLink
              to="/accounts"
              icon={Wallet}
              label="All Accounts"
              indentClassName="mx-2"
            />

            {/* Horizontal Separator */}
            <div className="mx-4 my-2 border-t border-border" />

            <AccountsList
              accounts={accountsData.filter((a) => !a.Archived)}
              uncategorizedData={uncategorizedData}
              showAllAccounts={showAllAccounts}
              onToggleShowAll={toggleShowAllAccounts}
              globalLocalizer={globalLocalizer}
            />

            {/* Add Account Modal */}
            <div className="mx-2 pt-2">
              <AddAccountDialog />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>

      {/* Reports Dropdown */}
      <SidebarMenuItem>
        <Collapsible open={reportsOpen} onOpenChange={handleReportsToggle}>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              className={cn(
                'flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-colors w-full min-w-0',
                isReportsActive && 'bg-sidebar-accent text-sidebar-accent-foreground'
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <BarChart3 className="h-4 w-4 flex-shrink-0" />
                <span className="font-medium truncate">Reports</span>
              </div>
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', reportsOpen && 'rotate-180')}
              />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-0.5 mt-1">
            {NAV_REPORTS.map((link) => (
              <SidebarNavLink key={link.to} {...toLinkProps(link)} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>

      {/* Settings Dropdown */}
      <SidebarMenuItem>
        <Collapsible open={settingsOpen} onOpenChange={handleSettingsToggle}>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              className={cn(
                'flex items-center gap-3 px-3 py-2 transition-colors w-full',
                isSettingsActive && 'bg-accent text-accent-foreground'
              )}
            >
              <Settings className="h-4 w-4" />
              <span className="font-medium">Settings</span>
              <ChevronDown
                className={cn(
                  'ml-auto h-4 w-4 transition-transform duration-200',
                  settingsOpen && 'rotate-180'
                )}
              />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent className="py-1">
            {/* Account & Access */}
            {!IS_SELF_HOSTABLE_BUILD && (
              <>
                <div className="ml-6 mr-2 mt-2 mb-1">
                  <span className={SETTINGS_SECTION_LABEL_CLASS}>Account</span>
                </div>
                {NAV_SETTINGS_ACCOUNT.map((link) => (
                  <SidebarNavLink key={link.to} {...toLinkProps(link)} />
                ))}
              </>
            )}
            {IS_SELF_HOSTABLE_BUILD && (
              <SidebarNavLink
                to="/settings/security"
                icon={Shield}
                label="Security & Privacy"
                indentClassName="ml-4 mr-2 mt-1"
              />
            )}

            {/* Budgets & Data */}
            <div className="ml-6 mr-2 mt-3 mb-1">
              <span className={SETTINGS_SECTION_LABEL_CLASS}>Budgets & Data</span>
            </div>
            {NAV_SETTINGS_DATA.map((link) => (
              <SidebarNavLink key={link.to} {...toLinkProps(link)} />
            ))}

            {/* Automation & Integrations */}
            <div className="ml-6 mr-2 mt-3 mb-1">
              <span className={SETTINGS_SECTION_LABEL_CLASS}>Automation</span>
            </div>
            {NAV_SETTINGS_AUTOMATION.map((link) => (
              <SidebarNavLink key={link.to} {...toLinkProps(link)} />
            ))}
            {import.meta.env.DEV && (
              <SidebarNavLink
                to="/settings/simplefin"
                icon={Building2}
                label="SimpleFIN"
                badge={{
                  label: 'Beta',
                  variant: 'outline',
                  className: 'ml-auto text-[10px] px-1 py-0 h-4 text-amber-600 border-amber-600',
                }}
              />
            )}

            {/* Preferences */}
            <div className="ml-6 mr-2 mt-3 mb-1">
              <span className={SETTINGS_SECTION_LABEL_CLASS}>Preferences</span>
            </div>
            {NAV_SETTINGS_PREFERENCES.map((link) => (
              <SidebarNavLink key={link.to} {...toLinkProps(link)} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>
    </SidebarMenu>
  );
});
