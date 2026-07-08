import { Badge } from '@shared/ui/badge';
import { format, parseISO } from 'date-fns';
import {
  getUserAccessStatus,
  getAccessLevelDisplay,
  getAccessLevelBadgeColor,
} from '@shared/model/access';
import type { User as AuthUser } from '@shared/model/auth';
import type { User } from '@features/admin/model/admin-users';

/** Format an ISO date string as e.g. "Jan 5, 2026"; em dash when missing. */
export function formatShortDate(value?: string | null) {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'MMM d, yyyy');
  } catch {
    return value;
  }
}

export function getStatusBadge(user: User) {
  const accessStatus = getUserAccessStatus(user as unknown as AuthUser);
  const color = getAccessLevelBadgeColor(accessStatus.level);

  return (
    <Badge className={`${color} text-white`}>{getAccessLevelDisplay(accessStatus.level)}</Badge>
  );
}

export function getSubscriptionInfo(user: User) {
  if (user.is_founding_member) {
    return <span className="text-xs text-orange-600">Lifetime access</span>;
  }
  if (user.has_beta_access && user.beta_expires_at) {
    return (
      <span className="text-xs text-indigo-600">
        Free access until {formatShortDate(user.beta_expires_at)}
      </span>
    );
  }
  if (user.subscription_status === 'active' && user.current_period_end) {
    return (
      <span className="text-xs text-green-600">
        Renews {formatShortDate(user.current_period_end)}
      </span>
    );
  }
  if (
    (user.subscription_status === 'trialing' || user.subscription_status === 'on_trial') &&
    user.trial_ends_at
  ) {
    return (
      <span className="text-xs text-blue-600">
        Trial until {formatShortDate(user.trial_ends_at)}
      </span>
    );
  }
  if (user.subscription_status === 'cancelled' && user.subscription_ends_at) {
    return (
      <span className="text-xs text-red-600">
        Cancelled, ends {formatShortDate(user.subscription_ends_at)}
      </span>
    );
  }
  return <span className="text-xs text-gray-500">No active subscription</span>;
}

/** Case-insensitive match of a (trimmed) search term against a user's name, email, or id. */
export function matchesUserSearch(
  user: { name: string; email: string; id: string },
  searchTerm: string
): boolean {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return true;
  return [user.name, user.email, user.id].some((value) => value.toLowerCase().includes(term));
}

export function filterUsers(users: User[], searchTerm: string): User[] {
  return users.filter((user) => matchesUserSearch(user, searchTerm));
}
