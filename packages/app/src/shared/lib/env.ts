interface ViteEnv {
  VITE_SELF_HOSTABLE?: string;
}

interface BudgeroFlags {
  selfHostable?: boolean;
  notify?: (payload: {
    title: string;
    body?: string;
    silent?: boolean;
  }) => Promise<{ ok?: boolean }>;
  loadDb?: (filename: string) => Promise<{
    ok: boolean;
    data?: ArrayBuffer;
    error?: string;
  }>;
  saveDb?: (
    filename: string,
    data: Uint8Array
  ) => Promise<{
    ok: boolean;
    error?: string;
  }>;
}

declare global {
  interface Window {
    budgero?: BudgeroFlags;
  }
}

interface ImportMetaWithEnv {
  env?: ViteEnv;
}

const META_ENV: ViteEnv =
  (typeof import.meta !== 'undefined' && (import.meta as unknown as ImportMetaWithEnv).env) || {};
const GLOBAL_FLAGS: BudgeroFlags = (typeof window !== 'undefined' && window.budgero) || {};

export const IS_SELF_HOSTABLE_BUILD =
  META_ENV?.VITE_SELF_HOSTABLE === 'true' || Boolean(GLOBAL_FLAGS?.selfHostable);
