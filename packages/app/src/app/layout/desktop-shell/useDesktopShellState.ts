import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useLogout } from '@entities/user/api/useAuth';
import { useCustomDashboards } from '@features/custom-dashboards/api/useCustomDashboards';

import { useUiStore } from '@shared/store/useUiStore';
import { generateBreadcrumbs } from './desktop-shell.utils';
import type { BreadcrumbItem, NavSectionState, NavSectionHandlers } from './types';

export interface UseDesktopShellStateReturn {
  breadcrumbs: BreadcrumbItem[];

  logout: ReturnType<typeof useLogout>;
}

export function useDesktopShellState(): UseDesktopShellStateReturn {
  const location = useLocation();
  const logout = useLogout();
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const budgetId = selectedBudget?.ID ?? 0;
  const isCustomDashboardDetailRoute = /^\/reports\/dashboards\/[^/]+$/.test(location.pathname);
  const { data: dashboards = [] } = useCustomDashboards(
    isCustomDashboardDetailRoute ? budgetId : 0
  );

  const breadcrumbs = useMemo(() => {
    const dashboardMatch = location.pathname.match(/^\/reports\/dashboards\/([^/]+)$/);
    if (!dashboardMatch) {
      return generateBreadcrumbs(location.pathname);
    }

    const dashboardId = decodeURIComponent(dashboardMatch[1]);
    const dashboardName =
      dashboards.find((dashboard) => dashboard.id === dashboardId)?.name ?? 'Dashboard';
    const dashboardPath = `/reports/dashboards/${dashboardId}`;

    return generateBreadcrumbs(location.pathname, {
      labelOverridesByHref: {
        [dashboardPath]: dashboardName,
      },
    });
  }, [location.pathname, dashboards]);

  return {
    breadcrumbs,
    logout,
  };
}

export interface UseSidebarNavStateReturn {
  state: NavSectionState;
  handlers: NavSectionHandlers;
  activeStates: {
    isAccountsActive: boolean;
    isReportsActive: boolean;
    isSettingsActive: boolean;
  };
}

export function useSidebarNavState(): UseSidebarNavStateReturn {
  const location = useLocation();

  const [accountsOpen, setAccountsOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showAllAccounts, setShowAllAccounts] = useState(false);

  const handleAccountsToggle = useCallback((open: boolean) => {
    setAccountsOpen(open);
  }, []);

  const handleReportsToggle = useCallback((open: boolean) => {
    setReportsOpen(open);
  }, []);

  const handleSettingsToggle = useCallback((open: boolean) => {
    setSettingsOpen(open);
  }, []);

  const toggleShowAllAccounts = useCallback(() => {
    setShowAllAccounts((prev) => !prev);
  }, []);

  const isAccountsActive = location.pathname.startsWith('/accounts');
  const isReportsActive = location.pathname.startsWith('/reports');
  const isSettingsActive = location.pathname.startsWith('/settings');

  // Auto-open dropdowns when navigating to their sections
  useEffect(() => {
    // Defer state updates to avoid synchronous cascade
    const id = requestAnimationFrame(() => {
      if (isAccountsActive && !accountsOpen) {
        setAccountsOpen(true);
      } else if (isReportsActive && !reportsOpen) {
        setReportsOpen(true);
      } else if (isSettingsActive && !settingsOpen) {
        setSettingsOpen(true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [
    location.pathname,
    isAccountsActive,
    isReportsActive,
    isSettingsActive,
    accountsOpen,
    reportsOpen,
    settingsOpen,
  ]);

  return {
    state: {
      accountsOpen,
      reportsOpen,
      settingsOpen,
      showAllAccounts,
    },
    handlers: {
      handleAccountsToggle,
      handleReportsToggle,
      handleSettingsToggle,
      toggleShowAllAccounts,
    },
    activeStates: {
      isAccountsActive,
      isReportsActive,
      isSettingsActive,
    },
  };
}
