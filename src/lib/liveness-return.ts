// The browser side of PhilHealth Check (guide 4.1, Step 2).

export const LIVENESS_DRAFT_KEY = "pcu.liveness.redirect.v1";

export type LivenessDraft = {
  authorizationId: string;
  state: string;
  returnUrl: string;
  expiresAt: number;
};

const MAX_DRAFT_MS = 5 * 60 * 1000;

/** 64 lowercase hex characters from 32 random bytes. */
export function newLivenessState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** expires_at is Philippine Standard Time with no offset. */
export function draftExpiry(expiresAt: string, now: number) {
  return Math.min(Date.parse(`${expiresAt}+08:00`), now + MAX_DRAFT_MS);
}

export function isLivenessReturn(hash: string) {
  return hash.includes("pcu_liveness_status=");
}

/** Returns the authorization ID only when every check in the guide passes. */
export function checkLivenessReturn(
  hash: string,
  draft: LivenessDraft | null,
  currentUrl: string,
  now: number,
) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const passed =
    draft !== null &&
    params.get("pcu_liveness_status") === "COMPLETED" &&
    params.get("pcu_liveness_authorization_id") === draft.authorizationId &&
    params.get("pcu_liveness_state") === draft.state &&
    currentUrl === draft.returnUrl &&
    now <= draft.expiresAt;
  return passed ? draft.authorizationId : null;
}
