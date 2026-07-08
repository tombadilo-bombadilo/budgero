/**
 * SimpleFIN Client
 * Handles authentication and data fetching from SimpleFIN Bridge
 * All operations are client-side only (zero-knowledge)
 * @see https://beta-bridge.simplefin.org/info/developers
 */

import type { SimpleFINAccountSet, SimpleFINCredentials } from './types';

/**
 * Decode a base64 setup token to get the claim URL
 */
export function decodeSetupToken(setupToken: string): string {
  try {
    const decoded = atob(setupToken.trim());
    if (!decoded.startsWith('http')) {
      throw new Error('Invalid setup token format');
    }
    return decoded;
  } catch {
    throw new Error('Failed to decode setup token. Make sure it is a valid base64 string.');
  }
}

/**
 * Exchange a setup token for an access URL
 * This can only be done ONCE per setup token
 * Done directly client-side (no server proxy)
 */
export async function claimSetupToken(setupToken: string): Promise<SimpleFINCredentials> {
  const claimUrl = decodeSetupToken(setupToken);

  const response = await fetch(claimUrl, {
    method: 'POST',
    mode: 'cors',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to claim token: ${error}`);
  }

  // Response is the access URL as plain text
  const accessUrl = (await response.text()).trim();
  if (!accessUrl || !accessUrl.startsWith('http')) {
    throw new Error('Invalid access URL received from SimpleFIN');
  }

  return {
    accessUrl,
    createdAt: Date.now(),
  };
}

/**
 * Fetch accounts and transactions from SimpleFIN
 * Done directly client-side (no server proxy)
 */
export async function fetchAccounts(
  accessUrl: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
    accountId?: string;
  }
): Promise<SimpleFINAccountSet> {
  const params = new URLSearchParams();

  if (options?.startDate) {
    params.set('start-date', Math.floor(options.startDate.getTime() / 1000).toString());
  }
  if (options?.endDate) {
    params.set('end-date', Math.floor(options.endDate.getTime() / 1000).toString());
  }
  if (options?.accountId) {
    params.set('account', options.accountId);
  }

  // Parse the access URL to extract credentials (format: https://user:pass@host/path)
  const parsedUrl = new URL(accessUrl);
  const { username } = parsedUrl;
  const { password } = parsedUrl;

  // Build URL without credentials
  parsedUrl.username = '';
  parsedUrl.password = '';
  const cleanUrl = new URL(`${parsedUrl.toString()}/accounts`);
  if (params.toString()) {
    cleanUrl.search = params.toString();
  }

  // Use Authorization header for Basic auth
  const authHeader = `Basic ${btoa(`${username}:${password}`)}`;

  const response = await fetch(cleanUrl.toString(), {
    method: 'GET',
    mode: 'cors',
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch accounts: ${error}`);
  }

  return response.json();
}

/**
 * Parse the access URL to extract credentials for display (masked)
 */
export function parseAccessUrl(
  accessUrl: string
): { scheme: string; username: string; host: string } | null {
  try {
    const url = new URL(accessUrl);
    return {
      scheme: url.protocol.replace(':', ''),
      username: url.username ? `${url.username.slice(0, 4)}****` : '',
      host: url.host,
    };
  } catch {
    return null;
  }
}
