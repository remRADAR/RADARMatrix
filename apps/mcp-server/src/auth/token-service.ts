/**
 * RADARMatrix Control-Plane Token Service (M2, Phase P2; hardened M2.1)
 *
 * Zero-runtime-dependency issue/verify of control-plane-issued gateway
 * tokens. Compact JWT format, Ed25519 (EdDSA) signatures via node:crypto.
 *
 * Security law (binding):
 * - Signature verification is ALWAYS required. An unsigned or
 *   decoded-but-unverified payload is NEVER an identity.
 * - Issuer and audience are exact-match: no prefix, no wildcard.
 * - Temporal validation (M2.1 hardening):
 *   * exp and iat MUST be finite numbers. NaN, Infinity, and
 *     non-numeric values are rejected. (JSON cannot carry NaN/Infinity
 *     literals through JSON.stringify, but a hand-crafted payload can
 *     carry `1e999`, which JSON.parse yields as Infinity — the verifier
 *     must not be tricked by it.)
 *   * Expired tokens are rejected; tokens issued in the future beyond
 *     the documented clock-skew allowance are rejected.
 *   * exp MUST be strictly later than iat (exp == iat is rejected).
 *   * The token lifetime (exp - iat) MUST NOT exceed the configured
 *     maximum (default: MAX_TOKEN_LIFETIME_SECONDS = 1 hour).
 *   * nbf, when present, MUST be a finite number. A malformed nbf is
 *     NEVER silently ignored — the token is rejected. nbf in the future
 *     beyond the skew allowance is rejected.
 * - Token purpose (M2.1 hardening):
 *   * Claims carry a token_use ("access" | "service"). A caller that
 *     requires a specific purpose passes requiredTokenUse; a token
 *     whose token_use is missing, unsupported, or arbitrary then
 *     fails closed. Interactive user authentication accepts ONLY
 *     token_use === "access".
 * - jti denylist support: a revoked token never verifies again.
 * - Claims carry IDENTITY only. Roles and workspace access are NOT
 *   token claims and are NEVER trusted from tokens.
 *
 * The control plane (or, in tests, the test harness) holds the private
 * key. The gateway holds the public key only.
 *
 * Erasable-syntax TypeScript only (Node >= 22.18 type stripping).
 */

import {
  sign,
  verify as cryptoVerify,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  randomUUID,
} from "node:crypto";

export interface GatewayTokenClaims {
  sub: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  nbf?: number;
  jti: string;
  token_use?: "access" | "service";
}

/**
 * Clock-skew tolerance for exp/nbf/iat checks (seconds).
 * M2 policy: 30 seconds — unchanged by M2.1 (not weakened, not
 * broadened). Future-issued tokens are tolerated ONLY within this
 * window; beyond it, the token is rejected.
 */
const CLOCK_SKEW_SECONDS = 30;

/**
 * ABSOLUTE maximum access-token lifetime (seconds), measured as
 * exp - iat. M2.1.1 policy: 3,600 seconds (1 hour) is a VERIFIER-OWNED
 * CEILING, not a caller-overridable maximum. VerifyTokenOptions
 * .maxLifetimeSeconds may TIGHTEN the bound; it can NEVER loosen it —
 * the verifier enforces min(configured, MAX_TOKEN_LIFETIME_SECONDS).
 * Tokens with a longer validity window are rejected outright — a
 * stolen token must not live longer than the documented bound.
 */
const MAX_TOKEN_LIFETIME_SECONDS = 60 * 60;

