/**
 * RADARMatrix Delegated Authority (M2, Phase P4; hardened M2.2)
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
 * - M2.2 SECURITY CORRECTION: the actor's authority is DERIVED from
 *   a trusted server-side actor context (verified principal roles +
 *   the tool registry) — it is NEVER caller-supplied. Any input that
 *   still carries actor_tools or actor_can_write is rejected
 *   outright: a caller must not be able to assert its own authority.
 * - allowed_actions must be a non-empty subset of {read, write}
 *   containing only known actions. No "admin", no wildcard.
 * - Expiry and use limits are enforced on EVERY validation.
 * - The grant binds exactly one agent identity and one workspace.
 *   Any mismatch fails closed.
 * - M2.2: every grant carries an integrity hash over its canonical
 *   fields. validateGrantUse recomputes the hash — a mutated grant
 *   (tampered tool list, extended expiry, inflated use limit) is
 *   rejected as "grant_mutated".
 * - No RADAR superuser: RADAR's orchestration grants are subject to
 *   the same subset rule as any human actor.
 *
 * Zero runtime npm dependencies. Erasable-syntax TypeScript only
 * (Node type-stripping compatible). The tool registry is an explicit
 * input rather than an import so this module does not widen the
 * type-check scope.
 */

import { createHash } from "node:crypto";

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
  /** Current use count (mutated by recordGrantUse). */
  uses: number;
  /** M2.2: sha256 over the canonical grant fields (mutation seal). */
  integrity_hash: string;
}

/**
 * M2.2: the minimal tool-registry entry shape this module relies on.
 * The registry stays an explicit input (Record) — this interface only
 * documents the fields deriveActorAuthority reads.
 */
export interface RegistryToolEntry {
  required_role?: unknown;
  is_write_operation?: unknown;
}

export interface RegistryInput {
  [tool: string]: RegistryToolEntry | unknown;
}

/**
 * M2.2: trusted server-side actor context. The gateway (or any
 * delegating orchestrator) builds this from the AUTHENTICATED
 * principal and its membership roles — never from request parameters.
 * Caller-supplied actor_tools/actor_can_write are forbidden.
 */
export interface TrustedActorContext {
  /** Verified principal id (from the authenticated token/membership chain). */
  actor_id: string;
  /** Verified roles for this actor IN the delegated workspace. */
  actor_roles: string[];
  /** Exactly one workspace the actor is a verified member of. */
  workspace_id: string;
}

export interface CreateGrantInput {
  grant_id: string;
  agent_id: string;
  allowed_tools: string[];
  allowed_actions: ("read" | "write")[];
  ttl_seconds: number;
  max_uses?: number;
  /** Tool registry to validate tool names against (explicit input). */
  registry: RegistryInput;
  /**
   * M2.2: trusted server-side actor context (required). Actor
   * authority is DERIVED from actor_roles + the registry.
   */
  actor: TrustedActorContext;
}

const MIN_TTL_SECONDS = 1;
const MAX_TTL_SECONDS = 60 * 60 * 4; // 4 hours — delegation windows stay short.

/**
 * Role hierarchy — MUST mirror the authorization provider
 * (viewer < contributor < editor < admin). Derived authority uses
 * the same levels the authorization boundary enforces.
 */
const ROLE_LEVELS: Record<string, number> = {
  viewer: 1,
  contributor: 2,
  editor: 3,
  admin: 4,
};

function isNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * M2.2: derives the actor's tool authority from the TRUSTED actor
 * context and the tool registry. A role unlocks a tool exactly when
 * the authorization boundary would unlock it:
 * roleLevel(actor) >= roleLevel(tool.required_role).
 *
 * Returns null (fail-closed) when the context is malformed or the
 * actor holds no valid role.
 */
