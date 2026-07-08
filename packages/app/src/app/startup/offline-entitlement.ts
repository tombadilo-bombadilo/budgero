import { useConnectivity } from '@shared/hooks/useConnectivity';
import { getConnectivityService } from '@shared/runtime/connectivity-service';

import { checkApiHealth } from '@shared/api/health';
import { SPACE_CACHE_STORAGE, fromBase64Url } from '@budgero/runtime';

import type { BudgetSpaceSummary } from '@shared/model/budget-spaces';

export const OFFLINE_BOOT_GRACE_MS = 1200;
export const OFFLINE_JWK_KEY = 'offline_pubkey_jwk_v1';
export const OFFLINE_ENTITLEMENT_KEY = 'offline_entitlement_token_v1';
export type ConnectivityMode = 'unknown' | 'online' | 'offline';

export type OfflineEntitlementClaims = {
  sub: string;
  iat: number;
  exp: number;
  ent: {
    founding: boolean;
    beta: boolean;
    beta_exp?: number;
    subscription: string;
    period_end?: number;
  };
};

export type Jwk = { kty: 'EC'; crv: 'P-256'; alg?: string; x: string; y: string };

export function readJSON<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function rawSigToDer(raw: Uint8Array): Uint8Array {
  function trimLeadingZeros(bytes: Uint8Array) {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i += 1;
    return bytes.slice(i);
  }

  function toDerInt(bytes: Uint8Array): Uint8Array {
    if (bytes[0] & 0x80) {
      const out = new Uint8Array(bytes.length + 1);
      out[0] = 0;
      out.set(bytes, 1);
      return out;
    }
    return bytes;
  }

  const r = raw.slice(0, raw.length / 2);
  const s = raw.slice(raw.length / 2);
  const rDer = toDerInt(trimLeadingZeros(r));
  const sDer = toDerInt(trimLeadingZeros(s));
  const totalLen = 2 + rDer.length + 2 + sDer.length;
  const der = new Uint8Array(2 + totalLen);
  let offset = 0;
  der[offset++] = 0x30;
  der[offset++] = totalLen;
  der[offset++] = 0x02;
  der[offset++] = rDer.length;
  der.set(rDer, offset);
  offset += rDer.length;
  der[offset++] = 0x02;
  der[offset++] = sDer.length;
  der.set(sDer, offset);
  return der;
}

async function importEs256Jwk(jwk: Jwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}

function parseJws(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [h, p, s] = parts;
  const header = JSON.parse(new TextDecoder().decode(fromBase64Url(h)));
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(p)));
  const signatureRaw = fromBase64Url(s);
  return { header, payload, signatureRaw, signingInput: `${h}.${p}` };
}

export async function verifyOfflineEntitlement(
  token: string,
  jwk: Jwk
): Promise<OfflineEntitlementClaims | null> {
  try {
    const { header, payload, signatureRaw, signingInput } = parseJws(token);
    if (header.alg !== 'ES256') return null;
    const key = await importEs256Jwk(jwk);
    const data = strToBytes(signingInput);

    let ok = false;
    try {
      ok = await crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        key,
        rawSigToDer(signatureRaw),
        data
      );
    } catch {
      /* no-op */
    }

    if (!ok) {
      try {
        ok = await crypto.subtle.verify(
          { name: 'ECDSA', hash: { name: 'SHA-256' } },
          key,
          signatureRaw,
          data
        );
      } catch {
        /* no-op */
      }
    }

    if (!ok) return null;

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    if (typeof payload.iat !== 'number' || payload.iat > now + 60) return null;

    return payload as OfflineEntitlementClaims;
  } catch {
    return null;
  }
}

export function subscriptionGrantsAccess(status?: string | null): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return (
    normalized === 'active' ||
    normalized === 'trialing' ||
    normalized === 'on_trial' ||
    normalized === 'lifetime'
  );
}

export function claimsGrantAccess(claims: OfflineEntitlementClaims): boolean {
  if (claims.ent.founding) return true;
  if (claims.ent.beta) {
    if (!claims.ent.beta_exp) return true;
    return claims.ent.beta_exp > Math.floor(Date.now() / 1000);
  }
  if (subscriptionGrantsAccess(claims.ent.subscription)) return true;
  if (
    (claims.ent.subscription === 'past_due' || claims.ent.subscription === 'cancelled') &&
    claims.ent.period_end
  ) {
    return claims.ent.period_end > Math.floor(Date.now() / 1000);
  }
  return false;
}

export function snapshotOnline(): boolean {
  const navigatorOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  try {
    const state = getConnectivityService().getState();
    if (state.lastChecked) {
      return state.overall || state.apiReachable;
    }
  } catch {
    /* no-op */
  }
  return navigatorOnline;
}

export function loadCachedSpaces(): BudgetSpaceSummary[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SPACE_CACHE_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BudgetSpaceSummary[]) : [];
  } catch {
    return [];
  }
}

export type SetupOnlineConnectivity = Pick<
  ReturnType<typeof useConnectivity>,
  'lastChecked' | 'selfHostable' | 'clerkToken' | 'apiReachable'
>;

export function deriveSetupOnline(
  state: SetupOnlineConnectivity | null | undefined
): boolean | null {
  if (!state || !state.lastChecked) return null;
  if (!state.selfHostable && !state.clerkToken) {
    return null;
  }
  const tokenReady = state.selfHostable ? true : state.clerkToken;
  return Boolean(tokenReady && state.apiReachable);
}

export async function isSetupOnlineSnapshot(
  connectivity?: SetupOnlineConnectivity
): Promise<boolean> {
  const derived = deriveSetupOnline(connectivity);
  if (derived !== null) return derived;

  try {
    return await checkApiHealth();
  } catch {
    return false;
  }
}
