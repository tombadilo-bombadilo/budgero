import React from 'react';
import { Button } from '@shared/ui/button';
import { RefreshCw } from 'lucide-react';

interface AdminUsersHeaderProps {
  onSyncClerk: () => void;
  onSyncLemonSqueezy: () => void;
  onRefresh: () => void;
}

export const AdminUsersHeader = React.memo(function AdminUsersHeader({
  onSyncClerk,
  onSyncLemonSqueezy,
  onRefresh,
}: AdminUsersHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold">Users</h1>
        <p className="text-muted-foreground mt-1">Manage user accounts and access levels</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={onSyncClerk} size="sm" variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Sync Clerk Users
        </Button>
        <Button onClick={onSyncLemonSqueezy} size="sm" variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Sync Subscriptions
        </Button>
        <Button onClick={onRefresh} size="sm" variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>
    </div>
  );
});
