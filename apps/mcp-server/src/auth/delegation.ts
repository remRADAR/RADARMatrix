/**
 * RADARMatrix Delegated Authority (M2, Phase P4; hardened M2.2, corrected
 * M2.2.1, provenance-corrected M2.2.2, authority-hardened M2.2.3)
 *
 * Owner-approved M2 architecture: a specialist agent must never
 * inherit every permission of the human (or RADAR orchestration
 * identity) that initiated its task. Delegation is an explicit,
 * scope-reduced, expiring, use-limited grant — enforced at
 * validation time, fail-closed.
 *
 * Invariants:
 * - A grant is valid ONLY if every allowed tool is a subset of the
 *   delegating actor's own tool authority. Violation => the grant is
 *   rejected at CREATION time (it can never exist).
 * - M2.2: the actor's authority is DERIVED from a trusted server-side
 *   actor context (verified principal roles + the tool registry) —
 *   never caller-supplied. Inputs still carrying actor_tools or
 *   actor_can_write are rejected outright.
 * - M2.2.1 SECURITY CORRECTION A (grant integrity): the integrity
 *   seal is now a KEYED HMAC-SHA-256 computed by a server-held
 *   integrity service (createGrantIntegrityService). An unkeyed
 *   hash can be recomputed by anyone who can mutate the grant; an
 *   HMAC cannot. The seal binds EVERY security-relevant field
 *   INCLUDING the current use count. Validation FAILS CLOSED when
 *   the integrity service (secret) is missing or invalid in any
 *   context that must verify a grant ("integrity_unavailable").
 *   The secret never appears in grant objects, request data, results
 *   or errors.
 * - M2.2.1 SECURITY CORRECTION B (atomic grant-use enforcement):
 *   reserveGrantUse() is the ATOMIC reservation primitive — a
 *   synchronous check-and-consume (validate limit -> increment uses
 *   -> re-seal) that runs BEFORE any external operation is
 *   dispatched. Two concurrent executions against a grant with one
 *   remaining use cannot both reserve. A rejected reservation
 *   result means the caller MUST NOT dispatch. Reservations are NOT
 *   refunded on transport failure, timeout, cancellation, or any
 *   uncertain outcome (a partially-executed operation may already
 *   have had side effects; refunding would enable over-use).
 *   The per-process reservation is atomic within one Node process
 *   (single-threaded synchronous section); it is NOT a distributed
 *   lock. Cross-process capacity enforcement requires the durable
 *   transactional store (D1, M7) — unchanged roadmap.
 * - M2.2.2 PROVENANCE CORRECTION A (membership provider provenance):
 *   createTrustedActorContext previously accepted a membership
 *   provider as an ARGUMENT — a caller able to supply a fabricated
 *   provider ({isMember:()=>true, getRole:()=>"admin"}) could mint a
 *   runtime-branded admin context. The brand alone is not proof of
 *   authentic membership. The mint function takes NO provider
 *   argument and reads ONLY the bound provider; a second argument
 *   is rejected outright (legacy caller-supplied providers fail
 *   LOUDLY, not silently). Uninitialized => every mint fails closed
 *   (null). Untrusted request payloads can neither supply nor
 *   replace the provider.
 * - M2.2.2 PROVENANCE CORRECTION B (tool registry provenance):
 *   createDelegatedGrant previously accepted the tool registry
 *   through its input — a caller-controlled registry could redefine
 *   which tools exist or which roles they require, granting itself
 *   authority. An input that still carries a `registry` field is
 *   rejected outright, tool-permission checks use ONLY the
 *   server-bound canonical registry, and unknown tools fail closed.
 *   Write permission remains strictly derived (a write grant
 *   requires the actor's derived write capability from the
 *   canonical registry).
 * - M2.2.3 FINDING A (secure first initialization): the
 *   initializeServerAuthority export is REMOVED from this
 *   general-purpose auth module — set-once alone did not
 *   authenticate the FIRST initializer, and any code importing this
 *   module could previously establish the authority with
 *   caller-chosen dependencies. The capability now lives ONLY in
 *   the trusted composition root (./server-composition.ts), whose
 *   sole legitimate consumers are trusted server startup code
 *   (gateway boot, future wiring) and the shared test composition
 *   helper (which plays the gateway-startup role in the test
 *   process). THIS module — the one request-handling code and the
 *   runtime adapters import — exports only fail-closed READ
 *   consumers of the bound authority. Ordinary request handlers
 *   cannot initialize or replace the server authority: the
 *   capability is not on their import surface, and the bound state
 *   (./authority-state.ts) is writable only through the internal
 *   API the composition root uses. Request payloads can never
 *   supply membership providers, registry definitions or
 *   initialization capabilities — the composition root accepts only
 *   live server-side objects, and functions do not survive JSON.
 * - M2.2.3 FINDING B (immutable bound dependencies): the bound
 *   membership provider is a PROTECTED ADAPTER whose method
 *   references were captured ONCE at composition — replacing
 *   provider.isMember / provider.getRole after binding has NO
 *   effect, while legitimate updates to the underlying membership
 *   records still flow through (the provider keeps reading its own
 *   live data; it is never frozen). The bound registry is a
 *   VALIDATED, COPIED, DEEP-FROZEN server-owned snapshot — retained
 *   references to the original registry object cannot mutate
 *   required roles, write permissions or tool identities after
 *   binding. Both are established by the composition root; nothing
 *   outside it can write the binding (set-once, frozen).
 * - The composition binding is dependency injection at a trusted
 *   server composition boundary — NOT global mutable state: it is
 *   set once per process, then frozen and read-only for the
 *   module's lifetime. In production the gateway composition code
 *   is the only caller; request handlers never touch it. (The
 *   durable D1/M7 membership/registry successors slot in behind the
 *   SAME ActorMembershipSource/RegistryInput abstractions — the
 *   provider abstraction is preserved unchanged.)
 * - allowed_actions must be a non-empty subset of {read, write}
 *   containing only known actions. No "admin", no wildcard.
 * - Expiry and use limits are enforced on EVERY validation and on
 *   EVERY reservation.
 * - The grant binds exactly one agent identity and one workspace.
 *   Any mismatch fails closed.
 * - No RADAR superuser: RADAR's orchestration grants are subject to
 *   the same subset rule as any human actor.
 * - M2.2.1 CONTRACT NOTE: recordGrantUse() (post-hoc use recording,
 *   non-atomic against concurrent validation) is REMOVED. It is
 *   replaced by reserveGrantUse(). The M3 github-readonly adapter on
 *   its own branch still imports recordGrantUse; the corrected
 *   compatibility adapter on THIS branch (apps/mcp-server/src/
 *   runtime/github-readonly.ts) uses the reservation API, and the
 *   original M3 branch is untouched (see docs/M2-2-1-CORRECTIONS.md).
 * - M2.2.2 CONTRACT NOTE: createTrustedActorContext no longer takes
 *   a membership-source argument, and CreateGrantInput no longer
 *   carries `registry`. Both provenance inputs moved to the
 *   set-once server authority binding. This is a deliberate
 *   breaking correction of the trusted-authority boundary —
 *   callers passing them are rejected (fail-closed, loudly).
 * - M2.2.3 CONTRACT NOTE: initializeServerAuthority is REMOVED from
 *   this module's exports (replaced by composeServerAuthority in
 *   ./server-composition.ts). isServerAuthorityInitialized() remains
 *   as a read-only predicate. Tests and composition code import the
 *   composition root, not this module, to establish authority.
 *
 * Zero runtime npm dependencies. Erasable-syntax TypeScript only
 * (Node type-stripping compatible).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getBoundServerAuthority, isServerAuthorityBound } from "./authority-state.ts";

export interface DelegatedGrant {
  /** Unique grant id (caller-supplied or generated). */
  grant_id: string;
  /** Verified principal delegating authority (never an agent). */
  actor_id: string;
  /** The specialist agent identity receiving the grant. */
  agent_id: string;
  /** Exactly one workspace. Grants never span workspaces. */
  workspace_id: string;
  /** Tools the agent may call — subset of the actor's derived tools. */
  allowed_tools: string[];
  /** "read" and/or "write". Subset of the actor's write capability. */
  allowed_actions: ("read" | "write")[];
  /** Epoch seconds. Validation fails at/after this time. */
  expires_at: number;
  /** 0 = unlimited; otherwise validation fails after this many uses. */
  max_uses: number;
  /** Current use count (mutated ONLY by reserveGrantUse, re-sealed). */
  uses: number;
  /**
   * M2.2.1: HMAC-SHA-256 integrity seal over ALL security-relevant
   * fields (including uses), computed by the server-held integrity
   * service. Never a plain hash.
   */
  integrity_hash: string;
}

