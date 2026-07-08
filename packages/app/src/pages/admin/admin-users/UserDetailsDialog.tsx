import React from 'react';
import {
  Ban,
  CalendarDays,
  Clock,
  Gift,
  Shield,
  RotateCcw,
  Users,
  Activity,
  CreditCard,
} from 'lucide-react';

import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@shared/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import type { ActionType, AdminUserDetails, User } from '@features/admin/model/admin-users';
import { formatShortDate, getStatusBadge } from './admin-users.utils';
import { MetricCard, formatOptionalDate } from './user-details/primitives';
import { OverviewTab } from './user-details/OverviewTab';
import { ActivityTab } from './user-details/ActivityTab';
import { MutationsTab } from './user-details/MutationsTab';
import { WorkspacesTab } from './user-details/WorkspacesTab';
import { BillingTab } from './user-details/BillingTab';

interface UserDetailsDialogProps {
  user: User | null;
  details: AdminUserDetails | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
  onAction: (type: ActionType, user: User) => void;
  onCopyId: (userId: string) => void;
}

export const UserDetailsDialog = React.memo(function UserDetailsDialog({
  user,
  details,
  loading,
  error,
  onRetry,
  onClose,
  onAction,
  onCopyId,
}: UserDetailsDialogProps) {
  if (!user) return null;

  const resolvedUser = details?.user ?? user;
  const handleAction = (type: ActionType) => {
    onClose();
    onAction(type, resolvedUser);
  };

  return (
    <Sheet open={!!user} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="!inset-0 !h-dvh !w-screen !max-w-none flex flex-col gap-0 overflow-y-auto !border-0 p-0"
      >
        <SheetHeader className="border-b bg-[linear-gradient(135deg,rgba(217,119,6,0.08),rgba(14,116,144,0.08),rgba(15,23,42,0.02))] px-6 py-5 text-left">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <SheetTitle className="text-2xl">{resolvedUser.name}</SheetTitle>
              <SheetDescription className="max-w-2xl">
                Live SaaS account details across activity, mutations, workspaces, and billing.
              </SheetDescription>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{resolvedUser.email}</span>
                <span className="text-border">•</span>
                <span>Joined {formatShortDate(resolvedUser.created_at)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {getStatusBadge(resolvedUser)}
              {resolvedUser.is_admin && (
                <Badge variant="outline">
                  <Shield className="mr-1 h-3 w-3" />
                  Admin
                </Badge>
              )}
              {resolvedUser.is_founding_member && (
                <Badge variant="outline">
                  <Gift className="mr-1 h-3 w-3" />
                  Founding
                </Badge>
              )}
              {resolvedUser.has_collaboration_access && (
                <Badge variant="outline">
                  <Users className="mr-1 h-3 w-3" />
                  Collaboration
                </Badge>
              )}
              {resolvedUser.is_blocked && <Badge variant="destructive">Blocked</Badge>}
            </div>
          </div>
          <div className="grid gap-3 pt-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={CalendarDays}
              label="Last Login"
              value={formatOptionalDate(resolvedUser.last_login, 'MMM d, yyyy HH:mm')}
              helper={
                details?.activity?.lastActiveAt
                  ? 'Based on Clerk session activity'
                  : 'No recorded activity yet'
              }
            />
            <MetricCard
              icon={Activity}
              label="Total Mutations"
              value={details?.mutations.totalMutations?.toLocaleString() ?? (loading ? '...' : '0')}
              helper={`${details?.mutations.activeDays ?? 0} active day${(details?.mutations.activeDays ?? 0) === 1 ? '' : 's'} in window`}
            />
            <MetricCard
              icon={Users}
              label="Workspaces"
              value={`${details?.workspaces.items.length ?? 0}`}
              helper={`${details?.workspaces.ownedShareSeatsUsed ?? 0}/${details?.workspaces.ownedShareSeatsLimit ?? 5} shares used`}
            />
            <MetricCard
              icon={CreditCard}
              label="Plan / LTV"
              value={details?.subscription?.planName || 'No active plan'}
              helper={details?.subscription?.ltvFormatted || 'No revenue recorded'}
            />
          </div>
        </SheetHeader>

        <div className="flex-1 px-6 pt-5 pb-6">
          <Tabs defaultValue="overview" className="gap-4">
            <TabsList className="bg-muted/60">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="mutations">Mutations</TabsTrigger>
              <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
              <TabsTrigger value="billing">Billing</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pb-6">
              <OverviewTab
                resolvedUser={resolvedUser}
                details={details}
                loading={loading}
                error={error}
                onRetry={onRetry}
                onCopyId={onCopyId}
              />
            </TabsContent>

            <TabsContent value="activity" className="pb-6">
              <ActivityTab details={details} loading={loading} error={error} onRetry={onRetry} />
            </TabsContent>

            <TabsContent value="mutations" className="pb-6">
              <MutationsTab details={details} loading={loading} error={error} onRetry={onRetry} />
            </TabsContent>

            <TabsContent value="workspaces" className="pb-6">
              <WorkspacesTab details={details} loading={loading} error={error} onRetry={onRetry} />
            </TabsContent>

            <TabsContent value="billing" className="pb-6">
              <BillingTab
                resolvedUser={resolvedUser}
                details={details}
                loading={loading}
                error={error}
                onRetry={onRetry}
              />
            </TabsContent>
          </Tabs>
        </div>

        <div className="border-t bg-muted/20 px-6 py-4">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {!resolvedUser.is_founding_member && (
              <Button variant="outline" onClick={() => handleAction('grant_founding')}>
                <Gift className="mr-2 h-4 w-4" />
                Grant Founding Member
              </Button>
            )}
            {!resolvedUser.has_beta_access && (
              <Button variant="outline" onClick={() => handleAction('grant_beta')}>
                <Clock className="mr-2 h-4 w-4" />
                Grant Free Access
              </Button>
            )}
            <Button variant="destructive" onClick={() => handleAction('reset_data')}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset User Data
            </Button>
            <Button variant="destructive" onClick={() => handleAction('revoke_access')}>
              <Ban className="mr-2 h-4 w-4" />
              Revoke Access
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
});
