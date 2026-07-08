import type { User } from './auth';

export enum AccessLevel {
  NONE = 'none',
  BETA = 'beta',
  TRIAL = 'trial',
  SUBSCRIBER = 'subscriber',
  FOUNDING_MEMBER = 'founding_member',
  COLLABORATOR = 'collaborator',
  ADMIN = 'admin',
}

export interface AccessStatus {
  level: AccessLevel;
  isActive: boolean;
  expiresAt?: Date | null;
  details: {
    isAdmin: boolean;
    isFoundingMember: boolean;
    hasBetaAccess: boolean;
    hasActiveSubscription: boolean;
    subscriptionStatus?: string;
    trialEndsAt?: Date | null;
    betaExpiresAt?: Date | null;
    subscriptionEndsAt?: Date | null;
    currentPeriodEnd?: Date | null;
    canAccessOwnedWorkspaces: boolean;
    canAccessSharedWorkspaces: boolean;
    canCreateWorkspace: boolean;
    hasAccessibleWorkspace: boolean;
    hasLockedSharedWorkspace: boolean;
  };
}

function mapAccessLevel(value?: User['access_level']): AccessLevel {
  switch (value) {
    case 'admin':
      return AccessLevel.ADMIN;
    case 'founding_member':
      return AccessLevel.FOUNDING_MEMBER;
    case 'beta':
      return AccessLevel.BETA;
    case 'trial':
      return AccessLevel.TRIAL;
    case 'subscriber':
      return AccessLevel.SUBSCRIBER;
    case 'collaborator':
      return AccessLevel.COLLABORATOR;
    case 'none':
      return AccessLevel.NONE;
    default:
      return AccessLevel.NONE;
  }
}

function buildAccessStatus(
  user: User,
  level: AccessLevel,
  isActive: boolean,
  expiresAt: Date | null
): AccessStatus {
  return {
    level,
    isActive,
    expiresAt,
    details: {
      isAdmin: user.is_admin || false,
      isFoundingMember: user.is_founding_member || false,
      hasBetaAccess: user.has_beta_access || false,
      hasActiveSubscription:
        level === AccessLevel.ADMIN ||
        level === AccessLevel.FOUNDING_MEMBER ||
        level === AccessLevel.BETA ||
        level === AccessLevel.TRIAL ||
        level === AccessLevel.SUBSCRIBER,
      subscriptionStatus: user.subscription_status,
      trialEndsAt: user.trial_ends_at ? new Date(user.trial_ends_at) : null,
      betaExpiresAt: user.beta_expires_at ? new Date(user.beta_expires_at) : null,
      subscriptionEndsAt: user.subscription_ends_at ? new Date(user.subscription_ends_at) : null,
      currentPeriodEnd: user.current_period_end ? new Date(user.current_period_end) : null,
      canAccessOwnedWorkspaces: user.can_access_owned_workspaces ?? false,
      canAccessSharedWorkspaces: user.can_access_shared_workspaces ?? false,
      canCreateWorkspace: user.can_create_workspace ?? false,
      hasAccessibleWorkspace: user.has_accessible_workspace ?? false,
      hasLockedSharedWorkspace: user.has_locked_shared_workspace ?? false,
    },
  };
}

function hasCanonicalAccessFields(user: User): boolean {
  return (
    typeof user.access_level === 'string' &&
    typeof user.can_access_owned_workspaces === 'boolean' &&
    typeof user.can_access_shared_workspaces === 'boolean' &&
    typeof user.can_create_workspace === 'boolean' &&
    typeof user.has_accessible_workspace === 'boolean' &&
    typeof user.has_locked_shared_workspace === 'boolean'
  );
}

