/**
 * RADARMatrix Production Authentication Provider (M2, Phase P2; hardened M2.1)
 *
 * Replaces the development identity fixture in production mode when the
 * complete production auth configuration is present. Implements the same
 * provider shape the gateway already expects (authenticate / hasPrincipal /
 * getPrincipal / snapshot).
 *
 * Security law (binding):
 * - Identity comes ONLY from a verified control-plane token (Ed25519
 *   compact JWT). Request-context caller_id is NEVER trusted as identity;
 *   if present, it must MATCH the verified subject or authentication
 *   fails (identity_mismatch).
 * - Roles and workspace access are NEVER taken from token claims. The
 *   role is resolved from the durable membership record at request time.
 * - Membership is checked here AND again by the gateway's isolation gate
 *   (defense in depth).
 * - Fail closed: every failure path returns null and emits a structured
 *   authentication-failure event (P1 denial monitoring).
 *
 * Token-purpose policy (M2.1 hardening):
 * - This provider implements INTERACTIVE USER authentication. It accepts
 *   ONLY tokens whose token_use is exactly "access". A token of any other
 *   purpose (including "service"), a token with a missing purpose, or a
 *   token with an arbitrary token_use string fails closed as an
 *   invalid token.
 * - Service identities (RADAR orchestration, agents) require a SEPARATE,
 *   EXPLICIT authentication path with its own purpose enforcement and
 *   its own tests. That path is PLANNED, not implemented in M2.1 — no
 *   service-authentication implementation exists yet, and this provider
 *   deliberately does not improvise one.
 * - Service privileges are NEVER inferred from the token subject. The
 *   subject string carries identity only; authority comes from the
 *   membership record.
 *
 * Erasable-syntax TypeScript only (Node >= 22.18 type stripping).
 */

import {
  verifyGatewayToken,
  createTokenDenylist,
} from "./token-service.ts";

export interface MembershipAuthorityLike {
  isMember(callerId: string, workspaceId: string): boolean;
  getRole(callerId: string, workspaceId: string): string | null;
}

export interface ProductionAuthOptions {
  publicKeyPem: string;
  issuer: string;
  audience: string;
  membership: MembershipAuthorityLike;
  /** Optional externally-owned denylist (durable revocation). */
  denylist?: { has(jti: string): boolean };
  /** Optional structured failure observer (P1). */
  onAuthFailure?: (reason: string, subject: string) => void;
}

export interface ProductionPrincipal {
  caller_id: string;
  roles: string[];
  workspace_id: string;
  request_id: string;
  timestamp: string;
}

interface RequestShape {
  context?: {
    token?: string;
    caller_id?: string;
    workspace_id?: string;
    request_id?: string;
    timestamp?: string;
  };
}

/**
 * Complete production auth configuration = ALL of:
 * - RADARMATRIX_AUTH_PUBLIC_KEY  (control-plane public key, PEM)
 * - RADARMATRIX_TOKEN_ISSUER     (exact expected issuer)
 * - RADARMATRIX_AUDIENCE         (exact expected audience)
 * - RADARMATRIX_MEMBERSHIP_FILE  (durable membership record path)
 *
 * Production mode with ANY missing value keeps the M1a fail-closed
 * behavior (empty registries — nothing authenticates).
 */
export function isProductionAuthConfigured(
  env: Record<string, string | undefined>,
): boolean {
  return Boolean(
    env.RADARMATRIX_AUTH_PUBLIC_KEY &&
      env.RADARMATRIX_TOKEN_ISSUER &&
      env.RADARMATRIX_AUDIENCE &&
      env.RADARMATRIX_MEMBERSHIP_FILE,
  );
}

function defaultFailureLog(
  reason: string,
  subject: string,
): void {
  console.log(
    "[AUTH-FAIL] " +
      reason +
      " | sub=" +
      subject +
      " | " +
      new Date().toISOString(),
  );
}

export class ProductionAuthenticationProvider {
  private readonly publicKeyPem: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly membership: MembershipAuthorityLike;
  private readonly denylist: { has(jti: string): boolean };
  private readonly onAuthFailure: (reason: string, subject: string) => void;

  constructor(options: ProductionAuthOptions) {
    if (
      !options ||
      !options.publicKeyPem ||
      !options.issuer ||
      !options.audience ||
      !options.membership
    ) {
      throw new Error(
        "ProductionAuthenticationProvider requires publicKeyPem, issuer, audience, and membership",
      );
    }
    this.publicKeyPem = options.publicKeyPem;
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.membership = options.membership;
    this.denylist = options.denylist
      ? options.denylist
      : createTokenDenylist();
    this.onAuthFailure = options.onAuthFailure
      ? options.onAuthFailure
      : defaultFailureLog;
  }

  /**
   * Authenticate a request. Returns a principal ONLY when the token
   * verifies AND the verified subject is a member of the requested
   * workspace with a known role. Every other path fails closed.
   *
   * Token-purpose enforcement (M2.1): interactive user authentication
   * accepts ONLY token_use === "access". Service-purpose, missing, or
   * arbitrary purposes fail closed (invalid_or_expired_token event).
   */
  authenticate(request: unknown): ProductionPrincipal | null {
    const req: RequestShape | null =
      request && typeof request === "object"
        ? (request as RequestShape)
        : null;
    const context = req && req.context ? req.context : null;

    const token: string =
      context && typeof context.token === "string" ? context.token : "";
    if (!token) {
      this.onAuthFailure("missing_token", "unknown");
      return null;
    }

    const claims = verifyGatewayToken(token, this.publicKeyPem, {
      issuer: this.issuer,
      audience: this.audience,
      isDenied: (jti: string): boolean => this.denylist.has(jti),
      requiredTokenUse: "access",
    });
    if (!claims) {
      this.onAuthFailure("invalid_or_expired_token", "unknown");
      return null;
    }

    const subject: string = claims.sub;

    /**
     * Identity binding: the verified subject IS the identity. A
     * context caller_id that disagrees with the token subject is an
     * identity-mismatch attempt and fails closed.
     */
    if (
      context &&
      typeof context.caller_id === "string" &&
      context.caller_id.trim() !== "" &&
      context.caller_id !== subject
    ) {
      this.onAuthFailure("identity_mismatch", subject);
      return null;
    }

    const workspaceId: string =
      context && typeof context.workspace_id === "string"
        ? context.workspace_id
        : "";
    if (!workspaceId || workspaceId.trim() === "") {
      this.onAuthFailure("missing_workspace", subject);
      return null;
    }

    if (!this.membership.isMember(subject, workspaceId)) {
      this.onAuthFailure("not_a_member", subject);
      return null;
    }

    const role: string | null = this.membership.getRole(
      subject,
      workspaceId,
    );
    if (!role) {
      this.onAuthFailure("no_role", subject);
      return null;
    }

    /**
     * Roles come from the membership record ONLY. If a token ever
     * carried role-like claims, they are ignored here by construction.
     */
    return {
      caller_id: subject,
      roles: [role],
      workspace_id: workspaceId,
      request_id:
        context && typeof context.request_id === "string"
          ? context.request_id
          : "",
      timestamp:
        context && typeof context.timestamp === "string"
          ? context.timestamp
          : new Date().toISOString(),
    };
  }

  /** Production identities are never enumerable via the provider. */
  hasPrincipal(): boolean {
    return false;
  }

  getPrincipal(): null {
    return null;
  }

  snapshot(): Record<string, never> {
    return {};
  }
}
