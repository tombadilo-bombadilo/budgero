import type { AppConfig } from '@shared/model/auth';
import type {
  BudgetSpaceSummary,
  BudgetSpaceMember,
  BudgetSpaceInvite,
  SpaceInviteInspection,
} from '@shared/model/budget-spaces';
import { MUTATION_FORMAT_VERSION, SYNC_PROTOCOL_VERSION } from '@budgero/runtime';
import { getGlobalToken } from '@shared/lib/clerk-token-manager';
import { notifyUpdateRequired } from '@shared/lib/update-required';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { useSelfHostAuth } from '@shared/model/useSelfHostAuth';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
  }

  private handleUnauthorized(status: number, endpoint: string): void {
    if (!IS_SELF_HOSTABLE_BUILD) return;
    if (status !== 401) return;
    // A 401 from the auth endpoints means bad credentials, not a stale
    // session — let the form show the error instead of reloading.
    if (endpoint.startsWith('/auth/local/')) return;
    try {
      useSelfHostAuth.getState().clearSession();
    } catch {
      /* no-op */
    }
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }

  /**
   * Performs a fetch with timeout-based abort, validates the response status
   * (rethrowing ApiError on non-2xx), and normalizes network/timeout/abort
   * failures into ApiError. Callers are responsible for parsing the response
   * body. The provided `buildConfig` receives the timeout abort signal and the
   * resolved auth token so each caller can assemble its own request config.
   * `timeoutMs <= 0` disables the timeout entirely, for calls known to
   * plausibly run long (admin ad-hoc SQL, full-database downloads).
   */
  private async rawFetch(
    endpoint: string,
    timeoutMs: number,
    buildConfig: (signal: AbortSignal, token: string | null) => RequestInit
  ): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;

    const token = await getGlobalToken();

    const controller = new AbortController();
    const timeoutId =
      timeoutMs > 0
        ? setTimeout(() => {
            controller.abort();
          }, timeoutMs)
        : null;

    const config = buildConfig(controller.signal, token);

    try {
      const response = await fetch(url, config);
      if (timeoutId !== null) clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 401) {
          this.handleUnauthorized(response.status, endpoint);
        }
        if (response.status === 426) {
          // Server refused to sync: this build doesn't understand the
          // space's data format. Surface the blocking update prompt.
          notifyUpdateRequired('server-426');
        }
        const errorText = await response.text();
        throw new ApiError(errorText || `HTTP ${response.status}`, response.status, errorText);
      }

      return response;
    } catch (error) {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (error instanceof ApiError) {
        if (error.status === 401) {
          this.handleUnauthorized(error.status, endpoint);
        }
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError('Request timeout', 0, 'timeout');
      }

      throw new ApiError(`Network error: ${error}`, 0);
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = 15000
  ): Promise<T> {
    const response = await this.rawFetch(endpoint, timeoutMs, (signal, token) => ({
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
      signal,
      ...options,
    }));

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }

    return {} as T;
  }

  // HTTP methods. `timeoutMs` defaults to 15s; pass 0 to disable for calls
  // known to plausibly run longer (e.g. ad-hoc admin SQL).
  async get<T>(endpoint: string, timeoutMs?: number): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' }, timeoutMs);
  }

  async post<T>(endpoint: string, data?: unknown, timeoutMs?: number): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'POST',
        body: data ? JSON.stringify(data) : undefined,
      },
      timeoutMs
    );
  }

  async put<T>(endpoint: string, data?: unknown, timeoutMs?: number): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'PUT',
        body: data ? JSON.stringify(data) : undefined,
      },
      timeoutMs
    );
  }

  async delete<T>(endpoint: string, timeoutMs?: number): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' }, timeoutMs);
  }

  async uploadBinary<T>(
    endpoint: string,
    data: Uint8Array,
    headers?: Record<string, string>,
    timeoutMs = 30000
  ): Promise<T> {
    const response = await this.rawFetch(endpoint, timeoutMs, (signal, token) => ({
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: data,
      signal,
    }));

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }

    return {} as T;
  }

  async downloadBinary(
    endpoint: string,
    headers?: Record<string, string>,
    timeoutMs = 30000
  ): Promise<{ data: Uint8Array; headers: Headers }> {
    const response = await this.rawFetch(endpoint, timeoutMs, (signal, token) => ({
      method: 'GET',
      cache: 'no-store',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      signal,
    }));

    const arrayBuffer = await response.arrayBuffer();
    return {
      data: new Uint8Array(arrayBuffer),
      headers: response.headers,
    };
  }
}

export const apiClient = new ApiClient();

