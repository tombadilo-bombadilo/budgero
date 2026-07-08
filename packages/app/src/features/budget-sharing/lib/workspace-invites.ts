// Shared helpers for turning a workspace invite secret into a shareable
// artifact (join URL + mailto). The URL puts the secret in the fragment so
// it never reaches our backend or any email-delivery service when shared.

export function buildJoinUrl(secret: string): string {
  if (typeof window === 'undefined') {
    return `/join#code=${encodeURIComponent(secret)}`;
  }
  return `${window.location.origin}/join#code=${encodeURIComponent(secret)}`;
}

export interface InviteMailtoInput {
  /** Optional recipient email — leave empty for "compose with a fresh To:". */
  to?: string;
  secret: string;
  url?: string;
}

export function buildInviteMailto({
  to,
  secret,
  url = buildJoinUrl(secret),
}: InviteMailtoInput): string {
  const subject = encodeURIComponent('I invited you to my Budgero workspace');
  const body = encodeURIComponent(
    `Hey,\n\nI'm sharing my Budgero budget with you. Open the link below and sign in (or sign up) to join — your copy of the budget is end-to-end encrypted, so only people I invite can see it.\n\n${url}\n\nIf the link gets mangled, you can also paste this code in Budgero → Settings → Workspaces → Redeem invite:\n${secret}\n\n— sent from Budgero`
  );
  const recipient = to ? encodeURIComponent(to) : '';
  return `mailto:${recipient}?subject=${subject}&body=${body}`;
}
