import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AdminAuthGuard from '@/app/AdminAuthGuard';
import StartupController from '@/app/startup/StartupController';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { useUiStore } from '@shared/store/useUiStore';
import { GlobalImportDropHandler } from '@features/import/ui/GlobalImportDropHandler';
import DashboardLayout from '@/app/layout/DashboardLayout';
import { hideStartupPreload } from '@/app/startup/preload';
import { trackPageView } from '@shared/lib/analytics/analytics';
import { addBreadcrumb } from '@shared/lib/analytics/error-capture';
import { trackFeatureRoute } from '@shared/lib/analytics/feature-usage';
import { noteStartupPrompt } from '@shared/lib/analytics/startup-timing';
import { CenteredLoader } from '@shared/ui/CenteredLoader';
import { lazyPage } from '@/app/lazy-page';

// Every page is its own chunk: the first screen loads the app shell plus that
// one page, and the page for the current URL starts loading during startup
// (preloadFirstScreen). The service worker precaches every chunk for offline.
const AdminLayout = lazyPage(() => import('@/app/layout/AdminLayout'));
const AccountPage = lazyPage(() => import('@pages/accounts/AccountPage'));
const AccountsPage = lazyPage(() => import('@pages/accounts/AccountsPage'));
const AllTransactionsPage = lazyPage(() => import('@pages/accounts/AllTransactionsPage'));
const PrebuiltReportPage = lazyPage(() => import('@pages/analytics/PrebuiltReportPage'));
const ReportsHomePage = lazyPage(() => import('@pages/reports/ReportsHomePage'));
const QuestionPage = lazyPage(() => import('@pages/reports/question/QuestionPage'));
const LegacyExplorerRedirect = lazyPage(() => import('@pages/reports/LegacyExplorerRedirect'));
const CustomDashboardsPage = lazyPage(
  () => import('@pages/custom-dashboards/CustomDashboardsPage')
);
const AppearancePage = lazyPage(() => import('@pages/settings/AppearancePage'));
const AccountSettingsPage = lazyPage(() => import('@pages/settings/AccountSettingsPage'));
const SubscriptionPage = lazyPage(() =>
  import('@pages/settings/subscription').then((m) => ({ default: m.SubscriptionPage }))
);
const SecurityPage = lazyPage(() => import('@pages/settings/SecurityPage'));
const WorkspaceSettingsPage = lazyPage(() => import('@pages/settings/WorkspaceSettingsPage'));
const DataManagementPage = lazyPage(() => import('@pages/settings/DataManagementPage'));
const BudgetSettingsPage = lazyPage(() => import('@pages/settings/BudgetSettingsPage'));
const CurrencySettingsPage = lazyPage(() => import('@pages/settings/CurrencySettingsPage'));
const ImportsPage = lazyPage(() => import('@pages/settings/ImportsPage'));
const PayeesPage = lazyPage(() => import('@pages/settings/PayeesPage'));
const LabelsPage = lazyPage(() => import('@pages/settings/LabelsPage'));
const AutomationRulesPage = lazyPage(() => import('@pages/settings/AutomationRulesPage'));
const RecurringTransactionsPage = lazyPage(
  () => import('@pages/settings/RecurringTransactionsPage')
);
const AboutPage = lazyPage(() => import('@pages/settings/AboutPage'));
const PushApiPage = lazyPage(() => import('@pages/settings/push-api'));
const AuditLogPage = lazyPage(() => import('@pages/settings/AuditLogPage'));
const AISettingsPage = lazyPage(() => import('@pages/settings/ai'));
const BankSyncPage = lazyPage(() => import('@pages/settings/bank-sync'));
const BankSyncCallbackPage = lazyPage(
  () => import('@pages/settings/bank-sync/BankSyncCallbackPage')
);
const SyncStatusPage = lazyPage(() => import('@pages/settings/SyncStatusPage'));
const SnapshotHistoryPage = lazyPage(() => import('@pages/settings/SnapshotHistoryPage'));
const DashboardPage = lazyPage(() =>
  import('@pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const BudgetingPage = lazyPage(() =>
  import('@pages/budgeting/BudgetingPage').then((m) => ({ default: m.BudgetingPage }))
);
const SubscriptionSuccess = lazyPage(() => import('@features/subscription/ui/SubscriptionSuccess'));
const JoinWorkspacePage = lazyPage(() => import('@pages/JoinWorkspacePage'));
const StartOwnBudgetPage = lazyPage(() => import('@pages/StartOwnBudgetPage'));
const AuthPage = lazyPage(() => import('@pages/auth/AuthPage'));
const AdminDashboard = lazyPage(() => import('@pages/admin/AdminDashboard'));
const AdminUsers = lazyPage(() =>
  import('@pages/admin/admin-users').then((m) => ({ default: m.AdminUsers }))
);
const AdminSqlExplorer = lazyPage(() => import('@pages/admin/sql-explorer'));
const WarrantiesPage = lazyPage(() => import('@pages/warranties/WarrantiesPage'));

/** The page chunk for a path the app may open on, for preloading. */
function firstScreenPage(pathname: string) {
  if (pathname.startsWith('/dashboard')) return DashboardPage;
  if (pathname.startsWith('/budgeting')) return BudgetingPage;
  if (pathname === '/accounts') return AccountsPage;
  if (pathname === '/accounts/all') return AllTransactionsPage;
  if (pathname.startsWith('/accounts/')) return AccountPage;
  if (pathname === '/reports') return ReportsHomePage;
  if (pathname.startsWith('/auth')) return AuthPage;
  return null;
}

/**
 * Fetch the first screen's chunk while startup (runtime, database) is still
 * running, instead of after it: React.lazy alone would only start loading
 * when the page renders.
 */
function preloadFirstScreen(pathname: string, homePath: string): void {
  void firstScreenPage(pathname === '/' ? homePath : pathname)?.preload();
}

/** <Routes> under a Suspense boundary for the lazy pages outside DashboardLayout. */
function SuspenseRoutes({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<CenteredLoader className="min-h-screen" />}>
      <Routes>{children}</Routes>
    </React.Suspense>
  );
}

