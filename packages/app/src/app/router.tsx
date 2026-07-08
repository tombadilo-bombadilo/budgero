import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AdminAuthGuard from '@/app/AdminAuthGuard';
import StartupController from '@/app/startup/StartupController';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { useUiStore } from '@shared/store/useUiStore';
import { GlobalImportDropHandler } from '@features/import/ui/GlobalImportDropHandler';
import DashboardLayout from '@/app/layout/DashboardLayout';
import AdminLayout from '@/app/layout/AdminLayout';
import AccountPage from '@pages/accounts/AccountPage';
import AccountsPage from '@pages/accounts/AccountsPage';
import AllTransactionsPage from '@pages/accounts/AllTransactionsPage';
import PrebuiltReportsPage from '@pages/prebuilt-reports/PrebuiltReportsPage';
import ExplorerPage from '@pages/explorer-page/ExplorerPage';
import CustomDashboardsPage from '@pages/custom-dashboards/CustomDashboardsPage';
import AppearancePage from '@pages/settings/AppearancePage';
import AccountSettingsPage from '@pages/settings/AccountSettingsPage';
import { SubscriptionPage } from '@pages/settings/subscription';
import SecurityPage from '@pages/settings/SecurityPage';
import WorkspaceSettingsPage from '@pages/settings/WorkspaceSettingsPage';
import DataManagementPage from '@pages/settings/DataManagementPage';
import BudgetSettingsPage from '@pages/settings/BudgetSettingsPage';
import CurrencySettingsPage from '@pages/settings/CurrencySettingsPage';
import ImportsPage from '@pages/settings/ImportsPage';
import PayeesPage from '@pages/settings/PayeesPage';
import LabelsPage from '@pages/settings/LabelsPage';
import AutomationRulesPage from '@pages/settings/AutomationRulesPage';
import RecurringTransactionsPage from '@pages/settings/RecurringTransactionsPage';
import AboutPage from '@pages/settings/AboutPage';
import PushApiPage from '@pages/settings/push-api';
import AuditLogPage from '@pages/settings/AuditLogPage';
import AISettingsPage from '@pages/settings/ai';
import SimpleFINPage from '@pages/settings/simplefin';
import { DashboardPage } from '@pages/dashboard/DashboardPage';
import { BudgetingPage } from '@pages/budgeting/BudgetingPage';
import SubscriptionSuccess from '@features/subscription/ui/SubscriptionSuccess';
import JoinWorkspacePage from '@pages/JoinWorkspacePage';
import AuthPage from '@pages/auth/AuthPage';
import AdminDashboard from '@pages/admin/AdminDashboard';
import { AdminUsers } from '@pages/admin/admin-users';
import AdminSqlExplorer from '@pages/admin/sql-explorer';
import WarrantiesPage from '@pages/warranties/WarrantiesPage';
import RewardsPage from '@pages/rewards/RewardsPage';
import { hideStartupPreload } from '@/app/startup/preload';
import { trackPageView } from '@shared/lib/analytics/analytics';

function PreloadRouteBridge() {
  const location = useLocation();

  React.useEffect(() => {
    if (
      location.pathname.startsWith('/auth') ||
      location.pathname.startsWith('/invite/') ||
      location.pathname.startsWith('/admin')
    ) {
      hideStartupPreload();
    }
  }, [location.pathname]);

  return null;
}

function PageviewTracker() {
  const location = useLocation();

  React.useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  return null;
}

function AppRouter() {
  const homePage = useUiStore((state) => state.homePage);
  const homePath =
    homePage === 'planning'
      ? '/budgeting'
      : homePage === 'accounts'
        ? '/accounts'
        : homePage === 'analytics'
          ? '/reports/prebuilt'
          : '/dashboard';
  return (
    <BrowserRouter>
      <PreloadRouteBridge />
      <PageviewTracker />
      <GlobalImportDropHandler />
      <Routes>
        {/* Public auth route wrapping Clerk SignIn/SignUp per docs (must include wildcard for substeps like /auth/factor-one) */}
        <Route path="/auth/*" element={<AuthPage />} />

        <Route element={<StartupController />}>
          {/* Workspace-invite landing page. The secret lives in the URL
              fragment so it never reaches our server even when this URL
              is loaded. Sits inside StartupController so the runtime is
              initialized before useRedeemSpaceInvite runs. */}
          <Route path="/join" element={<JoinWorkspacePage />} />
          <Route path="/subscription/success" element={<SubscriptionSuccess />} />
          <Route path="/" element={<DashboardLayout />}>
            <Route index element={<Navigate to={homePath} replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/budgeting" element={<BudgetingPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/all" element={<AllTransactionsPage />} />
            <Route path="/accounts/:accountId" element={<AccountPage />} />
            <Route path="/warranties" element={<WarrantiesPage />} />
            <Route path="/reports/prebuilt" element={<PrebuiltReportsPage />} />
            <Route path="/reports/explorer" element={<ExplorerPage />} />
            <Route path="/reports/dashboards" element={<CustomDashboardsPage />} />
            <Route path="/reports/dashboards/:dashboardId" element={<CustomDashboardsPage />} />
            <Route path="/settings" element={<Navigate to="/settings/appearance" replace />} />
            <Route path="/automations" element={<Navigate to="/settings/recurring" replace />} />
            <Route path="/settings/appearance" element={<AppearancePage />} />
            {!IS_SELF_HOSTABLE_BUILD && (
              <Route path="/settings/account" element={<AccountSettingsPage />} />
            )}
            {!IS_SELF_HOSTABLE_BUILD && (
              <Route path="/settings/subscription" element={<SubscriptionPage />} />
            )}
            {!IS_SELF_HOSTABLE_BUILD && <Route path="/rewards" element={<RewardsPage />} />}
            <Route path="/settings/workspaces" element={<WorkspaceSettingsPage />} />
            <Route path="/settings/api" element={<PushApiPage />} />
            <Route path="/settings/security" element={<SecurityPage />} />
            <Route path="/settings/imports" element={<ImportsPage />} />
            <Route path="/settings/data" element={<DataManagementPage />} />
            <Route path="/settings/budget" element={<BudgetSettingsPage />} />
            <Route path="/settings/currencies" element={<CurrencySettingsPage />} />
            <Route path="/settings/payees" element={<PayeesPage />} />
            <Route path="/settings/labels" element={<LabelsPage />} />
            <Route path="/settings/rules" element={<AutomationRulesPage />} />
            <Route path="/settings/recurring" element={<RecurringTransactionsPage />} />
            <Route path="/settings/audit-log" element={<AuditLogPage />} />
            <Route path="/settings/ai" element={<AISettingsPage />} />
            {import.meta.env.DEV && (
              <Route path="/settings/simplefin" element={<SimpleFINPage />} />
            )}
            <Route path="/settings/about" element={<AboutPage />} />
          </Route>
        </Route>

        {/* Admin routes */}
        <Route element={<AdminAuthGuard />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="database" element={<AdminSqlExplorer />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default AppRouter;