// ---------------------------------------------------------------------------
// M2.2.1 CORRECTION A — server-held keyed integrity service.
// ---------------------------------------------------------------------------

/**
 * Opaque keyed integrity service. The HMAC secret is held in the
 * closure and is NEVER exposed through this object, grant objects,
 * tool results, errors, logs or API responses. Only the server
 * process constructs this (from server-held configuration or a
 * server-side secret store) — never from request data.
 */
export interface GrantIntegrityService {
  /**
   * Computes the HMAC-SHA-256 seal over the canonical serialization
   * of every security-relevant grant field (including uses).
   */
  seal(fields: GrantSealFields): string;
  /**
   * Constant-time comparison of an expected seal against a presented
   * one. Returns false for missing/malformed presented seals.
   */
  matches(presented: unknown, expected: string): boolean;
}

/**
 * Every authority-bearing attribute of a grant, bound by the seal.
 * (grant id, actor, agent, workspace, tools, actions, expiry, use
 * limit, current usage.)
 */
export interface GrantSealFields {
  grant_id: string;
  actor_id: string;
  agent_id: string;
  workspace_id: string;
  allowed_tools: string[];
  allowed_actions: string[];
  expires_at: number;
  max_uses: number;
  uses: number;
}

/**
 * Minimum secret entropy policy: the HMAC secret must be a string of
 * at least 32 characters (>= 128 bits of material for typical
 * base64/hex secrets). Anything shorter fails closed — the service
 * is never constructed.
 */
