import { t } from '@lingui/core/macro';
// Typed invite codes in onboarding ("Join with an invite code"): cleaning up
// what was pasted, checking the code before the password step, and turning
// invite failures into messages a person can act on. Redeeming itself stays
// in runOnboardingApply's join branch, shared with the /join link path.
import { decryptSpaceKeyFromInvite, hashInviteSecret } from '@budgero/runtime';
import { ApiError, spaceApi } from '@shared/api/api-client';
import type { InviteCodeProblem } from '@shared/lib/analytics/events';

export type { InviteCodeProblem };

/** A failure the person can act on, with the reason kept for analytics. */
export class InviteCodeError extends Error {
  constructor(public reason: InviteCodeProblem) {
    super(reason);
    this.name = 'InviteCodeError';
  }
}

/**
 * The code out of whatever was pasted: the bare code, the whole join link
 * (`…/join#code=…`), or a code an email client wrapped over two lines.
 */
export function normalizeInviteCode(raw: string): string {
  const text = raw.trim();
  const match = /[#?&]code=([^&\s]+)/.exec(text);
  let code = match ? match[1] : text;
  try {
    code = decodeURIComponent(code);
  } catch {
    /* keep it as typed */
  }
  return code.replace(/\s+/g, '');
}

/** Why an invite call failed, or null when it isn't an invite problem. */
export function classifyInviteError(err: unknown): InviteCodeProblem | null {
  if (err instanceof InviteCodeError) return err.reason;
  if (err instanceof ApiError) {
    const body = err.message.toLowerCase();
    if (err.status === 404) return 'not_found';
    if (err.status === 410) return 'expired';
    if (err.status === 409) return body.includes('seat') ? 'no_seats' : 'incomplete';
    if (err.status === 403) return 'restricted';
    return null;
  }
  // fetch() rejects with a TypeError when the request never got an answer.
  if (err instanceof TypeError) return 'network';
  return null;
}

export function inviteProblemMessage(reason: InviteCodeProblem): string {
  switch (reason) {
    case 'not_found':
      return t`This code doesn’t match an open invite. Check it for typos — or it was already used or cancelled, so ask for a new one.`;
    case 'expired':
      return t`This invite has expired. Ask the person who invited you for a new one.`;
    case 'incomplete':
      return t`This invite isn’t ready yet. Ask the person who invited you to create it again.`;
    case 'no_seats':
      return t`This workspace has no free seat left. Ask its owner to free one up.`;
    case 'restricted':
      return t`This invite can’t be used with your account. Ask the person who invited you for help.`;
    case 'network':
      return t`Couldn’t reach Budgero to check the code. Check your connection and try again.`;
    case 'unknown':
      return t`Couldn’t check the code. Try again in a moment.`;
  }
}

export type InviteCodeCheck =
  { ok: true; spaceName: string | null } | { ok: false; reason: InviteCodeProblem };

/**
 * Looks the code up and opens its bundle on this device, before the person
 * picks a password. Nothing is redeemed and nothing is stored.
 */
export async function checkInviteCode(
  code: string,
  now: number = Date.now()
): Promise<InviteCodeCheck> {
  try {
    const inspection = await spaceApi.inspectInvite(await hashInviteSecret(code));
    if (inspection.expires_at && Date.parse(inspection.expires_at) <= now) {
      return { ok: false, reason: 'expired' };
    }
    if (!inspection.encrypted_bundle) return { ok: false, reason: 'incomplete' };
    try {
      await decryptSpaceKeyFromInvite(inspection.encrypted_bundle, code);
    } catch {
      return { ok: false, reason: 'incomplete' };
    }
    return { ok: true, spaceName: inspection.space_display_name || null };
  } catch (err) {
    console.warn('[Onboarding] Invite code check failed', err);
    return { ok: false, reason: classifyInviteError(err) ?? 'unknown' };
  }
}
