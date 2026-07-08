import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import SelfHostAdminUsers from '@pages/admin/SelfHostAdminUsers';
import { useAdminUsersState } from './useAdminUsersState';
import { AdminUsersHeader } from './AdminUsersHeader';
import { UserSearchCard } from './UserSearchCard';
import { UsersTable } from './UsersTable';
import { UserDetailsDialog } from './UserDetailsDialog';
import { ActionDialog } from './ActionDialog';

export default function AdminUsers() {
  // All hooks must be called before any early returns
  const {
    loading,
    searchTerm,
    selectedUser,
    selectedUserDetails,
    detailsLoading,
    detailsError,
    actionDialog,
    betaDays,
    filteredUsers,
    setSearchTerm,
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
  } = useAdminUsersState();

  // Early return for self-hostable build after all hooks
  if (IS_SELF_HOSTABLE_BUILD) {
    return <SelfHostAdminUsers />;
  }

  return (
    <div className="p-8 space-y-6">
      <AdminUsersHeader
        onSyncClerk={syncClerkUsers}
        onSyncLemonSqueezy={syncLemonSqueezy}
        onRefresh={loadUsers}
      />

      <UserSearchCard searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <UsersTable
        users={filteredUsers}
        loading={loading}
        onViewDetails={openUserDetails}
        onAction={openActionDialog}
        onCopyId={copyUserId}
      />

      <UserDetailsDialog
        user={selectedUser}
        details={selectedUserDetails}
        loading={detailsLoading}
        error={detailsError}
        onRetry={() => selectedUser && openUserDetails(selectedUser)}
        onClose={closeUserDetails}
        onAction={openActionDialog}
        onCopyId={copyUserId}
      />

      <ActionDialog
        dialog={actionDialog}
        betaDays={betaDays}
        onBetaDaysChange={setBetaDays}
        onConfirm={handleAction}
        onClose={closeActionDialog}
      />
    </div>
  );
}
