import { describe, expect, it } from 'vitest';

import { AccessLevel, getUserAccessStatus } from './access';
import type { User } from './auth';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user_1',
    name: 'Test User',
    email: 'test@example.com',
    is_master_password_set: true,
    current_db_hash: '',
    sync_version: 1,
    created_at: new Date().toISOString(),
    subscription_status: 'inactive',
    has_beta_access: false,
    is_founding_member: false,
    has_collaboration_access: false,
    ...overrides,
  };
}

describe('getUserAccessStatus', () => {
  it('uses canonical server access fields when provided', () => {
    const access = getUserAccessStatus(
      makeUser({
        access_level: 'none',
        can_access_owned_workspaces: false,
        can_access_shared_workspaces: false,
        can_create_workspace: false,
        has_accessible_workspace: false,
        has_locked_shared_workspace: true,
      })
    );

    expect(access.level).toBe(AccessLevel.NONE);
    expect(access.isActive).toBe(false);
    expect(access.details.hasLockedSharedWorkspace).toBe(true);
    expect(access.details.canCreateWorkspace).toBe(false);
  });

  it('returns collaborator access for inactive users with collaboration access when canonical fields are missing', () => {
    const access = getUserAccessStatus(
      makeUser({
        subscription_status: 'inactive',
        has_collaboration_access: true,
      })
    );

    expect(access.level).toBe(AccessLevel.COLLABORATOR);
    expect(access.isActive).toBe(true);
    expect(access.details.subscriptionStatus).toBe('inactive');
  });

  it('returns founding access for inactive users with founding flag', () => {
    const access = getUserAccessStatus(
      makeUser({
        subscription_status: 'inactive',
        is_founding_member: true,
      })
    );

    expect(access.level).toBe(AccessLevel.FOUNDING_MEMBER);
    expect(access.isActive).toBe(true);
    expect(access.details.isFoundingMember).toBe(true);
  });

  it('returns collaborator access from canonical fields for active shared-only users', () => {
    const access = getUserAccessStatus(
      makeUser({
        access_level: 'collaborator',
        can_access_owned_workspaces: false,
        can_access_shared_workspaces: true,
        can_create_workspace: false,
        has_accessible_workspace: true,
        has_locked_shared_workspace: false,
      })
    );

    expect(access.level).toBe(AccessLevel.COLLABORATOR);
    expect(access.isActive).toBe(true);
    expect(access.details.canAccessSharedWorkspaces).toBe(true);
  });
});
