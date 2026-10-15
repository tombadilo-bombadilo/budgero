import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { PasswordInput } from '@shared/ui/password-input';
import { Badge } from '@shared/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { Label } from '@shared/ui/label';
import { Checkbox } from '@shared/ui/checkbox';
import { toast } from 'sonner';
import { useAdminApi } from '@features/admin/api/useAdminApi';
import type { SelfHostAdminUser } from '@features/admin/model/admin-self-host';
import {
  Search,
  RefreshCw,
  Shield,
  Ban,
  LockOpen,
  MoreVertical,
  KeyRound,
  RotateCcw,
  Trash2,
  Users,
  UserPlus,
  Dices,
} from 'lucide-react';
import { formatShortDate, matchesUserSearch } from './admin-users/admin-users.utils';

const CLOSED_RESET_DIALOG: {
  open: boolean;
  user: SelfHostAdminUser | null;
  password: string;
  confirm: string;
  submitting: boolean;
} = { open: false, user: null, password: '', confirm: '', submitting: false };

const CLOSED_DELETE_DIALOG: {
  open: boolean;
  user: SelfHostAdminUser | null;
  submitting: boolean;
} = { open: false, user: null, submitting: false };

const CLOSED_CREATE_DIALOG: {
  open: boolean;
  email: string;
  name: string;
  password: string;
  isAdmin: boolean;
  submitting: boolean;
} = { open: false, email: '', name: '', password: '', isAdmin: false, submitting: false };