function PreloadRouteBridge() {
  const location = useLocation();

  React.useEffect(() => {
    if (
      location.pathname.startsWith('/auth') ||
      location.pathname.startsWith('/invite/') ||
      location.pathname.startsWith('/admin')
    ) {
      hideStartupPreload();
      // Sign-in, invite and admin screens: the time until the budget is
      // usable would include the person's own steps.
      noteStartupPrompt();
    }
  }, [location.pathname]);

  return null;
}

function PageviewTracker() {
  const location = useLocation();

  React.useEffect(() => {
    addBreadcrumb('route', location.pathname);
    trackPageView(location.pathname);
    trackFeatureRoute(location.pathname);
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
          ? '/reports'
          : '/dashboard';
  const preloadedRef = React.useRef(false);
  React.useEffect(() => {
    if (preloadedRef.current) return;
    preloadedRef.current = true;
    preloadFirstScreen(window.location.pathname, homePath);
  }, [homePath]);
  return (
    <BrowserRouter>
      <PreloadRouteBridge />
      <PageviewTracker />
      <GlobalImportDropHandler />
      <SuspenseRoutes>
        {/* Public auth route wrapping Clerk SignIn/SignUp per docs (must include wildcard for substeps like /auth/factor-one) */}
        <Route path="/auth/*" element={<AuthPage />} />

        <Route element={<StartupController />}>
          {/* Workspace-invite landing page. The secret lives in the URL
              fragment so it never reaches our server even when this URL
              is loaded. Sits inside StartupController so the runtime is
              initialized before useRedeemSpaceInvite runs. */}
          <Route path="/join" element={<JoinWorkspacePage />} />
          <Route path="/start-own-budget" element={<StartOwnBudgetPage />} />
          <Route path="/subscription/success" element={<SubscriptionSuccess />} />
          <Route path="/" element={<DashboardLayout />}>
            <Route index element={<Navigate to={homePath} replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/budgeting" element={<BudgetingPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/all" element={<AllTransactionsPage />} />
            <Route path="/accounts/:accountId" element={<AccountPage />} />
            <Route path="/warranties" element={<WarrantiesPage />} />
            <Route path="/reports" element={<ReportsHomePage />} />
            <Route path="/reports/prebuilt" element={<Navigate to="/reports" replace />} />
            <Route path="/reports/prebuilt/:reportKey" element={<PrebuiltReportPage />} />
            <Route path="/reports/question" element={<Navigate to="/reports" replace />} />
            <Route path="/reports/question/new" element={<QuestionPage />} />
            <Route path="/reports/question/:reportId" element={<QuestionPage />} />
            <Route path="/reports/explorer" element={<LegacyExplorerRedirect />} />
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
            <Route path="/settings/workspaces" element={<WorkspaceSettingsPage />} />
            <Route path="/settings/api" element={<PushApiPage />} />
            <Route path="/settings/security" element={<SecurityPage />} />
            <Route path="/settings/imports" element={<ImportsPage />} />
            <Route path="/settings/data" element={<DataManagementPage />} />
            <Route path="/settings/sync" element={<SyncStatusPage />} />
            <Route path="/settings/sync/history" element={<SnapshotHistoryPage />} />
            <Route path="/settings/budget" element={<BudgetSettingsPage />} />
            <Route path="/settings/currencies" element={<CurrencySettingsPage />} />
            <Route path="/settings/payees" element={<PayeesPage />} />
            <Route path="/settings/labels" element={<LabelsPage />} />
            <Route path="/settings/rules" element={<AutomationRulesPage />} />
            <Route path="/settings/recurring" element={<RecurringTransactionsPage />} />
            <Route path="/settings/audit-log" element={<AuditLogPage />} />
            <Route path="/settings/ai" element={<AISettingsPage />} />
            <Route path="/settings/bank-sync" element={<BankSyncPage />} />
            <Route path="/bank-sync/callback" element={<BankSyncCallbackPage />} />
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
      </SuspenseRoutes>
    </BrowserRouter>
  );
}

export default AppRouter;
