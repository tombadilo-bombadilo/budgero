import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { RefreshCw } from 'lucide-react';
import type { User, ActionType } from '@features/admin/model/admin-users';
import { UserTableRow } from './UserTableRow';

interface UsersTableProps {
  users: User[];
  loading: boolean;
  onViewDetails: (user: User) => void;
  onAction: (type: ActionType, user: User) => void;
  onCopyId: (userId: string) => void;
}

export const UsersTable = React.memo(function UsersTable({
  users,
  loading,
  onViewDetails,
  onAction,
  onCopyId,
}: UsersTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>All Users</CardTitle>
        <CardDescription>
          {loading ? 'Loading...' : `${users.length} user${users.length !== 1 ? 's' : ''} found`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No users found</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Details</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <UserTableRow
                  key={user.id}
                  user={user}
                  onViewDetails={onViewDetails}
                  onAction={onAction}
                  onCopyId={onCopyId}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
});
