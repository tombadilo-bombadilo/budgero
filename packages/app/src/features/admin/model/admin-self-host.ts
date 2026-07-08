export interface SelfHostRecentUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface SelfHostAdminStats {
  mode: string;
  databasePath: string;
  databaseSizeBytes: number;
  databaseLastModified?: string;
  totalUsers: number;
  adminUsers: number;
  localAccounts: number;
  masterPasswordUsers: number;
  spaceCount: number;
  spacesWithMembers: number;
  totalMemberships: number;
  spaceBlobBytes: number;
  pendingInvites: number;
  recentUsers: SelfHostRecentUser[];
}

export interface SelfHostAdminUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastLoginAt?: string;
  hasLocalPassword: boolean;
  isAdmin: boolean;
  isBlocked: boolean;
  isMasterPasswordSet: boolean;
  spaceMembershipCount: number;
  ownedSpaceCount: number;
}
