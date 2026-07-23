// Routes that must stay reachable without an active plan — resubscribing,
// exporting data, and redeeming a workspace share code (/join) are exactly
// what a lapsed user needs to regain access.
const EXACT_RECOVERY_ROUTES = ['/subscription/success', '/join'] as const;

const RECOVERY_ROUTE_PREFIXES = [
  '/settings/subscription',
  '/settings/workspaces',
  '/settings/account',
  '/settings/data',
] as const;

export function isRecoveryRoute(pathname: string): boolean {
  return (
    (EXACT_RECOVERY_ROUTES as readonly string[]).includes(pathname) ||
    RECOVERY_ROUTE_PREFIXES.some((route) => pathname.startsWith(route))
  );
}

export function isDecryptionFailure(error: string): boolean {
  const normalized = error.toLowerCase();
  return normalized.includes('decryption failed') || normalized.includes('failed to decrypt');
}

export function isSecureContextFailure(error: string): boolean {
  return error.toLowerCase().includes('webcryptounavailable');
}
