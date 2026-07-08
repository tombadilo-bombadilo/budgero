import React from 'react';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { TableCell, TableRow } from '@shared/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { MoreVertical, Shield, Gift, Ban, Clock, UserCheck, Copy, RotateCcw } from 'lucide-react';
import type { User, ActionType } from '@features/admin/model/admin-users';
import { formatShortDate, getStatusBadge, getSubscriptionInfo } from './admin-users.utils';

interface UserTableRowProps {
  user: User;
  onViewDetails: (user: User) => void;
  onAction: (type: ActionType, user: User) => void;
  onCopyId: (userId: string) => void;
}

export const UserTableRow = React.memo(function UserTableRow({
  user,
  onViewDetails,
  onAction,
  onCopyId,
}: UserTableRowProps) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-1">
          <code className="text-xs bg-muted px-2 py-1 rounded">{user.id.slice(0, 8)}...</code>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => onCopyId(user.id)}
          >
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      </TableCell>
      <TableCell>
        <div>
          <div className="font-medium">{user.name}</div>
          <div className="text-sm text-muted-foreground">{user.email}</div>
          <div className="flex gap-1 mt-1">
            {user.is_admin && (
              <Badge variant="outline" className="text-xs">
                <Shield className="w-3 h-3 mr-1" />
                Admin
              </Badge>
            )}
            {user.is_founding_member && (
              <Badge variant="outline" className="text-xs">
                <Gift className="w-3 h-3 mr-1" />
                Founding
              </Badge>
            )}
            {user.is_blocked && (
              <Badge variant="destructive" className="text-xs">
                <Ban className="w-3 h-3 mr-1" />
                Blocked
              </Badge>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>{getStatusBadge(user)}</TableCell>
      <TableCell>{getSubscriptionInfo(user)}</TableCell>
      <TableCell>
        <span className="text-sm">{formatShortDate(user.created_at)}</span>
      </TableCell>
      <TableCell>
        <Button size="sm" variant="outline" onClick={() => onViewDetails(user)}>
          View Details
        </Button>
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onViewDetails(user)}>
              <UserCheck className="w-4 h-4 mr-2" />
              View Details
            </DropdownMenuItem>
            {!user.is_founding_member && (
              <DropdownMenuItem onClick={() => onAction('grant_founding', user)}>
                <Gift className="w-4 h-4 mr-2" />
                Grant Founding Member
              </DropdownMenuItem>
            )}
            {!user.has_beta_access && (
              <DropdownMenuItem onClick={() => onAction('grant_beta', user)}>
                <Clock className="w-4 h-4 mr-2" />
                Grant Free Access
              </DropdownMenuItem>
            )}
            {!user.is_admin && (
              <DropdownMenuItem onClick={() => onAction('make_admin', user)}>
                <Shield className="w-4 h-4 mr-2" />
                Make Admin
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onAction('reset_data', user)} className="text-red-600">
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset User Data
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onAction(user.is_blocked ? 'unblock' : 'block', user)}
              className="text-red-600"
            >
              <Ban className="w-4 h-4 mr-2" />
              {user.is_blocked ? 'Unblock User' : 'Block User'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onAction('revoke_access', user)}
              className="text-red-600"
            >
              <Ban className="w-4 h-4 mr-2" />
              Revoke Access
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
});
