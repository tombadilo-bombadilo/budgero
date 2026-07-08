const RECOVERY_ROUTE_PREFIXES = [
  '/subscription/success',
  '/settings/subscription',
  '/settings/workspaces',
  '/settings/account',
  '/settings/data',
] as const;

export function isRecoveryRoute(pathname: string): boolean {
  return RECOVERY_ROUTE_PREFIXES.some((route) =>
    route === '/subscription/success' ? pathname === route : pathname.startsWith(route)
  );
}

export function isDecryptionFailure(error: string): boolean {
  const normalized = error.toLowerCase();
  return normalized.includes('decryption failed') || normalized.includes('failed to decrypt');
}

export function isSecureContextFailure(error: string): boolean {
  return error.toLowerCase().includes('webcryptounavailable');
}
