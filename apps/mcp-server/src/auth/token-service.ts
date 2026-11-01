/**
 * RADARMatrix Control-Plane Token Service (M2, Phase P2)
 *
 * Zero-runtime-dependency issue/verify of control-plane-issued gateway
 * tokens. Compact JWT format, Ed25519 (EdDSA) signatures via node:crypto.
 *
 * Security law (binding):
 * - Signature verification is ALWAYS required. An unsigned or
 *   decoded-but-unverified payload is NEVER an identity.
 * - Issuer and audience are exact-match: no prefix, no wildcard.
 * - Expiry is enforced (small clock-skew allowance); not-before too.
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

/** Clock-skew tolerance for exp/nbf checks (seconds). */
const CLOCK_SKEW_SECONDS = 30;

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
 * 6. expiry honored (with bounded skew); not-before honored
 * 7. jti not on the denylist
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
  const now: number =
    options.now !== undefined ? options.now : Math.floor(Date.now() / 1000);
  if (typeof c.exp !== "number" || now >= c.exp + CLOCK_SKEW_SECONDS) {
    return null;
  }
  if (typeof c.iat !== "number") {
    return null;
  }
  if (
    typeof c.nbf === "number" &&
    now + CLOCK_SKEW_SECONDS < c.nbf
  ) {
    return null;
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
