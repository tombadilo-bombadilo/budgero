interface ImportMetaWithEnv {
  env?: { VITE_API_BASE_URL?: string };
}

const HEALTH_ENDPOINT =
  (import.meta as unknown as ImportMetaWithEnv).env?.VITE_API_BASE_URL || '/api/v1';

function buildHealthUrl(): string {
  const base = HEALTH_ENDPOINT.endsWith('/health') ? HEALTH_ENDPOINT : `${HEALTH_ENDPOINT}/health`;
  return base.replace(/([^:]\/)\/+/g, '$1'); // collapse accidental double slashes
}

export async function checkApiHealth(timeoutMs = 3000): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(buildHealthUrl(), {
      method: 'HEAD',
      cache: 'no-store',
      signal: ctl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