export const MIN_INTEGRITY_SECRET_LENGTH = 32;

/**
 * Deterministic canonical serialization of the sealed grant fields.
 * Field order is fixed; arrays are sorted so equal sets always seal
 * identically. JSON over an array guarantees deterministic output.
 */
function canonicalGrantSerialization(fields: GrantSealFields): string {
  return JSON.stringify([
    fields.grant_id,
    fields.actor_id,
    fields.agent_id,
    fields.workspace_id,
    fields.allowed_tools.slice().sort(),
    fields.allowed_actions.slice().sort(),
    fields.expires_at,
    fields.max_uses,
    fields.uses,
  ]);
}

/**
 * Creates the server-held keyed integrity service, or returns null
 * (fail-closed) when the secret is missing, not a string, or too
 * short. Callers that receive null MUST treat grant creation and
 * verification as unavailable — never fall back to an unkeyed hash.
 */
export function createGrantIntegrityService(
  secret: unknown,
): GrantIntegrityService | null {
  if (typeof secret !== "string" || secret.length < MIN_INTEGRITY_SECRET_LENGTH) {
    return null;
  }
  const key = secret;
  return {
    seal(fields: GrantSealFields): string {
      return createHmac("sha256", key)
        .update(canonicalGrantSerialization(fields), "utf8")
        .digest("hex");
    },
    matches(presented: unknown, expected: string): boolean {
      if (typeof presented !== "string" || presented.length !== expected.length) {
        return false;
      }
      try {
        return timingSafeEqual(Buffer.from(presented, "utf8"), Buffer.from(expected, "utf8"));
      } catch {
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// M2.2.2/M2.2.3 — the trusted server composition boundary.
//
// M2.2.3 Finding A: the binding state lives in the private module
// ./authority-state.ts and is written ONLY by the trusted
// composition root (./server-composition.ts). THIS module — the
// general-purpose auth module that request-handling code and the
// runtime adapters import — exports NO initialization capability:
// it can only READ the bound authority, and it fails closed while
// the authority is unbound.
// ---------------------------------------------------------------------------

/**
 * The trusted membership/authentication surface the authority may
 * draw provenance from. In production this is the real membership
 * provider (FileMembershipProvider or its durable successor); it is
 * NEVER request data. The D1/M7 durable membership adapter slots in
 * behind this SAME abstraction — the interface is unchanged.
 */
export interface ActorMembershipSource {
  /** Is the principal a member of the workspace? */
  isMember(callerId: string, workspaceId: string): boolean;
  /** The principal's role in the workspace, or null when absent/unknown. */
  getRole(callerId: string, workspaceId: string): string | null;
}

/**
 * M2.2: the minimal tool-registry entry shape this module relies on.
 * The canonical registry lives in the set-once server authority
 * binding — callers can no longer supply their own.
 */
export interface RegistryToolEntry {
  required_role?: unknown;
  is_write_operation?: unknown;
}

export interface RegistryInput {
  [tool: string]: RegistryToolEntry | unknown;
}

/**
 * Whether the trusted server composition boundary has been bound.
 * False => every trusted-context mint and every grant creation fails
 * closed. (M2.2.3: this is a READ-ONLY predicate. The initialization
 * capability itself is NOT exported from this module — it lives in
 * the trusted composition root ./server-composition.ts.)
 */
export function isServerAuthorityInitialized(): boolean {
  return isServerAuthorityBound();
}

// ---------------------------------------------------------------------------
// M2.2.1 CORRECTION C + M2.2.2 CORRECTION A — runtime-branded trusted
// actor provenance, minted ONLY from the bound (protected) membership
// adapter.
// ---------------------------------------------------------------------------

/**
 * Module-private brand. A caller cannot construct this symbol via
 * JSON, request payloads, or object literals — it exists only inside
 * this module, and only createTrustedActorContext mints it.
 */
const TRUSTED_ACTOR_BRAND = Symbol("radarmatrix.trusted-actor-context");

/**
 * Trusted server-side actor context. Constructible ONLY by
 * createTrustedActorContext (which verifies membership through the
 * BOUND membership adapter and derives the role from it). The brand is
 * enforced AT RUNTIME by deriveActorAuthority and createDelegatedGrant
 * — the TypeScript type alone proves nothing, and (M2.2.2) the brand
 * alone is not proof either: the role data itself originates
 * exclusively from the set-once server authority binding.
 */
export interface TrustedActorContext {
  readonly [TRUSTED_ACTOR_BRAND]: true;
  /** Verified principal id (from the authenticated token/membership chain). */
  readonly actor_id: string;
  /** Role derived from the trusted membership record for this workspace. */
  readonly actor_roles: readonly string[];
  /** Exactly one workspace the actor is a verified member of. */
  readonly workspace_id: string;
}

/**
 * Mints the one and only trusted actor context — from the
 * BOUND membership adapter ONLY (M2.2.2; protected by M2.2.3).
 * Fails closed (returns null) when:
 * - a second argument is supplied (legacy caller-supplied providers
 *   are rejected LOUDLY — the caller is not the composition
 *   boundary),
 * - the server authority is not composed,
 * - the principal identifiers are missing/malformed,
 * - the actor is NOT a verified member of the workspace
 *   (cross-workspace delegation impossible),
 * - the membership layer yields no role or an unknown role, or the
 *   membership adapter is unavailable.
 *
 * The returned object is frozen and branded; its roles come ONLY
 * from the bound (protected) membership adapter. A caller can never
 * manufacture it, and can never substitute the membership source it
 * is minted from.
 */
export function createTrustedActorContext(
  principal: { caller_id: unknown; workspace_id: unknown },
  ...legacyProvider: unknown[]
): TrustedActorContext | null {
  // M2.2.2: the membership provider is NOT an argument. Any caller
  // still passing one is attempting to substitute provenance — fail
  // closed, loudly.
  if (legacyProvider.length > 0) return null;
  if (!principal || typeof principal !== "object") return null;
  const boundAuthority = getBoundServerAuthority();
  if (boundAuthority === null) return null;
  const membership = boundAuthority.membershipAdapter;

  const callerId = (principal as { caller_id?: unknown }).caller_id;
  const workspaceId = (principal as { workspace_id?: unknown }).workspace_id;
  if (typeof callerId !== "string" || callerId.trim().length === 0) return null;
  if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) return null;

  // Membership is verified against the requested workspace through
  // the BOUND (protected) adapter — a request payload can never
  // assert it and can never replace the adapter. The adapter itself
  // fails closed (false/null) on any underlying failure.
  const isMember = membership.isMember(callerId, workspaceId);
  if (isMember !== true) return null;
  const role = membership.getRole(callerId, workspaceId);
  if (typeof role !== "string") return null;
  const level = ROLE_LEVELS[role];
  if (level === undefined) return null; // unknown role fails closed
  return Object.freeze({
    [TRUSTED_ACTOR_BRAND]: true as const,
    actor_id: callerId,
    actor_roles: Object.freeze([role]),
    workspace_id: workspaceId,
  });
}

/**
 * Runtime brand check — the compile-time type is never trusted.
 */
function isTrustedActorContext(value: unknown): value is TrustedActorContext {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[TRUSTED_ACTOR_BRAND] === true
  );
}

export interface CreateGrantInput {
  grant_id: string;
  agent_id: string;
  allowed_tools: string[];
  allowed_actions: ("read" | "write")[];
  ttl_seconds: number;
  max_uses?: number;
  /**
   * M2.2.2: `registry` is NO LONGER an accepted input. The canonical
   * tool registry lives in the set-once server authority binding. An
   * input still carrying this field is rejected outright (fail-closed,
   * loudly) so a caller-controlled registry can never redefine which
   * tools exist or which roles they require.
   */
  actor: TrustedActorContext;
}

const MIN_TTL_SECONDS = 1;
const MAX_TTL_SECONDS = 60 * 60 * 4; // 4 hours — delegation windows stay short.

/**
 * Role hierarchy — MUST mirror the authorization provider
 * (viewer < contributor < editor < admin). Derived authority uses
 * the same levels the authorization boundary enforces.
 *
 * M2.2.3: exported (read-only, frozen) so the trusted composition
 * root can VALIDATE every registry entry's required_role against the
 * same hierarchy before accepting it. This is policy data, not an
 * authority-bearing capability.
 */
export const ROLE_LEVELS: Readonly<Record<string, number>> = Object.freeze({
  viewer: 1,
  contributor: 2,
  editor: 3,
  admin: 4,
});

function isNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Derives the actor's tool authority from the TRUSTED (branded) actor
 * context and a tool registry. A role unlocks a tool exactly when
 * the authorization boundary would unlock it:
 * roleLevel(actor) >= roleLevel(tool.required_role).
 *
 * NOTE (M2.2.2/M2.2.3): grant creation passes ONLY the server-bound
 * canonical registry SNAPSHOT here. The registry parameter remains so
 * this stays a pure, testable derivation function — but it grants no
 * authority by itself: createDelegatedGrant never forwards a
 * caller-supplied registry, and the bound snapshot is validated and
 * frozen at composition.
 *
 * Returns null (fail-closed) when the context is missing the runtime
 * brand (a caller-constructed object), is malformed, or the actor
 * holds no valid role.
 */
export function deriveActorAuthority(
  actor: TrustedActorContext,
  registry: RegistryInput,
): { actor_tools: string[]; actor_can_write: boolean } | null {
  // M2.2.1: runtime provenance — the brand must be present. A plain
  // object shaped like TrustedActorContext is rejected here.
  if (!isTrustedActorContext(actor)) return null;
  if (!isNonEmptyString(actor.actor_id)) return null;
  if (!isNonEmptyString(actor.workspace_id)) return null;
  if (!Array.isArray(actor.actor_roles) || actor.actor_roles.length === 0) return null;

  let highestLevel = 0;
  for (const role of actor.actor_roles) {
    if (typeof role !== "string") return null;
    const level = ROLE_LEVELS[role];
    if (level === undefined) return null; // unknown role => fail closed
    if (level > highestLevel) highestLevel = level;
  }
  if (highestLevel === 0) return null;

  if (!registry || typeof registry !== "object") return null;

  const actorTools: string[] = [];
  let canWrite = false;
  for (const [toolName, entry] of Object.entries(registry)) {
    if (!entry || typeof entry !== "object") continue;
    const requiredRole = (entry as RegistryToolEntry).required_role;
    if (typeof requiredRole !== "string") continue;
    const requiredLevel = ROLE_LEVELS[requiredRole];
    if (requiredLevel === undefined) continue;
    if (highestLevel >= requiredLevel) {
      actorTools.push(toolName);
      if ((entry as RegistryToolEntry).is_write_operation === true) {
        canWrite = true;
      }
    }
  }
  if (actorTools.length === 0) return null;
  return { actor_tools: actorTools, actor_can_write: canWrite };
}

/**
 * Creates a validated delegated grant sealed with the SERVER-HELD
 * HMAC integrity service, or returns null (fail-closed) when:
 * - the integrity service is missing/invalid (M2.2.1: fail closed —
 *   there is no unkeyed fallback),
 * - the input still carries caller-supplied actor authority
 *   (actor_tools / actor_can_write),
 * - the input still carries a caller-supplied registry (M2.2.2: the
 *   canonical registry is server-owned — reject loudly),
 * - the server authority is not composed (no bound membership
 *   adapter / canonical registry snapshot),
 * - the actor context is not a runtime-branded trusted context,
 * - the requested grant would exceed the actor's own authority.
 *
 * Subset rule: every requested tool must (a) exist in the
 * SERVER-BOUND canonical registry snapshot and (b) be within the
 * actor's DERIVED tool authority. Requesting "write" requires the actor
 * to hold derived write capability (from the canonical registry — write
 * stays strictly harder than read). This is the
 * agent-privilege-escalation control: an agent can never receive
 * more authority than its delegating actor already had — and
 * self-delegation can never exceed the actor's own permissions.
 */
export function createDelegatedGrant(
  input: CreateGrantInput,
  now: number,
  integrity: GrantIntegrityService | null,
): DelegatedGrant | null {
  if (!input || typeof input !== "object") return null;

  // M2.2.1 CORRECTION A: no integrity service => no grant. Fail
  // closed; never fall back to an unkeyed hash.
  if (!integrity || typeof integrity.seal !== "function") return null;

  // M2.2: caller-supplied actor authority is forbidden — reject
  // outright rather than ignore, so legacy callers fail loudly.
  if (
    Object.prototype.hasOwnProperty.call(input, "actor_tools") ||
    Object.prototype.hasOwnProperty.call(input, "actor_can_write")
  ) {
    return null;
  }

  // M2.2.2 CORRECTION B: caller-supplied registries are forbidden —
  // the canonical registry is server-owned. Reject loudly.
  if (Object.prototype.hasOwnProperty.call(input, "registry")) {
    return null;
  }

  // M2.2.2/M2.2.3: provenance is the set-once server authority
  // binding (composed only by the trusted composition root).
  const boundAuthority = getBoundServerAuthority();
  if (boundAuthority === null) return null;
  const serverRegistry = boundAuthority.toolRegistrySnapshot;

  if (
    !isNonEmptyString(input.grant_id) ||
    !isNonEmptyString(input.agent_id)
  ) {
    return null;
  }

  // M2.2.1 CORRECTION C: runtime-branded trusted context required.
  if (!isTrustedActorContext(input.actor)) return null;

  // M2.2/M2.2.2: derive the actor's authority from the TRUSTED
  // context against the SERVER-BOUND canonical registry snapshot.
  const authority = deriveActorAuthority(input.actor, serverRegistry);
  if (!authority) return null;

  const actorId = input.actor.actor_id;
  const workspaceId = input.actor.workspace_id;

  if (actorId === input.agent_id) return null;

  if (!Array.isArray(input.allowed_tools) || input.allowed_tools.length === 0) return null;
  if (!Array.isArray(input.allowed_actions) || input.allowed_actions.length === 0) return null;

  const actionSet = new Set<string>(input.allowed_actions);
  if (actionSet.size !== input.allowed_actions.length) return null;
  for (const a of input.allowed_actions) {
    if (a !== "read" && a !== "write") return null;
  }
  if (actionSet.has("write") && authority.actor_can_write !== true) return null;

  // Subset enforcement: every allowed tool must be a tool in the
  // SERVER-BOUND canonical registry snapshot AND within the actor's
  // DERIVED authority. Unknown tools fail closed.
  const actorSet = new Set<string>(authority.actor_tools);
  for (const tool of input.allowed_tools) {
    if (!isNonEmptyString(tool)) return null;
    if (!Object.prototype.hasOwnProperty.call(serverRegistry, tool)) return null;
    if (!actorSet.has(tool)) return null;
  }

  if (
    typeof input.ttl_seconds !== "number" ||
    !Number.isFinite(input.ttl_seconds) ||
    input.ttl_seconds < MIN_TTL_SECONDS ||
    input.ttl_seconds > MAX_TTL_SECONDS
  ) {
    return null;
  }

  if (typeof now !== "number" || !Number.isFinite(now)) return null;

  const maxUses =
    input.max_uses === undefined || input.max_uses === 0
      ? 0
      : input.max_uses;
  if (typeof maxUses !== "number" || !Number.isInteger(maxUses) || maxUses < 0) {
    return null;
  }

  const sealFields: GrantSealFields = {
    grant_id: input.grant_id,
    actor_id: actorId,
    agent_id: input.agent_id,
    workspace_id: workspaceId,
    allowed_tools: input.allowed_tools.slice(),
    allowed_actions: input.allowed_actions.slice() as string[],
    expires_at: now + input.ttl_seconds,
    max_uses: maxUses,
    uses: 0,
  };

  return {
    grant_id: sealFields.grant_id,
    actor_id: sealFields.actor_id,
    agent_id: sealFields.agent_id,
    workspace_id: sealFields.workspace_id,
    allowed_tools: sealFields.allowed_tools.slice(),
    allowed_actions: sealFields.allowed_actions as ("read" | "write")[],
    expires_at: sealFields.expires_at,
    max_uses: sealFields.max_uses,
    uses: 0,
    integrity_hash: integrity.seal(sealFields),
  };
}

export interface GrantCheck {
  agent_id: string;
  workspace_id: string;
  tool: string;
  action: "read" | "write";
}

export interface GrantCheckResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates a grant for one attempted use. Fail-closed: every
 * condition must hold, and any unknown/malformed grant is invalid.
 *
 * M2.2.1: the HMAC seal (covering ALL security-relevant fields
 * including the current use count) is recomputed and compared in
 * constant time BEFORE any scope decision — a mutated grant never
 * reaches policy checks. A missing/invalid integrity service fails
 * closed as "integrity_unavailable": secure verification is never
 * skipped.
 */
export function validateGrantUse(
  grant: DelegatedGrant,
  check: GrantCheck,
  now: number,
  integrity: GrantIntegrityService | null,
): GrantCheckResult {
  // M2.2.1 CORRECTION A: fail closed when secure verification is
  // unavailable in a context that requires it.
  if (!integrity || typeof integrity.seal !== "function" || typeof integrity.matches !== "function") {
    return { valid: false, reason: "integrity_unavailable" };
  }
  if (!grant || typeof grant !== "object") {
    return { valid: false, reason: "missing_grant" };
  }
  if (
    !isNonEmptyString(grant.grant_id) ||
    !isNonEmptyString(grant.actor_id) ||
    !isNonEmptyString(grant.agent_id) ||
    !isNonEmptyString(grant.workspace_id)
  ) {
    return { valid: false, reason: "malformed_grant" };
  }
  if (typeof grant.integrity_hash !== "string" || grant.integrity_hash.length === 0) {
    return { valid: false, reason: "malformed_grant" };
  }
  if (typeof now !== "number" || !Number.isFinite(now)) {
    return { valid: false, reason: "invalid_clock" };
  }
  if (!check || typeof check !== "object") {
    return { valid: false, reason: "missing_check" };
  }

  // M2.2.1: keyed HMAC seal over ids, tools, actions, expiry, use
  // limit AND current usage. A recomputed UNKEYED hash presented by
  // an attacker fails here (it is not the HMAC). Any tampering
  // fails closed as "grant_mutated".
  let expectedSeal: string;
  try {
    expectedSeal = integrity.seal({
      grant_id: grant.grant_id,
      actor_id: grant.actor_id,
      agent_id: grant.agent_id,
      workspace_id: grant.workspace_id,
      allowed_tools: grant.allowed_tools,
      allowed_actions: grant.allowed_actions as string[],
      expires_at: grant.expires_at,
      max_uses: grant.max_uses,
      uses: grant.uses,
    });
  } catch {
    // Any structurally malformed field fails closed.
    return { valid: false, reason: "malformed_grant" };
  }
  if (!integrity.matches(grant.integrity_hash, expectedSeal)) {
    return { valid: false, reason: "grant_mutated" };
  }

  if (check.agent_id !== grant.agent_id) {
    return { valid: false, reason: "agent_mismatch" };
  }
  if (check.workspace_id !== grant.workspace_id) {
    return { valid: false, reason: "workspace_mismatch" };
  }
  if (now >= grant.expires_at) {
    return { valid: false, reason: "grant_expired" };
  }
  if (grant.max_uses > 0 && grant.uses >= grant.max_uses) {
    return { valid: false, reason: "use_limit_reached" };
  }
  if (!Array.isArray(grant.allowed_tools) || !grant.allowed_tools.includes(check.tool)) {
    return { valid: false, reason: "tool_not_allowed" };
  }
  if (!Array.isArray(grant.allowed_actions) || !grant.allowed_actions.includes(check.action)) {
    return { valid: false, reason: "action_not_allowed" };
  }
  return { valid: true };
}

export interface ReservationResult {
  reserved: boolean;
  reason?: string;
}

/**
 * M2.2.1 CORRECTION B — ATOMIC grant-use reservation.
 *
 * Consumes one grant use BEFORE the external operation is
 * dispatched:
 *   1. verifies the HMAC integrity seal (mutation/expired-seal
 *      defense, including the current use count),
 *   2. validates the clock and expiry,
 *   3. atomically checks remaining capacity and increments 'uses'
 *      (synchronous check-and-set — atomic within the process),
 *   4. re-seals the grant with the new use count.
 *
 * A grant with one remaining use permits no more than one
 * concurrent execution: the SECOND concurrent reservation observes
 * the incremented use count and fails BEFORE any transport is
 * touched. A rejected reservation means the caller MUST NOT
 * dispatch the external request.
 *
 * Reservation policy (documented, deliberate):
 * - Reservations are NOT refunded on transport failure, timeout,
 *   cancellation, or unsuccessful HTTP responses. Once dispatch is
 *   attempted the outcome may be uncertain (the remote side may
 *   have acted); refunding would allow over-use. A failed external
 *   operation therefore consumes its reserved use.
 * - Reservation state cannot be reset through caller-controlled
 *   mutation: 'uses' is sealed by the server-held HMAC; an attacker
 *   who decrements 'uses' without the secret produces an invalid
 *   seal, and the next validation/reservation fails closed.
 * - The reservation is atomic within ONE process (synchronous
 *   section on the single-threaded event loop). It is NOT a
 *   distributed lock: cross-process capacity enforcement requires
 *   the durable transactional store (D1, M7) — the approved roadmap
 *   dependency, unchanged.
 */
export function reserveGrantUse(
  grant: DelegatedGrant,
  integrity: GrantIntegrityService | null,
  now: number,
): ReservationResult {
  if (!integrity || typeof integrity.seal !== "function" || typeof integrity.matches !== "function") {
    return { reserved: false, reason: "integrity_unavailable" };
  }
  if (!grant || typeof grant !== "object") {
    return { reserved: false, reason: "missing_grant" };
  }
  if (
    !isNonEmptyString(grant.grant_id) ||
    !isNonEmptyString(grant.actor_id) ||
    !isNonEmptyString(grant.agent_id) ||
    !isNonEmptyString(grant.workspace_id)
  ) {
    return { reserved: false, reason: "malformed_grant" };
  }
  if (typeof grant.integrity_hash !== "string" || grant.integrity_hash.length === 0) {
    return { reserved: false, reason: "malformed_grant" };
  }
  if (typeof now !== "number" || !Number.isFinite(now)) {
    return { reserved: false, reason: "invalid_clock" };
  }

  // Seal check (same fail-closed law as validateGrantUse).
  let currentSeal: string;
  try {
    currentSeal = integrity.seal({
      grant_id: grant.grant_id,
      actor_id: grant.actor_id,
      agent_id: grant.agent_id,
      workspace_id: grant.workspace_id,
      allowed_tools: grant.allowed_tools,
      allowed_actions: grant.allowed_actions as string[],
      expires_at: grant.expires_at,
      max_uses: grant.max_uses,
      uses: grant.uses,
    });
  } catch {
    return { reserved: false, reason: "malformed_grant" };
  }
  if (!integrity.matches(grant.integrity_hash, currentSeal)) {
    return { reserved: false, reason: "grant_mutated" };
  }

  if (now >= grant.expires_at) {
    return { reserved: false, reason: "grant_expired" };
  }
  if (typeof grant.uses !== "number" || !Number.isInteger(grant.uses) || grant.uses < 0) {
    return { reserved: false, reason: "malformed_grant" };
  }
  if (grant.max_uses > 0 && grant.uses >= grant.max_uses) {
    return { reserved: false, reason: "use_limit_reached" };
  }

  // ATOMIC consumption: synchronous check-and-increment. Concurrent
  // reservations serialize here; only capacity-remaining requests
  // proceed.
  grant.uses = grant.uses + 1;

  // Re-seal with the new use count so the reservation itself cannot
  // be rolled back by caller-controlled mutation.
  const resealed = integrity.seal({
    grant_id: grant.grant_id,
    actor_id: grant.actor_id,
    agent_id: grant.agent_id,
    workspace_id: grant.workspace_id,
    allowed_tools: grant.allowed_tools,
    allowed_actions: grant.allowed_actions as string[],
    expires_at: grant.expires_at,
    max_uses: grant.max_uses,
    uses: grant.uses,
  });
  grant.integrity_hash = resealed;

  return { reserved: true };
}