// Authentication API (profile endpoints only - no more login/register)
export const authApi = {
  getProfile: () => apiClient.get<unknown>('/profile'),
  recordActivityHeartbeat: () => apiClient.post<void>('/profile/activity/heartbeat'),
  updateProfile: (name: string, email: string) =>
    apiClient.put<unknown>('/profile', { name, email }),
  setMasterPasswordStatus: (isSet: boolean) =>
    apiClient.put<{ success: boolean; is_master_password_set: boolean }>(
      '/profile/master-password',
      { is_set: isSet }
    ),
  resetMasterPassword: () => apiClient.post<{ success: boolean }>('/profile/master-password/reset'),
  updateOnboarding: (payload: { status: string; snoozed_until?: string | null }) =>
    apiClient.post('/profile/onboarding', payload),
};

export const subscriptionApi = {
  getStatus: () =>
    apiClient.get<{
      subscription_status: string;
      subscription_id?: string;
      customer_id?: string;
      variant_id?: string;
      trial_ends_at?: string;
      subscription_ends_at?: string;
      current_period_end?: string;
    }>('/subscription/status'),
  getPlans: () =>
    apiClient.get<{
      plans: {
        id: string;
        name: string;
        description: string;
        price: number;
        price_formatted: string;
        interval: string;
        interval_count: number;
      }[];
    }>('/subscription/plans'),
  createCheckout: (variantId: string, discountCode?: string) =>
    apiClient.post<{ url: string }>('/subscription/checkout', {
      variant_id: variantId,
      ...(discountCode ? { discount_code: discountCode } : {}),
    }),
  getCustomerPortal: () => apiClient.get<{ url: string }>('/subscription/portal'),
  cancelSubscription: () => apiClient.post<{ message: string }>('/subscription/cancel'),
  resumeSubscription: () => apiClient.post<{ message: string }>('/subscription/resume'),
  updatePlan: (variantId: string) =>
    apiClient.post<{ message: string }>('/subscription/update', { variant_id: variantId }),
  getInvoices: () =>
    apiClient.get<{
      invoices: {
        id: string;
        status: string;
        status_formatted: string;
        total: number;
        total_formatted: string;
        created_at: string;
        updated_at: string;
        refunded_at?: string;
        invoice_url: string;
      }[];
    }>('/subscription/invoices'),
  getDetails: () =>
    apiClient.get<{
      subscription: {
        id: string;
        status: string;
        variant_id: string;
        variant_name?: string;
        product_name?: string;
        price_cents?: number;
        price_formatted?: string;
        interval?: string;
        interval_count?: number;
        current_period_end?: string;
        trial_ends_at?: string;
        ends_at?: string;
        renews_at?: string;
        card_brand?: string;
        card_last_four?: string;
        customer_portal_url?: string;
        update_payment_method_url?: string;
        latest_invoice?: {
          id: string;
          subscription_id?: number;
          billing_reason?: string;
          status: string;
          status_formatted?: string;
          card_brand?: string;
          card_last_four?: string;
          currency?: string;
          currency_rate?: string;
          subtotal?: number;
          subtotal_formatted?: string;
          discount_total?: number;
          discount_total_formatted?: string;
          tax?: number;
          tax_formatted?: string;
          total: number;
          total_formatted: string;
          invoice_url?: string;
          created_at?: string;
          updated_at?: string;
          refunded?: boolean;
          refunded_at?: string;
          test_mode?: boolean;
        } | null;
        upcoming_invoice?: {
          id: string;
          subscription_id?: number;
          billing_reason?: string;
          status: string;
          status_formatted?: string;
          card_brand?: string;
          card_last_four?: string;
          currency?: string;
          currency_rate?: string;
          subtotal?: number;
          subtotal_formatted?: string;
          discount_total?: number;
          discount_total_formatted?: string;
          tax?: number;
          tax_formatted?: string;
          total: number;
          total_formatted: string;
          invoice_url?: string;
          created_at?: string;
          updated_at?: string;
          refunded?: boolean;
          refunded_at?: string;
          test_mode?: boolean;
        } | null;
      } | null;
    }>('/subscription/details'),
};