function toB64url(input: string | Buffer): string {
  const buffer: Buffer =
    typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer.toString("base64url");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

/**
 * Issue a signed compact JWT (header.payload.signature).
 * alg is always EdDSA. The header never depends on input.
 */
export function issueGatewayToken(
  claims: GatewayTokenClaims,
  privateKeyPem: string,
): string {
  const header = { alg: "EdDSA", typ: "JWT" };
  const signingInput =
    toB64url(JSON.stringify(header)) + "." + toB64url(JSON.stringify(claims));
  const signature = sign(
    null,
    Buffer.from(signingInput, "utf8"),
    createPrivateKey(privateKeyPem),
  );
  return signingInput + "." + signature.toString("base64url");
}

/**
 * Convenience minter: builds a valid claims object and signs it.
 * Used by the control plane and by tests.
 */
export function mintGatewayToken(
  params: {
    sub: string;
    issuer: string;
    audience: string;
    ttlSeconds: number;
    tokenUse?: "access" | "service";
    expiresAt?: number;
    notBefore?: number;
    now?: number;
  },
  privateKeyPem: string,
): string {
  const now: number =
    params.now !== undefined ? params.now : Math.floor(Date.now() / 1000);
  const claims: GatewayTokenClaims = {
    sub: params.sub,
    iss: params.issuer,
    aud: params.audience,
    iat: now,
    exp:
      params.expiresAt !== undefined
        ? params.expiresAt
        : now + params.ttlSeconds,
    jti: randomUUID(),
  };
  if (params.tokenUse !== undefined) {
    claims.token_use = params.tokenUse;
  }
  if (params.notBefore !== undefined) {
    claims.nbf = params.notBefore;
  }
  return issueGatewayToken(claims, privateKeyPem);
}

export interface VerifyTokenOptions {
  issuer: string;
  audience: string;
  /** Optional revocation check (jti denylist). */
  isDenied?: (jti: string) => boolean;
  /**
   * Token-purpose policy (M2.1): when set, the token's token_use must
   * be EXACTLY this value. Missing, unsupported, or arbitrary
   * token_use values fail closed. Interactive user authentication
   * MUST pass "access" here.
   */
  requiredTokenUse?: "access" | "service";
  /**
   * Optional STRICTER maximum lifetime in seconds (exp - iat).
   * M2.1.1: the one-hour ceiling is an ABSOLUTE verifier policy. A
   * valid, finite, positive value here may only TIGHTEN the bound —
   * values above MAX_TOKEN_LIFETIME_SECONDS are clamped down to it
   * and can never loosen the ceiling. Invalid, non-finite, zero, or
   * negative values fail safely to the documented default.
   */
  maxLifetimeSeconds?: number;
  /** Test/clock override: now in epoch seconds. */
  now?: number;
}

/**
 * Verify a gateway token. Returns the claims ONLY if every check
 * passes; returns null otherwise. Fail closed everywhere:
 *
 * 1. shape (exactly three parts)
 * 2. header alg is EdDSA (unsigned "none" and foreign algorithms
 *    are rejected before anything else)
 * 3. Ed25519 signature verification (always required)
 * 4. sub and jti present and non-empty
 * 5. exact issuer match, exact audience match
 * 6. temporal validation (M2.1): exp/iat/nbf must be finite numbers;
 *    expiry honored (bounded skew); future issuance beyond skew
 *    rejected; exp strictly after iat; lifetime within the documented
 *    maximum; malformed nbf rejected (never silently accepted)
 * 7. token-purpose check (M2.1): when requiredTokenUse is set, an
 *    exact token_use match is mandatory
 * 8. jti not on the denylist
 */
export function verifyGatewayToken(
  token: string,
  publicKeyPem: string,
  options: VerifyTokenOptions,
): GatewayTokenClaims | null {
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }
  const parts: string[] = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const headerB64: string = parts[0];
  const payloadB64: string = parts[1];
  const signatureB64: string = parts[2];

  let header: unknown;
  let claims: unknown;
  try {
    header = JSON.parse(fromB64url(headerB64).toString("utf8"));
    claims = JSON.parse(fromB64url(payloadB64).toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof header !== "object" ||
    header === null ||
    (header as { alg?: unknown }).alg !== "EdDSA"
  ) {
    return null;
  }

  let signatureOk: boolean = false;
  try {
    signatureOk = cryptoVerify(
      null,
      Buffer.from(headerB64 + "." + payloadB64, "utf8"),
      createPublicKey(publicKeyPem),
      fromB64url(signatureB64),
    );
  } catch {
    return null;
  }
  if (!signatureOk) {
    return null;
  }

  if (typeof claims !== "object" || claims === null) {
    return null;
  }
  const c = claims as Record<string, unknown>;

  if (typeof c.sub !== "string" || c.sub.trim() === "") {
    return null;
  }
  if (typeof c.jti !== "string" || c.jti.length === 0) {
    return null;
  }
  if (c.iss !== options.issuer) {
    return null;
  }
  if (c.aud !== options.audience) {
    return null;
  }

  const nowOption: unknown = options.now;
  const now: number =
    typeof nowOption === "number" && Number.isFinite(nowOption)
      ? nowOption
      : Math.floor(Date.now() / 1000);

  /**
   * Temporal validation (M2.1 hardening).
   *
   * NaN/Infinity defense: JSON.stringify cannot produce NaN/Infinity
   * (they serialize to null, which fails the typeof checks below),
   * but a hand-crafted payload can carry 1e999, which JSON.parse
   * evaluates to Infinity. Number.isFinite rejects all of it.
   */
  if (typeof c.exp !== "number" || !Number.isFinite(c.exp)) {
    return null;
  }
  if (typeof c.iat !== "number" || !Number.isFinite(c.iat)) {
    return null;
  }
  // Expired (bounded skew — unchanged M2 policy of 30 seconds).
  if (now >= c.exp + CLOCK_SKEW_SECONDS) {
    return null;
  }
  // Future-issued beyond the documented skew allowance.
  if (c.iat > now + CLOCK_SKEW_SECONDS) {
    return null;
  }
  // Expiration must be strictly later than issuance.
  if (c.exp <= c.iat) {
    return null;
  }
  // Documented maximum lifetime (exp - iat). M2.1.1 defect fix: the
  // one-hour ceiling is an ABSOLUTE verifier policy — a caller-supplied
  // option may only TIGHTEN it. effectiveMaximum = min(configured,
  // MAX_TOKEN_LIFETIME_SECONDS); no caller can loosen the ceiling.
  // Note: extreme values cannot bypass this — exp - iat overflows to
  // Infinity, which exceeds any finite bound.
  const maxLifetimeOption: unknown = options.maxLifetimeSeconds;
  const configuredMaximum: number =
    typeof maxLifetimeOption === "number" &&
    Number.isFinite(maxLifetimeOption) &&
    maxLifetimeOption > 0
      ? maxLifetimeOption
      : MAX_TOKEN_LIFETIME_SECONDS;
  const maxLifetime: number = Math.min(
    configuredMaximum,
    MAX_TOKEN_LIFETIME_SECONDS,
  );
  if (c.exp - c.iat > maxLifetime) {
    return null;
  }
  // Not-before: present means validated. A malformed nbf is NEVER
  // silently accepted — invalid nbf rejects the token.
  if (c.nbf !== undefined) {
    if (typeof c.nbf !== "number" || !Number.isFinite(c.nbf)) {
      return null;
    }
    if (now + CLOCK_SKEW_SECONDS < c.nbf) {
      return null;
    }
  }
  /**
   * Token-purpose policy (M2.1): when a caller requires a purpose,
   * the claim must match EXACTLY. A missing token_use, an unsupported
   * purpose, or an arbitrary purpose string fails closed here.
   */
  if (options.requiredTokenUse !== undefined) {
    if (c.token_use !== options.requiredTokenUse) {
      return null;
    }
  }

  if (options.isDenied && options.isDenied(c.jti)) {
    return null;
  }

  return claims as GatewayTokenClaims;
}

/**
 * In-memory jti denylist (M2 boundary: per-process).
 * A durable, restart-surviving denylist arrives with the durable
 * store; until then, short token TTLs bound the revocation window.
 */
export function createTokenDenylist(): {
  add(jti: string): void;
  has(jti: string): boolean;
  size(): number;
} {
  const denied: Set<string> = new Set();
  return {
    add(jti: string): void {
      denied.add(jti);
    },
    has(jti: string): boolean {
      return denied.has(jti);
    },
    size(): number {
      return denied.size;
    },
  };
}

/**
 * Dev/test-only key generation (control plane holds its own private
 * key via secret management; the gateway only ever receives the public
 * key through configuration).
 */
export function generateEd25519KeyPair(): {
  privateKeyPem: string;
  publicKeyPem: string;
} {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: pair.privateKey.export({
      format: "pem",
      type: "pkcs8",
    }) as string,
    publicKeyPem: pair.publicKey.export({
      format: "pem",
      type: "spki",
    }) as string,
  };
}
