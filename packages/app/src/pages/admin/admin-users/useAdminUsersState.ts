import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAdminApi } from '@features/admin/api/useAdminApi';
import { toast } from 'sonner';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import type {
  User,
  ActionDialogState,
  ActionType,
  AdminUserDetails,
} from '@features/admin/model/admin-users';
import { DEFAULT_BETA_DAYS } from './constants';
import { filterUsers } from './admin-users.utils';

export function useAdminUsersState() {
  const adminApi = useAdminApi();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedUserDetails, setSelectedUserDetails] = useState<AdminUserDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialogState>({
    open: false,
    type: null,
    user: null,
  });
  const [betaDays, setBetaDays] = useState(DEFAULT_BETA_DAYS);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getUsers();
      setUsers((data as unknown as User[]) || []);
    } catch (error) {
      console.error('Failed to load users:', error);
      toast.error('Error', {
        description: 'Failed to load users',
      });
    } finally {
      setLoading(false);
    }
  }, [adminApi]);

  useEffect(() => {
    // Skip loading SaaS users in self-host mode - SelfHostAdminUsers has its own data fetching
    if (IS_SELF_HOSTABLE_BUILD) {
      setLoading(false);
      return;
    }
    void loadUsers();
  }, [loadUsers]);

  const filteredUsers = useMemo(() => filterUsers(users || [], searchTerm), [users, searchTerm]);

  const closeUserDetails = useCallback(() => {
    setSelectedUser(null);
    setSelectedUserDetails(null);
    setDetailsLoading(false);
    setDetailsError(null);
  }, []);

  const openUserDetails = useCallback(
    async (user: User) => {
      setSelectedUser(user);
      setSelectedUserDetails(null);
      setDetailsError(null);
      setDetailsLoading(true);

      try {
        const details = await adminApi.getUserDetails(user.id, 365);
        setSelectedUserDetails(details);
      } catch (error) {
        console.error('Failed to load user details:', error);
        setDetailsError('Failed to load user details');
      } finally {
        setDetailsLoading(false);
      }
    },
    [adminApi]
  );

  const openActionDialog = useCallback((type: ActionType, user: User) => {
    setActionDialog({ open: true, type, user });
  }, []);

  const closeActionDialog = useCallback(() => {
    setActionDialog({ open: false, type: null, user: null });
  }, []);

  const handleAction = useCallback(async () => {
    if (!actionDialog.user || !actionDialog.type) return;

    try {
      switch (actionDialog.type) {
        case 'grant_founding':
          await adminApi.grantFoundingMember(actionDialog.user.id);
          toast.success('Success', {
            description: `Granted founding member access to ${actionDialog.user.email}`,
          });
          break;
        case 'grant_beta':
          await adminApi.grantBetaAccess(actionDialog.user.id, betaDays);
          toast.success('Success', {
            description: `Granted ${betaDays} days of free access to ${actionDialog.user.email}`,
          });
          break;
        case 'revoke_access':
          await adminApi.revokeAccess(actionDialog.user.id);
          toast.success('Success', {
            description: `Revoked access for ${actionDialog.user.email}`,
          });
          break;
        case 'make_admin':
          await adminApi.makeAdmin(actionDialog.user.id);
          toast.success('Success', {
            description: `Made ${actionDialog.user.email} an admin`,
          });
          break;
        case 'reset_data':
          await adminApi.resetUserData(actionDialog.user.id);
          toast.success('Data reset', {
            description: `Cleared stored data for ${actionDialog.user.email}`,
          });
          break;
        case 'block':
          await adminApi.blockUser(actionDialog.user.id);
          toast.success('Blocked', { description: `${actionDialog.user.email} is now blocked` });
          break;
        case 'unblock':
          await adminApi.unblockUser(actionDialog.user.id);
          toast.success('Unblocked', {
            description: `${actionDialog.user.email} can log in again`,
          });
          break;
      }

      await loadUsers();
      closeActionDialog();
    } catch {
      toast.error('Error', {
        description: 'Failed to perform action',
      });
    }
  }, [actionDialog, adminApi, betaDays, loadUsers, closeActionDialog]);

  const syncClerkUsers = useCallback(async () => {
    try {
      await adminApi.syncClerkUsers();
      await loadUsers();
      toast.success('Synced', { description: 'Clerk users synchronized' });
    } catch {
      toast.error('Error', {
        description: 'Failed to sync Clerk users',
      });
    }
  }, [adminApi, loadUsers]);

  const syncLemonSqueezy = useCallback(async () => {
    try {
      await adminApi.syncLemonSqueezy();
      await loadUsers();
      toast.success('Synced', { description: 'LemonSqueezy subscriptions refreshed' });
    } catch {
      toast.error('Error', {
        description: 'Failed to sync LemonSqueezy',
      });
    }
  }, [adminApi, loadUsers]);

  const copyUserId = useCallback((userId: string) => {
    void navigator.clipboard.writeText(userId);
    toast.success('Copied!', {
      description: 'User ID copied to clipboard',
    });
  }, []);

  return {
    loading,
    searchTerm,
    selectedUser,
    actionDialog,
    betaDays,
    filteredUsers,
    setSearchTerm,
    selectedUserDetails,
    detailsLoading,
    detailsError,
    setBetaDays,
    loadUsers,
    openUserDetails,
    closeUserDetails,
    openActionDialog,
    closeActionDialog,
    handleAction,
    syncClerkUsers,
    syncLemonSqueezy,
    copyUserId,
  };
}
