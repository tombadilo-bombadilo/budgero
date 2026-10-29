import { Trans, useLingui } from '@lingui/react/macro';
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import {
  Users,
  CreditCard,
  TrendingUp,
  Gift,
  Activity,
  DollarSign,
  UserCheck,
  UserX,
  RefreshCw,
  MailQuestion,
  Send,
} from 'lucide-react';
import { useAdminApi } from '@features/admin/api/useAdminApi';
import { formatRelativeToNow as formatDistanceToNow } from '@shared/lib/date-format';
import { cn } from '@shared/lib/utils';
import { toast } from 'sonner';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { StatCard } from '@pages/admin/components/StatCard';
import SelfHostAdminDashboard from '@pages/admin/SelfHostAdminDashboard';
import StickinessAnalyticsSection from '@pages/admin/StickinessAnalyticsSection';
import SelfHostInstallsSection from '@pages/admin/SelfHostInstallsSection';
import type {
  AdminStats,
  ClerkSyncResult,
  FeedbackBroadcastResult,
  FeedbackBroadcastStatus,
} from '@features/admin/model/admin-dashboard';

export default function AdminDashboard() {
  const { t } = useLingui();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingClerk, setSyncingClerk] = useState(false);
  const [clerkSyncResult, setClerkSyncResult] = useState<ClerkSyncResult | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackBroadcastStatus | null>(null);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<FeedbackBroadcastResult | null>(null);
  const adminApi = useAdminApi();

  const loadStats = useCallback(async () => {
    try {
      setRefreshing(true);
      const data = await adminApi.getStats();
      setStats(data);
    } catch (error) {
      console.error('Failed to load admin stats:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [adminApi]);

  const handleSyncClerkUsers = useCallback(async () => {
    try {
      setSyncingClerk(true);
      const result: ClerkSyncResult = await adminApi.syncClerkUsers();
      setClerkSyncResult(result);
      toast.success(t`Clerk sync complete`, {
        description: t`Synced ${result.Synced ?? 0} users (${result.Created ?? 0} created, ${
          result.Migrated ?? 0
        } migrated, ${result.Updated ?? 0} updated).`,
      });
    } catch (error) {
      console.error('Failed to sync Clerk users:', error);
      toast.error(t`Clerk sync failed`, {
        description: t`Unable to sync Clerk users. Check server logs for details.`,
      });
    } finally {
      setSyncingClerk(false);
    }
  }, [adminApi, t]);

  const loadFeedbackStatus = useCallback(async () => {
    try {
      const status = await adminApi.getFeedbackBroadcastStatus();
      setFeedbackStatus(status);
    } catch (error) {
      console.error('Failed to load feedback broadcast status:', error);
    }
  }, [adminApi]);

  const handleSendFeedbackBroadcast = useCallback(async () => {
    if (!feedbackStatus) return;
    const confirmed = window.confirm(
      `Send the ${feedbackStatus.quarter} feedback email to ${feedbackStatus.eligible} active users?${
        feedbackStatus.dryRun ? ' (dry run — nothing actually sends)' : ''
      }`
    );
    if (!confirmed) return;
    try {
      setSendingFeedback(true);
      const result = await adminApi.sendFeedbackBroadcast();
      setFeedbackResult(result);
      toast.success(t`Feedback broadcast complete`, {
        description: t`Sent ${result.sent ?? 0} of ${result.eligible ?? 0}, failed ${
          result.failed ?? 0
        }${result.dryRun ? ' (dry run)' : ''}.`,
      });
      void loadFeedbackStatus();
    } catch (error) {
      console.error('Failed to send feedback broadcast:', error);
      toast.error(t`Feedback broadcast failed`, {
        description: t`Check server logs. Re-sending is safe — delivered users are skipped.`,
      });
    } finally {
      setSendingFeedback(false);
    }
  }, [adminApi, feedbackStatus, loadFeedbackStatus, t]);

  useEffect(() => {
    if (!IS_SELF_HOSTABLE_BUILD) {
      void loadStats();
      void loadFeedbackStatus();
    }
  }, [loadStats, loadFeedbackStatus]);

  // Early return for self-hostable build after all hooks
  if (IS_SELF_HOSTABLE_BUILD) {
    return <SelfHostAdminDashboard />;
  }

  if (loading && !stats) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            <Trans>Admin Dashboard</Trans>
          </h1>
          <p className="text-muted-foreground mt-1">
            <Trans>Monitor and manage your Budgero platform</Trans>
          </p>
        </div>
        <Button onClick={loadStats} disabled={refreshing} size="sm">
          <Trans>
            <RefreshCw className={cn('w-4 h-4 mr-2', refreshing && 'animate-spin')} />
            Refresh
          </Trans>
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Users}
          label={t`Total Users`}
          value={stats?.totalUsers || 0}
          helper={
            <Trans>
              <span className="text-green-600">+{stats?.activeUsers || 0}</span>active
            </Trans>
          }
        />

        <StatCard
          icon={CreditCard}
          label={t`Paid Users`}
          value={stats?.paidUsers || 0}
          helper={
            <Trans>
              <span className="text-blue-600">{stats?.trialUsers || 0}</span>on trial
            </Trans>
          }
        />

        <StatCard
          icon={DollarSign}
          label="MRR"
          value={`$${((stats?.mrr || 0) / 100).toFixed(2)}`}
          helper="Monthly recurring revenue"
        />

        <StatCard
          icon={Gift}
          label={t`Special Access`}
          value={(stats?.foundingMembers || 0) + (stats?.betaUsers || 0)}
          helper={
            <Trans>
              <span className="text-orange-600">{stats?.foundingMembers || 0}</span>founding,{' '}
              <span className="text-indigo-600">{stats?.betaUsers || 0}</span>free access
            </Trans>
          }
        />
      </div>

      {/* Sync Utilities */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Sync Utilities</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Keep Clerk users aligned with Budgero.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <Users className="h-5 w-5 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium">
                    <Trans>Sync Clerk -&gt; Budgero</Trans>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <Trans>Create or migrate Budgero users from the latest Clerk directory.</Trans>
                  </p>
                </div>
              </div>
              {clerkSyncResult && (
                <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <Trans>
                    Synced {clerkSyncResult.Synced ?? 0} | Created {clerkSyncResult.Created ?? 0} |
                    Migrated {clerkSyncResult.Migrated ?? 0} | Updated{' '}
                    {clerkSyncResult.Updated ?? 0}
                  </Trans>
                </div>
              )}
              <div>
                <Button size="sm" onClick={handleSyncClerkUsers} disabled={syncingClerk}>
                  <RefreshCw className={cn('mr-2 h-4 w-4', syncingClerk && 'animate-spin')} />
                  {syncingClerk ? t`Syncing...` : t`Sync Clerk Users`}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <MailQuestion className="h-5 w-5 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium">
                    <Trans>Quarterly Feedback Email</Trans>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      Ask everyone active in the last 30 days what's working and what isn't. Replies
                      go to hello@.
                    </Trans>
                  </p>
                </div>
              </div>
              {feedbackStatus && (
                <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <Trans>
                    {feedbackStatus.quarter} | Eligible {feedbackStatus.eligible} | Already sent{' '}
                    {feedbackStatus.alreadySent}
                    {feedbackStatus.dryRun ? t` | DRY RUN` : ''}
                  </Trans>
                </div>
              )}
              {feedbackResult && (
                <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <Trans>
                    Last run: sent {feedbackResult.sent ?? 0} | failed {feedbackResult.failed ?? 0}
                  </Trans>
                </div>
              )}
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleSendFeedbackBroadcast}
                  disabled={sendingFeedback || !feedbackStatus || feedbackStatus.eligible === 0}
                >
                  <Send className={cn('mr-2 h-4 w-4', sendingFeedback && 'animate-pulse')} />
                  {sendingFeedback
                    ? t`Sending...`
                    : feedbackStatus && feedbackStatus.eligible === 0
                      ? t`All caught up`
                      : t`Send Feedback Email`}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>User Distribution</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Breakdown of user types</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-green-600" />
                  <span className="text-sm">
                    <Trans>Active Subscribers</Trans>
                  </span>
                </div>
                <Badge variant="secondary">{stats?.paidUsers || 0}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-600" />
                  <span className="text-sm">
                    <Trans>Trial Users</Trans>
                  </span>
                </div>
                <Badge variant="secondary">{stats?.trialUsers || 0}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gift className="w-4 h-4 text-indigo-600" />
                  <span className="text-sm">
                    <Trans>Beta Testers</Trans>
                  </span>
                </div>
                <Badge variant="secondary">{stats?.betaUsers || 0}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-orange-600" />
                  <span className="text-sm">
                    <Trans>Founding Members</Trans>
                  </span>
                </div>
                <Badge variant="secondary">{stats?.foundingMembers || 0}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UserX className="w-4 h-4 text-gray-600" />
                  <span className="text-sm">
                    <Trans>Inactive</Trans>
                  </span>
                </div>
                <Badge variant="secondary">
                  {(stats?.totalUsers || 0) - (stats?.activeUsers || 0)}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Recent Activity</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Latest user actions</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats?.recentActivity?.slice(0, 5).map((activity) => (
                <div key={activity.id} className="flex items-start gap-3 text-sm">
                  <div
                    className={cn(
                      'w-2 h-2 rounded-full mt-1.5',
                      activity.type === 'signup' && 'bg-green-500',
                      activity.type === 'payment' && 'bg-blue-500',
                      activity.type === 'cancellation' && 'bg-red-500',
                      activity.type === 'login' && 'bg-gray-500'
                    )}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{activity.user}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{activity.details}</p>
                  </div>
                </div>
              )) || (
                <p className="text-sm text-muted-foreground">
                  <Trans>No recent activity</Trans>
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stickiness & retention — DAU/MAU + signup-cohort retention. */}
      <StickinessAnalyticsSection />

      {/* Weekly active self-host installs (SaaS admin only). */}
      <SelfHostInstallsSection />

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Quick Actions</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Common administrative tasks</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/admin/users">
                <Trans>
                  <Users className="w-4 h-4 mr-2" />
                  Manage Users
                </Trans>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
