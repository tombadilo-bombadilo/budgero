import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  Shield,
  Database,
  HardDrive,
  Server,
  Layers,
  RefreshCw,
  Activity,
  HardDriveDownload,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { Separator } from '@shared/ui/separator';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { downloadBlob } from '@shared/lib/download';
import { formatBytes } from '@shared/lib/format-bytes';
import { StatCard } from '@pages/admin/components/StatCard';
import { useAdminApi } from '@features/admin/api/useAdminApi';
import type { SelfHostAdminStats } from '@features/admin/model/admin-self-host';

export default function SelfHostAdminDashboard() {
  const adminApi = useAdminApi();
  const [stats, setStats] = useState<SelfHostAdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingDb, setDownloadingDb] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setRefreshing(true);
      const data = await adminApi.getSelfHostStats();
      setStats(data);
    } catch (error) {
      console.error('Failed to load self-host stats', error);
      toast.error('Unable to load stats', {
        description: 'Check that the server is reachable and you have admin access.',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [adminApi]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const overviewCards = useMemo(
    () => [
      {
        label: 'Total Users',
        value: stats?.totalUsers ?? 0,
        helper: `${stats?.adminUsers ?? 0} admin${(stats?.adminUsers ?? 0) === 1 ? '' : 's'}`,
        icon: Users,
      },
      {
        label: 'Local Accounts',
        value: stats?.localAccounts ?? 0,
        helper: `${stats?.masterPasswordUsers ?? 0} master passwords set`,
        icon: Shield,
      },
      {
        label: 'Budget Spaces',
        value: stats?.spaceCount ?? 0,
        helper: `${stats?.spacesWithMembers ?? 0} active`,
        icon: Layers,
      },
      {
        label: 'Database Size',
        value: stats ? formatBytes(stats.databaseSizeBytes) : '—',
        helper: stats?.databasePath || 'Not configured',
        icon: HardDrive,
      },
    ],
    [stats]
  );

  if (loading && !stats) {
    return (
      <div className="p-8 space-y-4">
        <div className="h-9 bg-muted animate-pulse rounded w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-28 bg-muted animate-pulse rounded" />
          ))}
        </div>
      </div>
    );
  }

  const handleDownloadDb = async () => {
    try {
      setDownloadingDb(true);
      const { data } = await adminApi.downloadSelfHostDatabase();
      downloadBlob(data, `budgero-${new Date().toISOString()}.db`, 'application/octet-stream');
    } catch (error) {
      console.error('Failed to download database', error);
      toast.error('Download failed');
    } finally {
      setDownloadingDb(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">Self-host Control Center</h1>
            <Badge variant="secondary">Self-host</Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            Monitor your private Budgero deployment and act on user accounts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/admin/users">Manage Users</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/admin/database">Open DB Explorer</Link>
          </Button>
          <Button variant="outline" onClick={handleDownloadDb} disabled={downloadingDb}>
            {downloadingDb ? 'Downloading…' : 'Download SQLite'}
          </Button>
          <Button size="sm" onClick={loadStats} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {overviewCards.map((card) => (
          <StatCard
            key={card.label}
            icon={card.icon}
            label={card.label}
            value={card.value}
            helper={card.helper}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>System Overview</CardTitle>
            <CardDescription>Deployment details for this binary.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Database Path</p>
                <p className="text-sm text-muted-foreground break-all">{stats?.databasePath}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (stats?.databasePath) {
                    void navigator.clipboard.writeText(stats.databasePath);
                    toast.success('Copied path', { description: stats.databasePath });
                  }
                }}
              >
                Copy
              </Button>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <HardDriveDownload className="w-4 h-4" />
                  Database size
                </div>
                <p className="text-lg font-semibold">
                  {formatBytes(stats?.databaseSizeBytes ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Server className="w-4 h-4" />
                  Last updated
                </div>
                <p className="text-lg font-semibold">
                  {stats?.databaseLastModified
                    ? formatDistanceToNow(new Date(stats.databaseLastModified), { addSuffix: true })
                    : 'Unknown'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Space Utilization</CardTitle>
            <CardDescription>Storage and activity across budget spaces.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">Active spaces</span>
              </div>
              <span className="text-sm font-semibold">
                {stats?.spacesWithMembers ?? 0} / {stats?.spaceCount ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">Membership records</span>
              </div>
              <span className="text-sm font-semibold">{stats?.totalMemberships ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">Space storage</span>
              </div>
              <span className="text-sm font-semibold">
                {formatBytes(stats?.spaceBlobBytes ?? 0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">Pending invites</span>
              </div>
              <span className="text-sm font-semibold">{stats?.pendingInvites ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Signups</CardTitle>
          <CardDescription>Latest users created on this deployment.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats?.recentUsers?.length ? (
            <div className="space-y-4">
              {stats.recentUsers.map((user) => (
                <div key={user.id} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{user.name}</p>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No users created yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
