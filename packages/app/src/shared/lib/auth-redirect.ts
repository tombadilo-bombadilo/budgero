/**
 * Build the `/auth` redirect URL that returns the user to where they were
 * after signing in, e.g. `/auth?mode=signin&next=%2Fdashboard`.
 */
export function buildAuthRedirect(
  location: { pathname: string; search: string },
  { mode }: { mode?: 'signin' } = {}
): string {
  const next = encodeURIComponent(location.pathname + location.search);
  return mode ? `/auth?mode=${mode}&next=${next}` : `/auth?next=${next}`;
}
