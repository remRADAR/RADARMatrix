/**
 * RADARMatrix Approval Tokens (M2, Phase P4)
 *
 * Owner-approved M2 architecture for future runtime execution:
 * an approval is a short-lived, Ed25519-signed, scope-bound,
 * single-use token. An execution adapter verifies ALL of:
 * signature, expiry, exact action match, exact resource match,
 * exact workspace match, actor identity, and single-use redemption.
 *
 * Invariants:
 * - Approvals are bound to an exact action and an EXACT list of
 *   resource ids — never a glob or "any resource".
 * - One workspace, one actor. Mismatch fails closed.
 * - Redeemable exactly once (jti redemption record); replay after
 *   redemption is denied.
 * - No approval without a positive TTL; short-lived by design.
 * - This module ISSUES and VERIFIES approval tokens. It does NOT
 *   execute anything. Wiring to a real execution adapter is future
 *   work; the gateway does not consume these tokens yet.
 *
 * Zero runtime npm dependencies. Erasable-syntax TypeScript only.
 */

import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

export type ApprovalAction = string;

export interface ApprovalClaims {
  jti: string;
  action: ApprovalAction;
  resource_ids: string[];
  workspace_id: string;
  actor_id: string;
  grant_id?: string;
  session_id?: string;
  iat: number;
  exp: number;
}

export interface IssueApprovalInput {
  action: ApprovalAction;
  resource_ids: string[];
  workspace_id: string;
  actor_id: string;
  grant_id?: string;
  session_id?: string;
  ttl_seconds: number;
  now: number;
}

export interface RedemptionRecord {
  has(jti: string): boolean;
  add(jti: string): void;
  size(): number;
}

export function createRedemptionRecord(): RedemptionRecord {
  const seen = new Set<string>();
  return {
    has: (jti) => seen.has(jti),
    add: (jti) => {
      seen.add(jti);
    },
    size: () => seen.size,
  };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function canonicalPayload(claims: ApprovalClaims): Buffer {
  // Canonical ordering: the exact bytes that get signed.
  return Buffer.from(JSON.stringify(claims), "utf8");
}

const MIN_TTL_SECONDS = 1;
const MAX_TTL_SECONDS = 60 * 30; // 30 minutes — approvals are short-lived.

/**
 * Issues a signed approval token. Returns null (fail-closed) on any
 * invalid input: empty action/resources/workspace/actor, non-positive
 * or excessive TTL, or an issue error.
 */
export function issueApproval(
  input: IssueApprovalInput,
  privateKeyPem: string,
): { token: string; claims: ApprovalClaims } | null {
  if (!input || typeof input !== "object") return null;
  const isStr = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (!isStr(input.action)) return null;
  if (!isStr(input.workspace_id)) return null;
  if (!isStr(input.actor_id)) return null;
  if (!Array.isArray(input.resource_ids) || input.resource_ids.length === 0) return null;
  for (const rid of input.resource_ids) {
    if (!isStr(rid)) return null;
  }
  if (
    typeof input.ttl_seconds !== "number" ||
    !Number.isFinite(input.ttl_seconds) ||
    input.ttl_seconds < MIN_TTL_SECONDS ||
    input.ttl_seconds > MAX_TTL_SECONDS
  ) {
    return null;
  }
  if (typeof input.now !== "number" || !Number.isFinite(input.now)) return null;

  const claims: ApprovalClaims = {
    jti: randomUUID(),
    action: input.action,
    resource_ids: input.resource_ids.slice(),
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
    iat: Math.floor(input.now),
    exp: Math.floor(input.now) + input.ttl_seconds,
  };
  if (input.grant_id !== undefined) {
    if (!isStr(input.grant_id)) return null;
    claims.grant_id = input.grant_id;
  }
  if (input.session_id !== undefined) {
    if (!isStr(input.session_id)) return null;
    claims.session_id = input.session_id;
  }

  try {
    const payload = canonicalPayload(claims);
    const signature = cryptoSign(null, payload, createPrivateKey(privateKeyPem));
    const token = b64url(payload) + "." + b64url(signature);
    return { token, claims };
  } catch {
    return null;
  }
}

export interface VerifyApprovalCheck {
  action: ApprovalAction;
  resource_id: string;
  workspace_id: string;
  actor_id: string;
  grant_id?: string;
  session_id?: string;
}

export interface VerifyApprovalResult {
  valid: boolean;
  reason?: string;
  jti?: string;
}

/**
 * Verifies an approval token against an execution attempt and (on
 * success) marks the jti redeemed — single use, replay denied.
 *
 * Exact-scope matching: the attempted action and resource must match
 * the approved action and resource list EXACTLY. There is no
 * wildcard resource and no broader-action acceptance.
 */
export function verifyApproval(
  token: string,
  publicKeyPem: string,
  check: VerifyApprovalCheck,
  redemption: RedemptionRecord,
  now: number,
): VerifyApprovalResult {
  if (typeof token !== "string" || token.length === 0) {
    return { valid: false, reason: "missing_token" };
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "malformed_token" };
  }
  let claims: ApprovalClaims;
  try {
    claims = JSON.parse(fromB64url(parts[0]).toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed_token" };
  }
  if (!claims || typeof claims !== "object") {
    return { valid: false, reason: "malformed_token" };
  }
  if (typeof claims.jti !== "string" || claims.jti.length === 0) {
    return { valid: false, reason: "malformed_token" };
  }
  if (redemption.has(claims.jti)) {
    return { valid: false, reason: "replayed", jti: claims.jti };
  }

  // Signature over the exact payload bytes.
  let signatureOk = false;
  try {
    signatureOk = cryptoVerify(
      null,
      fromB64url(parts[0]),
      createPublicKey(publicKeyPem),
      fromB64url(parts[1]),
    );
  } catch {
    return { valid: false, reason: "bad_signature", jti: claims.jti };
  }
  if (!signatureOk) {
    return { valid: false, reason: "bad_signature", jti: claims.jti };
  }

  // Expiry.
  if (typeof claims.exp !== "number" || now >= claims.exp) {
    return { valid: false, reason: "expired", jti: claims.jti };
  }

  if (!check || typeof check !== "object") {
    return { valid: false, reason: "missing_check", jti: claims.jti };
  }

  // Exact scope match — no wildcard, no subset expansion.
  if (claims.action !== check.action) {
    return { valid: false, reason: "action_mismatch", jti: claims.jti };
  }
  if (!Array.isArray(claims.resource_ids) || !claims.resource_ids.includes(check.resource_id)) {
    return { valid: false, reason: "resource_mismatch", jti: claims.jti };
  }
  if (claims.workspace_id !== check.workspace_id) {
    return { valid: false, reason: "workspace_mismatch", jti: claims.jti };
  }
  if (claims.actor_id !== check.actor_id) {
    return { valid: false, reason: "actor_mismatch", jti: claims.jti };
  }
  if (claims.grant_id !== undefined && claims.grant_id !== check.grant_id) {
    return { valid: false, reason: "grant_mismatch", jti: claims.jti };
  }
  if (claims.session_id !== undefined && claims.session_id !== check.session_id) {
    return { valid: false, reason: "session_mismatch", jti: claims.jti };
  }

  // Single-use redemption: mark AFTER all checks pass.
  redemption.add(claims.jti);
  return { valid: true, jti: claims.jti };
}
