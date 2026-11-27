/**
 * RADARMatrix Approval Tokens (M2, Phase P4; hardened M2.2)
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
 * - M2.2 SECURITY CORRECTION: the complete claims structure is
 *   validated before any scope decision — jti, action,
 *   resource_ids, workspace_id, actor_id must be present and
 *   well-formed; iat/exp must be FINITE integers with exp > iat.
 *   The clock input must be a finite number. NaN, Infinity, and
 *   the JSON "1e999" trick are all rejected.
 * - M2.2: redemption is an atomic check-and-set (claim). A FAILED
 *   verification never consumes the approval; concurrent requests
 *   can never redeem the same single-use jti twice.
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

/**
 * M2.2: claim() is the ATOMIC single-use redemption primitive:
 * check-and-set in one synchronous operation. It returns true
 * exactly once per jti — concurrent callers can never both win.
 */
export interface RedemptionRecord {
  has(jti: string): boolean;
  add(jti: string): void;
  claim(jti: string): boolean;
  size(): number;
}

export function createRedemptionRecord(): RedemptionRecord {
  const seen = new Set<string>();
  return {
    has: (jti) => seen.has(jti),
    add: (jti) => {
      seen.add(jti);
    },
    claim: (jti) => {
      // Synchronous single-threaded check-and-set: once seen,
      // every later claim for the same jti loses the race.
      if (seen.has(jti)) {
        return false;
      }
      seen.add(jti);
      return true;
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
 * or excessive TTL, a non-finite clock, or an issue error.
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
  // M2.2: the issue clock must be a finite number — NaN/Infinity
  // can never mint a valid approval.
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
 * M2.2: complete claims-structure validation. Runs on the PARSED
 * claims (before trust is granted) so malformed structure can never
 * reach the scope or expiry logic. Returns false for:
 * - non-string / empty jti, action, workspace_id, actor_id
 * - missing, empty, or non-string resource_ids
 * - non-finite or non-integer iat/exp (NaN, Infinity, the JSON
 *   "1e999" trick all land here)
 * - exp <= iat (zero or negative lifetime can never be valid).
 */
function hasValidClaimStructure(claims: ApprovalClaims): boolean {
  const isStr = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (!claims || typeof claims !== "object") return false;
  if (!isStr(claims.jti)) return false;
  if (!isStr(claims.action)) return false;
  if (!isStr(claims.workspace_id)) return false;
  if (!isStr(claims.actor_id)) return false;
  if (!Array.isArray(claims.resource_ids) || claims.resource_ids.length === 0) return false;
  for (const rid of claims.resource_ids) {
    if (!isStr(rid)) return false;
  }
  if (
    typeof claims.iat !== "number" ||
    !Number.isFinite(claims.iat) ||
    !Number.isInteger(claims.iat)
  ) {
    return false;
  }
  if (
    typeof claims.exp !== "number" ||
    !Number.isFinite(claims.exp) ||
    !Number.isInteger(claims.exp)
  ) {
    return false;
  }
  if (claims.exp <= claims.iat) return false;
  if (claims.grant_id !== undefined && !isStr(claims.grant_id)) return false;
  if (claims.session_id !== undefined && !isStr(claims.session_id)) return false;
  return true;
}

/**
 * Verifies an approval token against an execution attempt and (on
 * success, atomically) marks the jti redeemed — single use, replay
 * denied.
 *
 * Exact-scope matching: the attempted action and resource must match
 * the approved action and resource list EXACTLY. There is no
 * wildcard resource and no broader-action acceptance.
 *
 * M2.2 order of operations:
 * 1. token shape -> 2. claims structure -> 3. signature ->
 * 4. clock input validity -> 5. replay check -> 6. expiry ->
 * 7. exact scope binding -> 8. ATOMIC redemption (claim).
 * A failed verification at ANY step never consumes the approval.
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

  // M2.2: complete claims-structure validation BEFORE any trust.
  if (!hasValidClaimStructure(claims)) {
    return { valid: false, reason: "malformed_claims", jti: undefined };
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

  // M2.2: the verification clock must be a finite number. A NaN or
  // Infinite clock input can never validate an approval.
  if (typeof now !== "number" || !Number.isFinite(now)) {
    return { valid: false, reason: "invalid_clock", jti: claims.jti };
  }

  // Replay check (read-only): a redeemed jti is denied. The atomic
  // claim happens only after EVERY other check has passed.
  if (redemption.has(claims.jti)) {
    return { valid: false, reason: "replayed", jti: claims.jti };
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

  // M2.2: single-use redemption is an ATOMIC check-and-set. Only a
  // fully verified approval reaches this point, and only the first
  // concurrent winner claims the jti.
  if (!redemption.claim(claims.jti)) {
    return { valid: false, reason: "replayed", jti: claims.jti };
  }
  return { valid: true, jti: claims.jti };
}
