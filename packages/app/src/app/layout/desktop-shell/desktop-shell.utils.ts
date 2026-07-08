import { capitalize } from '@shared/lib/utils';
import { BREADCRUMB_LABEL_MAP } from './constants';
import type { BreadcrumbItem } from './types';

/**
 * Generates a human-readable label for a URL segment
 */
export function getLabelForSegment(segment: string): string {
  if (BREADCRUMB_LABEL_MAP[segment]) {
    return BREADCRUMB_LABEL_MAP[segment];
  }
  // If segment is a number (like account ID), show "Details"
  if (!Number.isNaN(Number(segment))) {
    return 'Details';
  }
  return capitalize(segment);
}

/**
 * Generates breadcrumb items from a pathname
 */
export function generateBreadcrumbs(
  pathname: string,
  options?: { labelOverridesByHref?: Record<string, string> }
): BreadcrumbItem[] {
  const path = pathname.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  const labelOverridesByHref = options?.labelOverridesByHref ?? {};

  const crumbs: BreadcrumbItem[] = [];
  let acc = '';

  for (let i = 0; i < segments.length; i++) {
    acc += `/${segments[i]}`;
    const last = i === segments.length - 1;
    const label = labelOverridesByHref[acc] ?? getLabelForSegment(segments[i]);
    crumbs.push({ href: acc || '/', label, last });
  }

  if (crumbs.length === 0) {
    return [{ href: '/dashboard', label: 'Dashboard', last: true }];
  }

  return crumbs;
}

/**
 * Triggers the command palette by dispatching a keyboard event
 */
export function triggerCommandPalette(): void {
  const event = new KeyboardEvent('keydown', {
    key: 'k',
    ctrlKey: true,
    metaKey: true,
    bubbles: true,
  });
  document.dispatchEvent(event);
}

/**
 * Opens the Add Transaction dialog by replaying the Cmd/Ctrl+Alt+T shortcut the
 * command palette already listens for (mirrors triggerCommandPalette). The
 * dialog state lives inside CommandPalette, so this lets any chrome — e.g. a
 * header button — open it without lifting that state.
 */
export function triggerAddTransaction(): void {
  const event = new KeyboardEvent('keydown', {
    code: 'KeyT',
    key: 't',
    ctrlKey: true,
    metaKey: true,
    altKey: true,
    bubbles: true,
  });
  document.dispatchEvent(event);
}