export function deriveActorAuthority(
  actor: TrustedActorContext,
  registry: RegistryInput,
): { actor_tools: string[]; actor_can_write: boolean } | null {
  if (!actor || typeof actor !== "object") return null;
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
 * M2.2: canonical integrity hash over every security-relevant grant
 * field. Sealed at creation; recomputed by validateGrantUse.
 */
function computeGrantHash(grant: {
  grant_id: string;
  actor_id: string;
  agent_id: string;
  workspace_id: string;
  allowed_tools: string[];
  allowed_actions: string[];
  expires_at: number;
  max_uses: number;
}): string {
  const canonical =
    grant.grant_id +
    "\n" +
    grant.actor_id +
    "\n" +
    grant.agent_id +
    "\n" +
    grant.workspace_id +
    "\n" +
    grant.allowed_tools.slice().sort().join(",") +
    "\n" +
    grant.allowed_actions.slice().sort().join(",") +
    "\n" +
    String(grant.expires_at) +
    "\n" +
    String(grant.max_uses);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Creates a validated delegated grant, or returns null (fail-closed)
 * when the requested grant would exceed the actor's own authority.
 *
 * M2.2: the actor's authority is DERIVED from the trusted actor
 * context (authenticated principal + verified roles). Inputs that
 * still carry the legacy caller-supplied actor_tools or
 * actor_can_write fields are rejected outright — the caller can
 * never assert its own authority.
 *
 * Subset rule: every requested tool must (a) exist in the tool
 * registry and (b) be within the actor's DERIVED tool authority.
 * Requesting "write" requires the actor to hold derived write
 * capability. This is the agent-privilege-escalation control: an
 * agent can never receive more authority than its delegating actor
 * already had.
 */
export function createDelegatedGrant(
  input: CreateGrantInput,
  now: number,
): DelegatedGrant | null {
  if (!input || typeof input !== "object") return null;

  // M2.2: caller-supplied actor authority is forbidden — reject
  // outright rather than ignore, so legacy callers fail loudly.
  if (
    Object.prototype.hasOwnProperty.call(input, "actor_tools") ||
    Object.prototype.hasOwnProperty.call(input, "actor_can_write")
  ) {
    return null;
  }

  if (
    !isNonEmptyString(input.grant_id) ||
    !isNonEmptyString(input.agent_id)
  ) {
    return null;
  }

  // M2.2: derive the actor's authority from the TRUSTED context.
  const authority = deriveActorAuthority(input.actor, input.registry);
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

  // Subset enforcement: every allowed tool must be a registered tool
  // AND within the actor's DERIVED authority.
  const actorSet = new Set<string>(authority.actor_tools);
  for (const tool of input.allowed_tools) {
    if (!isNonEmptyString(tool)) return null;
    if (!Object.prototype.hasOwnProperty.call(input.registry, tool)) return null;
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

  const grant = {
    grant_id: input.grant_id,
    actor_id: actorId,
    agent_id: input.agent_id,
    workspace_id: workspaceId,
    allowed_tools: input.allowed_tools.slice(),
    allowed_actions: input.allowed_actions.slice(),
    expires_at: now + input.ttl_seconds,
    max_uses: maxUses,
  };

  const integrityHash = computeGrantHash({
    ...grant,
    allowed_actions: grant.allowed_actions as string[],
  });

  return {
    ...grant,
    uses: 0,
    integrity_hash: integrityHash,
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
 * M2.2: the integrity hash is recomputed and compared BEFORE any
 * scope decision — a mutated grant never reaches policy checks.
 */
export function validateGrantUse(
  grant: DelegatedGrant,
  check: GrantCheck,
  now: number,
): GrantCheckResult {
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

  // M2.2: mutation seal — the hash covers ids, tools, actions,
  // expiry and use limit. Any tampering fails closed here.
  let expectedHash: string;
  try {
    expectedHash = computeGrantHash({
    grant_id: grant.grant_id,
    actor_id: grant.actor_id,
    agent_id: grant.agent_id,
    workspace_id: grant.workspace_id,
    allowed_tools: grant.allowed_tools,
    allowed_actions: grant.allowed_actions as string[],
    expires_at: grant.expires_at,
    max_uses: grant.max_uses,
  });
  } catch {
    // Any structurally malformed field fails closed.
    return { valid: false, reason: "malformed_grant" };
  }
  if (expectedHash !== grant.integrity_hash) {
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

/**
 * Records a consumed use after a successful validation + execution.
 * Over-use beyond max_uses is rejected (the caller must not double-
 * count).
 */
export function recordGrantUse(grant: DelegatedGrant): boolean {
  if (!grant || typeof grant !== "object") return false;
  if (grant.max_uses > 0 && grant.uses >= grant.max_uses) return false;
  grant.uses += 1;
  return true;
}