export function getUserAccessStatus(user: User): AccessStatus {
  const now = new Date();

  if (hasCanonicalAccessFields(user)) {
    const level = mapAccessLevel(user.access_level);
    const expiresAt =
      user.trial_ends_at != null
        ? new Date(user.trial_ends_at)
        : user.subscription_ends_at != null
          ? new Date(user.subscription_ends_at)
          : user.current_period_end != null
            ? new Date(user.current_period_end)
            : user.beta_expires_at != null
              ? new Date(user.beta_expires_at)
              : null;
    return buildAccessStatus(user, level, level !== AccessLevel.NONE, expiresAt);
  }

  const status = user.subscription_status?.trim().toLowerCase() || 'inactive';

  if (user.is_admin) {
    return buildAccessStatus(user, AccessLevel.ADMIN, true, null);
  }

  if (user.is_founding_member || status === 'lifetime') {
    return buildAccessStatus(user, AccessLevel.FOUNDING_MEMBER, true, null);
  }

  if (user.has_beta_access) {
    const betaExpiry = user.beta_expires_at ? new Date(user.beta_expires_at) : null;
    const isActive = !betaExpiry || betaExpiry > now;
    return buildAccessStatus(user, AccessLevel.BETA, isActive, betaExpiry);
  }

  if (status === 'trialing' || status === 'on_trial') {
    const trialEnd = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
    const isActive = !!trialEnd && trialEnd > now;
    return buildAccessStatus(user, AccessLevel.TRIAL, isActive, trialEnd);
  }

  if (status === 'active') {
    const periodEnd = user.current_period_end ? new Date(user.current_period_end) : null;
    const isActive = !periodEnd || periodEnd > now;
    return buildAccessStatus(user, AccessLevel.SUBSCRIBER, isActive, periodEnd);
  }

  if (status === 'past_due') {
    const periodEnd = user.current_period_end ? new Date(user.current_period_end) : null;
    const isActive = periodEnd !== null && periodEnd > now;
    if (isActive) {
      return buildAccessStatus(user, AccessLevel.SUBSCRIBER, true, periodEnd);
    }
  }

  if (status === 'cancelled') {
    const endDate = user.subscription_ends_at ? new Date(user.subscription_ends_at) : null;
    const isActive = endDate !== null && endDate > now;
    if (isActive) {
      return buildAccessStatus(user, AccessLevel.SUBSCRIBER, true, endDate);
    }
  }

  if (user.has_collaboration_access) {
    return buildAccessStatus(user, AccessLevel.COLLABORATOR, true, null);
  }

  return buildAccessStatus(user, AccessLevel.NONE, false, null);
}

export function canAccessApp(accessStatus: AccessStatus): boolean {
  return accessStatus.isActive;
}

export function canAccessAdmin(accessStatus: AccessStatus): boolean {
  return accessStatus.details.isAdmin;
}

export function canCreateWorkspace(accessStatus: AccessStatus | null | undefined): boolean {
  if (!accessStatus) return false;
  return accessStatus.details.canCreateWorkspace;
}

export function hasLockedSharedWorkspace(accessStatus: AccessStatus | null | undefined): boolean {
  if (!accessStatus) return false;
  return accessStatus.details.hasLockedSharedWorkspace;
}

export function getAccessLevelDisplay(level: AccessLevel): string {
  switch (level) {
    case AccessLevel.ADMIN:
      return 'Administrator';
    case AccessLevel.FOUNDING_MEMBER:
      return 'Founding Member';
    case AccessLevel.SUBSCRIBER:
      return 'Subscriber';
    case AccessLevel.TRIAL:
      return 'Trial User';
    case AccessLevel.BETA:
      return 'Beta Tester';
    case AccessLevel.COLLABORATOR:
      return 'Collaborator';
    case AccessLevel.NONE:
      return 'No Access';
    default:
      return 'Unknown';
  }
}

export function getAccessLevelBadgeColor(level: AccessLevel): string {
  switch (level) {
    case AccessLevel.ADMIN:
      return 'bg-purple-500';
    case AccessLevel.FOUNDING_MEMBER:
      return 'bg-gradient-to-r from-amber-500 to-orange-500';
    case AccessLevel.SUBSCRIBER:
      return 'bg-green-500';
    case AccessLevel.TRIAL:
      return 'bg-blue-500';
    case AccessLevel.BETA:
      return 'bg-indigo-500';
    case AccessLevel.COLLABORATOR:
      return 'bg-amber-500';
    case AccessLevel.NONE:
      return 'bg-gray-500';
    default:
      return 'bg-gray-400';
  }
}
