import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAdminApi } from '@features/admin/api/useAdminApi';
import type { InactiveUser, PurgeUserResult } from '@features/admin/model/admin-users';
import { formatRelativeToNow } from '@shared/lib/date-format';
import { getErrorMessage } from '@shared/lib/errors';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';

const DAY_OPTIONS = [90, 180, 365, 730];
const CONFIRM_WORD = 'DELETE';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ago(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : formatRelativeToNow(date, { addSuffix: true });
}

/**
 * Finds accounts with no sign of life (heartbeats, Clerk activity, sign-up)
 * for a chosen period and deletes them permanently: data, mutation log,
 * activity and, optionally, the Clerk account.
 */
export function InactiveUsersCard({ onPurged }: { onPurged?: () => void }) {
  const { t } = useLingui();
  const api = useAdminApi();
  const [days, setDays] = useState(180);
  const [users, setUsers] = useState<InactiveUser[]>([]);
  const [clerkChecked, setClerkChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleteFromClerk, setDeleteFromClerk] = useState(true);
  const [purging, setPurging] = useState(false);
  const [failures, setFailures] = useState<PurgeUserResult[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getInactiveUsers(days);
      setUsers(response.users);
      setClerkChecked(response.clerk_checked);
      setSelected(new Set());
    } catch (error) {
      toast.error(getErrorMessage(error, t`Couldn't load inactive users`));
    } finally {
      setLoading(false);
    }
  }, [api, days, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const eligible = useMemo(() => users.filter((user) => !user.protected_reason), [users]);
  const selectedUsers = useMemo(
    () => eligible.filter((user) => selected.has(user.id)),
    [eligible, selected]
  );
  const allSelected = eligible.length > 0 && selectedUsers.length === eligible.length;

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const purge = async () => {
    setPurging(true);
    try {
      const { results } = await api.purgeUsers(
        selectedUsers.map((user) => user.id),
        deleteFromClerk
      );
      const purged = results.filter((result) => result.status === 'purged').length;
      const notPurged = results.filter((result) => result.status !== 'purged');
      setFailures(notPurged);
      if (purged) {
        toast.success(
          plural(purged, {
            one: 'Deleted # user permanently',
            other: 'Deleted # users permanently',
          })
        );
      }
      if (notPurged.length) {
        toast.warning(
          plural(notPurged.length, {
            one: '# user was not deleted',
            other: '# users were not deleted',
          })
        );
      }
      setConfirmOpen(false);
      setConfirmText('');
      onPurged?.();
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, t`Couldn't delete the selected users`));
    } finally {
      setPurging(false);
    }
  };

  const totalBytes = selectedUsers.reduce((sum, user) => sum + user.stored_bytes, 0);
  const totalSpaces = selectedUsers.reduce((sum, user) => sum + user.owned_spaces, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>
            <Trans>Inactive users</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Accounts with no heartbeat, Clerk activity or sign-up in the chosen period. Deleting
              removes everything: budgets, sync history, activity and, optionally, the Clerk
              account. Admins, paying subscribers and founding members can't be deleted.
            </Trans>
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
            <SelectTrigger className="w-40" aria-label={t`Inactive for`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAY_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {plural(option, { one: 'Inactive # day', other: 'Inactive # days' })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => void load()} aria-label={t`Refresh`}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!clerkChecked && !loading && (
          <p className="text-xs text-muted-foreground">
            <Trans>
              Clerk wasn't checked, so activity comes from heartbeats and sign-up dates only.
            </Trans>
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {plural(users.length, { one: '# inactive user', other: '# inactive users' })}
          </span>
          <Button
            variant="destructive"
            size="sm"
            disabled={!selectedUsers.length}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            <Trans>Delete permanently ({selectedUsers.length})</Trans>
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  aria-label={t`Select all deletable users`}
                  checked={allSelected}
                  disabled={!eligible.length}
                  onCheckedChange={(checked) =>
                    setSelected(checked ? new Set(eligible.map((user) => user.id)) : new Set())
                  }
                />
              </TableHead>
              <TableHead>
                <Trans>User</Trans>
              </TableHead>
              <TableHead>
                <Trans>Last active</Trans>
              </TableHead>
              <TableHead>
                <Trans>Plan</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans>Budgets</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans>Data</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !users.length ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : !users.length ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  <Trans>No inactive users for this period.</Trans>
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={t`Select ${user.email}`}
                      checked={selected.has(user.id)}
                      disabled={Boolean(user.protected_reason)}
                      onCheckedChange={(checked) => toggle(user.id, checked === true)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{user.email}</div>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {user.protected_reason && (
                        <Badge variant="secondary" className="text-[0.625rem]">
                          <Trans>Protected: {user.protected_reason}</Trans>
                        </Badge>
                      )}
                      {user.in_clerk === false && (
                        <Badge variant="outline" className="text-[0.625rem] text-amber-600">
                          <Trans>Not in Clerk</Trans>
                        </Badge>
                      )}
                      {user.is_blocked && (
                        <Badge variant="outline" className="text-[0.625rem]">
                          <Trans>Blocked</Trans>
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{ago(user.last_active_at)}</div>
                    <div className="text-xs text-muted-foreground">
                      {user.last_heartbeat_day ? (
                        <Trans>Heartbeat {user.last_heartbeat_day}</Trans>
                      ) : (
                        <Trans>No heartbeat</Trans>
                      )}
                      {user.clerk_last_active_at && (
                        <>
                          {' · '}
                          <Trans>Clerk {ago(user.clerk_last_active_at)}</Trans>
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{user.subscription_status || '—'}</TableCell>
                  <TableCell className="text-right text-sm">
                    {user.owned_spaces}
                    {user.shared_spaces ? (
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        <Trans>+{user.shared_spaces} shared</Trans>
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {formatBytes(user.stored_bytes)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {failures.length > 0 && (
          <div className="rounded-md border border-amber-500/40 p-3 text-xs">
            <div className="mb-1 font-medium">
              <Trans>Not deleted</Trans>
            </div>
            <ul className="space-y-0.5">
              {failures.map((failure) => (
                <li key={failure.user_id}>
                  {users.find((user) => user.id === failure.user_id)?.email ?? failure.user_id}:{' '}
                  {failure.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={(open) => !purging && setConfirmOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {plural(selectedUsers.length, {
                one: 'Delete # user permanently?',
                other: 'Delete # users permanently?',
              })}
            </DialogTitle>
            <DialogDescription>
              <Trans>
                This deletes {totalSpaces} budgets ({formatBytes(totalBytes)}), their sync history,
                activity records and every other trace of these accounts. It can't be undone.
                Budgets they only shared with others stay with their owners.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="purge-clerk"
                checked={deleteFromClerk}
                onCheckedChange={(checked) => setDeleteFromClerk(checked === true)}
              />
              <Label htmlFor="purge-clerk" className="text-sm font-normal">
                <Trans>Also delete their Clerk accounts</Trans>
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="purge-confirm">
                <Trans>Type {CONFIRM_WORD} to confirm</Trans>
              </Label>
              <Input
                id="purge-confirm"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={purging} onClick={() => setConfirmOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="destructive"
              disabled={purging || confirmText !== CONFIRM_WORD}
              onClick={() => void purge()}
            >
              {purging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Trans>Delete permanently</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
