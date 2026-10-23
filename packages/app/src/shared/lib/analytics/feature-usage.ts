import { track } from './track';

type Feature = 'reports' | 'rules' | 'recurring' | 'shared_budget' | 'multi_currency';

const ROUTE_FEATURES: readonly (readonly [RegExp, Feature])[] = [
  [/^\/reports(\/|$)/, 'reports'],
  [/^\/settings\/rules$/, 'rules'],
  [/^\/settings\/recurring$/, 'recurring'],
  [/^\/settings\/workspaces$/, 'shared_budget'],
  [/^\/settings\/currencies$/, 'multi_currency'],
];

/** The feature a route opens, if it is one we count. */
export function featureForPath(pathname: string): Feature | null {
  for (const [re, feature] of ROUTE_FEATURES) if (re.test(pathname)) return feature;
  return null;
}

/** feature_used {action: opened} for routes that open a counted feature. */
export function trackFeatureRoute(pathname: string): void {
  const feature = featureForPath(pathname);
  if (feature) track('feature_used', { feature, action: 'opened' });
}
