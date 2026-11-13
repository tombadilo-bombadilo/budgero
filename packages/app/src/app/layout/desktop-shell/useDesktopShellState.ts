import { useLingui } from '@lingui/react/macro';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useLogout } from '@entities/user/api/useAuth';
import { useCustomDashboards } from '@features/custom-dashboards/api/useCustomDashboards';
import { dashboardDisplayName } from '@widgets/dashboard/builtin/builtin-cards';
import { useReports } from '@entities/report/api/useReports';
import type { ReportKey } from '@pages/analytics/analytics-state';
import { REPORT_ORDER, reportMeta } from '@pages/analytics/report-questions';

import { useUiStore } from '@shared/store/useUiStore';
import { generateBreadcrumbs } from './desktop-shell.utils';
import type { BreadcrumbItem, NavSectionState, NavSectionHandlers } from './types';

export interface UseDesktopShellStateReturn {
  breadcrumbs: BreadcrumbItem[];

  logout: ReturnType<typeof useLogout>;
}

export function useDesktopShellState(): UseDesktopShellStateReturn {
  const { t } = useLingui();

  const location = useLocation();
  const logout = useLogout();
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const budgetId = selectedBudget?.ID ?? 0;
  const isCustomDashboardDetailRoute = /^\/reports\/dashboards\/[^/]+$/.test(location.pathname);
  const { data: dashboards = [] } = useCustomDashboards(
    isCustomDashboardDetailRoute ? budgetId : 0
  );
  const { data: reports = [] } = useReports();

  const breadcrumbs = useMemo(() => {
    const labelOverridesByHref: Record<string, string> = {};

    const dashboardMatch = location.pathname.match(/^\/reports\/dashboards\/([^/]+)$/);
    if (dashboardMatch) {
      const dashboardId = decodeURIComponent(dashboardMatch[1]);
      const dashboard = dashboards.find((item) => item.id === dashboardId);
      labelOverridesByHref[`/reports/dashboards/${dashboardId}`] = dashboard
        ? dashboardDisplayName(dashboard)
        : t`Dashboard`;
    }

    const prebuiltMatch = location.pathname.match(/^\/reports\/prebuilt\/([^/]+)$/);
    if (prebuiltMatch && REPORT_ORDER.includes(prebuiltMatch[1] as ReportKey)) {
      labelOverridesByHref[location.pathname] = reportMeta(prebuiltMatch[1] as ReportKey).label;
    }

    const questionMatch = location.pathname.match(/^\/reports\/question\/([^/]+)$/);
    if (questionMatch && questionMatch[1] !== 'new') {
      const reportId = decodeURIComponent(questionMatch[1]);
      labelOverridesByHref[location.pathname] =
        reports.find((report) => report.id === reportId)?.name ?? t`Question`;
    }

    return generateBreadcrumbs(location.pathname, { labelOverridesByHref });
  }, [location.pathname, dashboards, reports, t]);

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

  // Auto-open a section's dropdown when navigating INTO that section (not on
  // every route change within it, and never in response to a manual collapse —
  // the open flags are deliberately not dependencies here).
  const activeSection = isAccountsActive
    ? 'accounts'
    : isReportsActive
      ? 'reports'
      : isSettingsActive
        ? 'settings'
        : null;
  const previousSectionRef = useRef<typeof activeSection>(null);
  useEffect(() => {
    if (activeSection === previousSectionRef.current) return;
    previousSectionRef.current = activeSection;
    // Defer state updates to avoid synchronous cascade
    const id = requestAnimationFrame(() => {
      if (activeSection === 'accounts') setAccountsOpen(true);
      else if (activeSection === 'reports') setReportsOpen(true);
      else if (activeSection === 'settings') setSettingsOpen(true);
    });
    return () => cancelAnimationFrame(id);
  }, [activeSection]);

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