export const blobApi = {
  // Get lightweight sync state (version/hash) for a space
  getState: async (
    spaceId: string
  ): Promise<{
    version: number;
    hash?: string;
    space_id?: string;
    mutation_version?: number;
  } | null> => {
    try {
      return await apiClient.get<{
        version: number;
        hash?: string;
        space_id?: string;
        mutation_version?: number;
      }>(`/database/state?space_id=${encodeURIComponent(spaceId)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },

  downloadBlob: async (spaceId: string): Promise<{ data: Uint8Array; headers: Headers } | null> => {
    try {
      return await apiClient.downloadBinary(
        `/database/blob?space_id=${encodeURIComponent(spaceId)}`,
        { 'X-Budgero-Protocol': String(SYNC_PROTOCOL_VERSION) }
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // No blob exists yet - this is fine for new users
        return null;
      }
      throw error;
    }
  },

  uploadBlob: (
    spaceId: string,
    data: Uint8Array,
    version?: number,
    keyVersion?: number,
    mutationVersion?: number,
    outOfBand?: boolean
  ) => {
    const headers: Record<string, string> = {
      // Declares both what we write and what we understand; the server
      // gates stale clients off newer-format spaces with 426 responses.
      'X-Data-Format-Version': String(MUTATION_FORMAT_VERSION),
      'X-Budgero-Protocol': String(SYNC_PROTOCOL_VERSION),
    };
    if (version !== undefined) {
      headers['X-Database-Version'] = version.toString();
    }
    if (keyVersion !== undefined) {
      headers['X-Encryption-Key-Version'] = keyVersion.toString();
    }
    if (mutationVersion !== undefined) {
      // Binds the blob to its mutation-log position: fresh devices restore
      // the blob and replay the log from exactly here.
      headers['X-Mutation-Version'] = mutationVersion.toString();
    }
    if (outOfBand) {
      // Content not covered by the mutation log (import/restore): the server
      // relays this to other connected clients so they download the blob.
      headers['X-Out-Of-Band'] = '1';
    }
    return apiClient.uploadBinary<{ version: number; hash: string }>(
      `/database/blob?space_id=${encodeURIComponent(spaceId)}`,
      data,
      headers
    );
  },
};

export const spaceApi = {
  listSpaces: () => apiClient.get<BudgetSpaceSummary[]>('/budget-spaces'),
  createSpace: (displayName: string) =>
    apiClient.post<BudgetSpaceSummary>('/budget-spaces', { display_name: displayName }),
  deleteSpace: (spaceId: string) =>
    apiClient.delete<{ success: boolean }>(`/budget-spaces/${spaceId}`),
  updateSpace: (spaceId: string, payload: { display_name?: string }) =>
    apiClient.put(`/budget-spaces/${spaceId}`, payload),
  listMembers: (spaceId: string) =>
    apiClient.get<BudgetSpaceMember[]>(`/budget-spaces/${spaceId}/members`),
  removeMember: (spaceId: string, memberId: string) =>
    apiClient.delete(`/budget-spaces/${spaceId}/members/${memberId}`),
  listInvites: (spaceId: string) =>
    apiClient.get<BudgetSpaceInvite[]>(`/budget-spaces/${spaceId}/invites`),
  createInvite: (spaceId: string, email: string, inviteSecretHash: string, expiresAt?: string) =>
    apiClient.post<BudgetSpaceInvite>(`/budget-spaces/${spaceId}/invites`, {
      email,
      invite_secret: inviteSecretHash,
      expires_at: expiresAt,
    }),
  cancelInvite: (spaceId: string, inviteId: string) =>
    apiClient.delete(`/budget-spaces/${spaceId}/invites/${inviteId}`),
  attachInviteBundle: (spaceId: string, inviteId: string, encryptedBundle: string) =>
    apiClient.put(`/budget-spaces/${spaceId}/invites/${inviteId}/bundle`, {
      encrypted_bundle: encryptedBundle,
    }),
  updateEncryptedKey: (spaceId: string, encryptedSpaceKey: string) =>
    apiClient.put(`/budget-spaces/${spaceId}/members/me/encrypted-key`, {
      encrypted_space_key: encryptedSpaceKey,
    }),
  // NOTE: incrementEncryptionKeyVersion moved to WebSocket for proper sender exclusion
  inspectInvite: (inviteSecret: string) =>
    apiClient.post<SpaceInviteInspection>(`/budget-space-invites/inspect`, {
      invite_secret: inviteSecret,
    }),
  redeemInvite: (inviteSecret: string, encryptedSpaceKey: string) =>
    apiClient.post<BudgetSpaceSummary>(`/budget-space-invites/redeem`, {
      invite_secret: inviteSecret,
      encrypted_space_key: encryptedSpaceKey,
    }),
};

// App config + newsletter API. (The beta invite-code redemption methods were
// removed when the beta program ended; admin-granted free access lives under
// the admin API.)
export const betaApi = {
  getConfig: () => apiClient.get<AppConfig>('/config'),

  subscribeNewsletter: (email: string, name?: string) =>
    apiClient.post<{ success: boolean; message: string }>('/newsletter/subscribe', { email, name }),
};

export interface TrialProgress {
  user_id: string;
  trial_started_at: string;
  daily_logging_distinct_days: number;
  reconciliation_count: number;
  first_reconciliation_at?: string;
  second_reconciliation_at?: string;
  budget_cycle_assigned_at?: string;
  overspend_covered_at?: string;
  goal_funded_at?: string;
  rule_applied_historical_at?: string;
  monthly_review_at?: string;
  tier1_unlocked_at?: string;
  tier2_unlocked_at?: string;
  tier3_unlocked_at?: string;
  updated_at: string;
}

export interface TrialDiscountCode {
  code: string;
  user_id: string;
  tier: 1 | 2 | 3;
  percent_off: number;
  generated_at: string;
  valid_from: string;
  valid_until: string;
  redeemed_at?: string;
}

export interface TrialTier {
  tier: 1 | 2 | 3;
  percent_off: number;
  name: string;
}

export interface TrialProgressCounts {
  assignment_distinct_months: number;
  transaction_distinct_months: number;
  /** Total transactions logged — drives Tier 1 progress ("X/5"). */
  transaction_count: number;
}

export interface TrialProgressResponse {
  progress: TrialProgress | null;
  codes: TrialDiscountCode[];
  tiers: TrialTier[];
  counts: TrialProgressCounts;
}

export interface TrialValidateCodeResponse {
  code: string;
  tier: 1 | 2 | 3;
  percent_off: number;
  valid_until: string;
}

export const trialApi = {
  getProgress: () => apiClient.get<TrialProgressResponse>('/trial/progress'),
  validateCode: (code: string) =>
    apiClient.post<TrialValidateCodeResponse>('/trial/codes/validate', { code }),
  // Dev-only — server gates these behind DEV_TOOLS_ENABLED.
  devForceUnlock: (tier: 1 | 2 | 3) => apiClient.post<void>('/trial/dev/unlock', { tier }),
  devReset: () => apiClient.post<void>('/trial/dev/reset'),
};

export const offlineApi = {
  getPubKey: () =>
    apiClient.get<{ kty: string; crv: string; alg: string; x: string; y: string }>(
      '/offline/pubkey'
    ),
  issueEntitlement: () => apiClient.post<{ token: string }>('/offline/entitlement'),
};

export interface PushTokenResponse {
  token: string;
  space_id: string;
  created_at: string;
  is_enabled: boolean;
}

export interface PushTokenStatus {
  has_token: boolean;
  space_id?: string;
  created_at?: string;
  last_used?: string;
  is_enabled: boolean;
}

export interface PushQueueItem {
  id: string;
  user_id: string;
  space_id: string;
  encrypted_payload: string;
  status: 'pending' | 'processed' | 'failed';
  created_at: string;
  processed_at?: string;
}

export interface PushQueueResponse {
  items: PushQueueItem[];
  count: number;
}

export interface PushQueueStats {
  pending: number;
  processed: number;
  failed: number;
  total: number;
}

export interface PushEncryptionInfo {
  space_id: string;
  has_token: boolean;
  info: {
    algorithm: string;
    key_derivation: string;
    payload_format: string;
    encoding: string;
    supported_opcodes: string;
  };
}

export const pushApi = {
  generateToken: () => apiClient.post<PushTokenResponse>('/push/token'),

  getTokenStatus: () => apiClient.get<PushTokenStatus>('/push/token'),

  toggleToken: (enabled: boolean) =>
    apiClient.put<{ enabled: boolean }>('/push/token', { enabled }),

  revokeToken: () => apiClient.delete<{ status: string }>('/push/token'),

  // Get pending items from the push queue
  getQueue: (spaceId?: string) => {
    const query = spaceId ? `?space_id=${encodeURIComponent(spaceId)}` : '';
    return apiClient.get<PushQueueResponse>(`/push/queue${query}`);
  },

  ackQueueItem: (id: string, status: 'processed' | 'failed' = 'processed') =>
    apiClient.put<{ id: string; status: string }>(`/push/queue/${id}`, { status }),

  getStats: () => apiClient.get<PushQueueStats>('/push/stats'),

  clearQueue: (opts?: { all?: boolean }) => {
    const qs = opts?.all ? '?all=1' : '';
    return apiClient.delete<{ status: string; deleted: number }>(`/push/queue${qs}`);
  },

  // Get encryption info for setting up external clients
  getEncryptionInfo: () => apiClient.get<PushEncryptionInfo>('/push/info'),
};