export default function SelfHostAdminUsers() {
  const { t } = useLingui();

  const adminApi = useAdminApi();
  const [users, setUsers] = useState<SelfHostAdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [resetDialog, setResetDialog] = useState(CLOSED_RESET_DIALOG);
  const [deleteDialog, setDeleteDialog] = useState(CLOSED_DELETE_DIALOG);
  const [createDialog, setCreateDialog] = useState(CLOSED_CREATE_DIALOG);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getSelfHostUsers();
      setUsers(data ?? []);
    } catch (error) {
      console.error('Failed to load self-host users', error);
      toast.error(t`Unable to load users`);
    } finally {
      setLoading(false);
    }
  }, [adminApi, t]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const filteredUsers = useMemo(
    () => users.filter((user) => matchesUserSearch(user, search)),
    [users, search]
  );

  const summary = useMemo(() => {
    const total = users.length;
    const admins = users.filter((u) => u.isAdmin).length;
    const noMasterPassword = users.filter((u) => !u.isMasterPasswordSet).length;
    const blocked = users.filter((u) => u.isBlocked).length;
    return { total, admins, noMasterPassword, blocked };
  }, [users]);

  const openResetDialog = (user: SelfHostAdminUser) =>
    setResetDialog({ open: true, user, password: '', confirm: '', submitting: false });

  const openDeleteDialog = (user: SelfHostAdminUser) =>
    setDeleteDialog({ open: true, user, submitting: false });

  const handleResetPassword = async () => {
    if (!resetDialog.user) return;
    if (resetDialog.password.length < 8) {
      toast.error(t`Password too short`, {
        description: t`Use at least 8 characters.`,
      });
      return;
    }
    if (resetDialog.password !== resetDialog.confirm) {
      toast.error(t`Passwords do not match`);
      return;
    }

    try {
      setResetDialog((prev) => ({ ...prev, submitting: true }));
      await adminApi.resetSelfHostPassword(resetDialog.user.id, resetDialog.password);
      toast.success(t`Password updated`, { description: resetDialog.user.email });
      setResetDialog(CLOSED_RESET_DIALOG);
    } catch (error) {
      console.error('Failed to reset password', error);
      toast.error(t`Reset failed`);
      setResetDialog((prev) => ({ ...prev, submitting: false }));
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteDialog.user) return;
    try {
      setDeleteDialog((prev) => ({ ...prev, submitting: true }));
      await adminApi.deleteSelfHostUser(deleteDialog.user.id);
      toast.success(t`User deleted`, { description: deleteDialog.user.email });
      setDeleteDialog(CLOSED_DELETE_DIALOG);
      await loadUsers();
    } catch (error) {
      console.error('Failed to delete user', error);
      toast.error(t`Delete failed`);
      setDeleteDialog((prev) => ({ ...prev, submitting: false }));
    }
  };

  const handleBlockUser = async (user: SelfHostAdminUser, block: boolean) => {
    try {
      if (block) {
        await adminApi.blockUser(user.id);
        toast.success(t`Blocked`, { description: t`${user.email} cannot log in` });
      } else {
        await adminApi.unblockUser(user.id);
        toast.success(t`Unblocked`, { description: t`${user.email} can log in again` });
      }
      await loadUsers();
    } catch (error) {
      console.error('Failed to update block flag', error);
      toast.error(t`Update failed`);
    }
  };

  const handleResetData = async (user: SelfHostAdminUser) => {
    if (!user) return;
    const confirmed = window.confirm(`Reset stored data for ${user.email}? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await adminApi.resetUserData(user.id);
      toast.success(t`User data reset`, { description: user.email });
    } catch (error) {
      console.error('Failed to reset data', error);
      toast.error(t`Reset failed`);
    }
  };

  const generatePassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    const array = new Uint32Array(16);
    crypto.getRandomValues(array);
    const password = Array.from(array, (n) => chars[n % chars.length]).join('');
    setCreateDialog((prev) => ({ ...prev, password }));
  };

  const handleCreateUser = async () => {
    if (!createDialog.email.trim()) {
      toast.error(t`Username required`);
      return;
    }
    if (createDialog.password.length < 8) {
      toast.error(t`Password too short`, {
        description: t`Use at least 8 characters.`,
      });
      return;
    }

    try {
      setCreateDialog((prev) => ({ ...prev, submitting: true }));
      await adminApi.createSelfHostUser(
        createDialog.email,
        createDialog.name,
        createDialog.password,
        createDialog.isAdmin
      );
      toast.success(t`User created`, { description: createDialog.email });
      setCreateDialog(CLOSED_CREATE_DIALOG);
      await loadUsers();
    } catch (error) {
      console.error('Failed to create user', error);
      toast.error(t`Create failed`);
      setCreateDialog((prev) => ({ ...prev, submitting: false }));
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            <Trans>Users</Trans>
          </h1>
          <p className="text-muted-foreground mt-1">
            <Trans>Manage local accounts, passwords, and data.</Trans>
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setCreateDialog((prev) => ({ ...prev, open: true }))}>
            <Trans>
              <UserPlus className="w-4 h-4 mr-2" />
              Add User
            </Trans>
          </Button>
          <Button variant="outline" onClick={loadUsers} disabled={loading}>
            <Trans>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Trans>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Total users</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Across this deployment</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className="text-3xl font-bold">{summary.total}</div>
            <Users className="w-5 h-5 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Admins</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Users with elevated access</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary.admins}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Missing master passwords</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Users who need onboarding</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary.noMasterPassword}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Blocked users</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Cannot log in</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary.blocked}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Search Users</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Filter by name, username, or ID.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder={t`Search by username, name, or ID...`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Accounts</Trans>
          </CardTitle>
          <CardDescription>
            {loading
              ? t`Loading users...`
              : plural(filteredUsers.length, {
                  one: `# matching user`,
                  other: `# matching users`,
                })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 text-muted-foreground animate-spin" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              <Trans>No users found.</Trans>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Trans>User</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Status</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Spaces</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Created</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Last login</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <Trans>Actions</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{user.name}</div>
                        <div className="text-sm text-muted-foreground">{user.email}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.isAdmin && (
                          <Badge variant="outline" className="text-xs">
                            <Trans>
                              <Shield className="w-3 h-3 mr-1" />
                              Admin
                            </Trans>
                          </Badge>
                        )}
                        {user.isBlocked && (
                          <Badge variant="destructive" className="text-xs">
                            <Trans>
                              <Ban className="w-3 h-3 mr-1" />
                              Blocked
                            </Trans>
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          <LockOpen className="w-3 h-3 mr-1" />
                          {user.hasLocalPassword ? t`Password set` : t`No password`}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {user.isMasterPasswordSet ? t`Master password set` : t`Needs onboarding`}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <Trans>
                          <span className="font-medium">{user.spaceMembershipCount}</span>
                          memberships
                          <br />
                          <span className="font-medium">{user.ownedSpaceCount}</span>owned
                        </Trans>
                      </div>
                    </TableCell>
                    <TableCell>{formatShortDate(user.createdAt)}</TableCell>
                    <TableCell>{formatShortDate(user.lastLoginAt)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>
                            <Trans>Manage</Trans>
                          </DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openResetDialog(user)}>
                            <Trans>
                              <KeyRound className="w-4 h-4 mr-2" />
                              Reset password
                            </Trans>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleResetData(user)}>
                            <Trans>
                              <RotateCcw className="w-4 h-4 mr-2" />
                              Reset data flags
                            </Trans>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleBlockUser(user, !user.isBlocked)}>
                            <Ban className="w-4 h-4 mr-2" />
                            {user.isBlocked ? t`Unblock user` : t`Block user`}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => openDeleteDialog(user)}
                          >
                            <Trans>
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete user
                            </Trans>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={resetDialog.open}
        onOpenChange={(open) =>
          setResetDialog((prev) => (open ? { ...prev, open: true } : CLOSED_RESET_DIALOG))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans>Reset password</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                Set a new password for {resetDialog.user?.email}. Share it securely with the user.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">
                <Trans>New password</Trans>
              </Label>
              <PasswordInput
                id="new-password"
                value={resetDialog.password}
                onChange={(event) =>
                  setResetDialog((prev) => ({ ...prev, password: event.target.value }))
                }
                placeholder={t`At least 8 characters`}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">
                <Trans>Confirm password</Trans>
              </Label>
              <PasswordInput
                id="confirm-password"
                value={resetDialog.confirm}
                onChange={(event) =>
                  setResetDialog((prev) => ({ ...prev, confirm: event.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialog(CLOSED_RESET_DIALOG)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button onClick={handleResetPassword} disabled={resetDialog.submitting}>
              {resetDialog.submitting ? t`Resetting...` : t`Reset password`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteDialog.open}
        onOpenChange={(open) =>
          setDeleteDialog((prev) => (open ? { ...prev, open: true } : CLOSED_DELETE_DIALOG))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans>Delete user</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                Permanently delete {deleteDialog.user?.email}. This removes their memberships and
                owned spaces.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(CLOSED_DELETE_DIALOG)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteUser}
              disabled={deleteDialog.submitting}
            >
              {deleteDialog.submitting ? t`Deleting…` : t`Delete user`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createDialog.open}
        onOpenChange={(open) =>
          setCreateDialog((prev) => (open ? { ...prev, open: true } : CLOSED_CREATE_DIALOG))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans>Create user</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>Add a new user to this deployment. Share the password securely.</Trans>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-username">
                <Trans>Username</Trans>
              </Label>
              <Input
                id="create-username"
                type="text"
                value={createDialog.email}
                onChange={(event) =>
                  setCreateDialog((prev) => ({ ...prev, email: event.target.value }))
                }
                placeholder="johndoe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-name">
                <Trans>Name</Trans>
              </Label>
              <Input
                id="create-name"
                type="text"
                value={createDialog.name}
                onChange={(event) =>
                  setCreateDialog((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder={t`John Doe`}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-password">
                <Trans>Password</Trans>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="create-password"
                  type="text"
                  value={createDialog.password}
                  onChange={(event) =>
                    setCreateDialog((prev) => ({ ...prev, password: event.target.value }))
                  }
                  placeholder={t`At least 8 characters`}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={generatePassword}
                  title={t`Generate random password`}
                >
                  <Dices className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="create-admin"
                checked={createDialog.isAdmin}
                onCheckedChange={(checked) =>
                  setCreateDialog((prev) => ({ ...prev, isAdmin: checked === true }))
                }
              />
              <Label htmlFor="create-admin" className="text-sm font-normal cursor-pointer">
                <Trans>Grant admin privileges</Trans>
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog(CLOSED_CREATE_DIALOG)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button onClick={handleCreateUser} disabled={createDialog.submitting}>
              {createDialog.submitting ? t`Creating...` : t`Create user`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
