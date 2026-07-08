import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
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
      toast.error('Unable to load users');
    } finally {
      setLoading(false);
    }
  }, [adminApi]);

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
      toast.error('Password too short', {
        description: 'Use at least 8 characters.',
      });
      return;
    }
    if (resetDialog.password !== resetDialog.confirm) {
      toast.error('Passwords do not match');
      return;
    }

    try {
      setResetDialog((prev) => ({ ...prev, submitting: true }));
      await adminApi.resetSelfHostPassword(resetDialog.user.id, resetDialog.password);
      toast.success('Password updated', { description: resetDialog.user.email });
      setResetDialog(CLOSED_RESET_DIALOG);
    } catch (error) {
      console.error('Failed to reset password', error);
      toast.error('Reset failed');
      setResetDialog((prev) => ({ ...prev, submitting: false }));
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteDialog.user) return;
    try {
      setDeleteDialog((prev) => ({ ...prev, submitting: true }));
      await adminApi.deleteSelfHostUser(deleteDialog.user.id);
      toast.success('User deleted', { description: deleteDialog.user.email });
      setDeleteDialog(CLOSED_DELETE_DIALOG);
      await loadUsers();
    } catch (error) {
      console.error('Failed to delete user', error);
      toast.error('Delete failed');
      setDeleteDialog((prev) => ({ ...prev, submitting: false }));
    }
  };

  const handleBlockUser = async (user: SelfHostAdminUser, block: boolean) => {
    try {
      if (block) {
        await adminApi.blockUser(user.id);
        toast.success('Blocked', { description: `${user.email} cannot log in` });
      } else {
        await adminApi.unblockUser(user.id);
        toast.success('Unblocked', { description: `${user.email} can log in again` });
      }
      await loadUsers();
    } catch (error) {
      console.error('Failed to update block flag', error);
      toast.error('Update failed');
    }
  };

  const handleResetData = async (user: SelfHostAdminUser) => {
    if (!user) return;
    const confirmed = window.confirm(`Reset stored data for ${user.email}? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await adminApi.resetUserData(user.id);
      toast.success('User data reset', { description: user.email });
    } catch (error) {
      console.error('Failed to reset data', error);
      toast.error('Reset failed');
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
      toast.error('Username required');
      return;
    }
    if (createDialog.password.length < 8) {
      toast.error('Password too short', {
        description: 'Use at least 8 characters.',
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
      toast.success('User created', { description: createDialog.email });
      setCreateDialog(CLOSED_CREATE_DIALOG);
      await loadUsers();
    } catch (error) {
      console.error('Failed to create user', error);
      toast.error('Create failed');
      setCreateDialog((prev) => ({ ...prev, submitting: false }));
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold">Users</h1>
          <p className="text-muted-foreground mt-1">Manage local accounts, passwords, and data.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setCreateDialog((prev) => ({ ...prev, open: true }))}>
            <UserPlus className="w-4 h-4 mr-2" />
            Add User
          </Button>
          <Button variant="outline" onClick={loadUsers} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Total users</CardTitle>
            <CardDescription>Across this deployment</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className="text-3xl font-bold">{summary.total}</div>
            <Users className="w-5 h-5 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Admins</CardTitle>
            <CardDescription>Users with elevated access</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary.admins}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Missing master passwords</CardTitle>
            <CardDescription>Users who need onboarding</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary.noMasterPassword}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Blocked users</CardTitle>
            <CardDescription>Cannot log in</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary.blocked}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search Users</CardTitle>
          <CardDescription>Filter by name, username, or ID.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search by username, name, or ID..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            {loading
              ? 'Loading users...'
              : `${filteredUsers.length} matching user${filteredUsers.length === 1 ? '' : 's'}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 text-muted-foreground animate-spin" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No users found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Spaces</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                            <Shield className="w-3 h-3 mr-1" /> Admin
                          </Badge>
                        )}
                        {user.isBlocked && (
                          <Badge variant="destructive" className="text-xs">
                            <Ban className="w-3 h-3 mr-1" /> Blocked
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          <LockOpen className="w-3 h-3 mr-1" />
                          {user.hasLocalPassword ? 'Password set' : 'No password'}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {user.isMasterPasswordSet ? 'Master password set' : 'Needs onboarding'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <span className="font-medium">{user.spaceMembershipCount}</span> memberships
                        <br />
                        <span className="font-medium">{user.ownedSpaceCount}</span> owned
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
                          <DropdownMenuLabel>Manage</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openResetDialog(user)}>
                            <KeyRound className="w-4 h-4 mr-2" /> Reset password
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleResetData(user)}>
                            <RotateCcw className="w-4 h-4 mr-2" /> Reset data flags
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleBlockUser(user, !user.isBlocked)}>
                            <Ban className="w-4 h-4 mr-2" />
                            {user.isBlocked ? 'Unblock user' : 'Block user'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => openDeleteDialog(user)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete user
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
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Set a new password for {resetDialog.user?.email}. Share it securely with the user.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={resetDialog.password}
                onChange={(event) =>
                  setResetDialog((prev) => ({ ...prev, password: event.target.value }))
                }
                placeholder="At least 8 characters"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={resetDialog.confirm}
                onChange={(event) =>
                  setResetDialog((prev) => ({ ...prev, confirm: event.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialog(CLOSED_RESET_DIALOG)}>
              Cancel
            </Button>
            <Button onClick={handleResetPassword} disabled={resetDialog.submitting}>
              {resetDialog.submitting ? 'Resetting...' : 'Reset password'}
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
            <DialogTitle>Delete user</DialogTitle>
            <DialogDescription>
              Permanently delete {deleteDialog.user?.email}. This removes their memberships and
              owned spaces.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(CLOSED_DELETE_DIALOG)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteUser}
              disabled={deleteDialog.submitting}
            >
              {deleteDialog.submitting ? 'Deleting…' : 'Delete user'}
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
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              Add a new user to this deployment. Share the password securely.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-username">Username</Label>
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
              <Label htmlFor="create-name">Name</Label>
              <Input
                id="create-name"
                type="text"
                value={createDialog.name}
                onChange={(event) =>
                  setCreateDialog((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="John Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-password">Password</Label>
              <div className="flex gap-2">
                <Input
                  id="create-password"
                  type="text"
                  value={createDialog.password}
                  onChange={(event) =>
                    setCreateDialog((prev) => ({ ...prev, password: event.target.value }))
                  }
                  placeholder="At least 8 characters"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={generatePassword}
                  title="Generate random password"
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
                Grant admin privileges
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog(CLOSED_CREATE_DIALOG)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser} disabled={createDialog.submitting}>
              {createDialog.submitting ? 'Creating...' : 'Create user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
