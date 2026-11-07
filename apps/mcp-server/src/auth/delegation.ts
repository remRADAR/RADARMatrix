/**
 * RADARMatrix Delegated Authority (M2, Phase P4)
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
 * - allowed_actions must be a non-empty subset of {read, write}
 *   containing only known actions. No "admin", no wildcard.
 * - Expiry and use limits are enforced on EVERY validation.
 * - The grant binds exactly one agent identity and one workspace.
 *   Any mismatch fails closed.
 * - No RADAR superuser: RADAR's orchestration grants are subject to
 *   the same subset rule as any human actor.
 *
 * Zero runtime npm dependencies. Erasable-syntax TypeScript only
 * (Node type-stripping compatible). The tool registry is an explicit
 * input rather than an import so this module does not widen the
 * type-check scope.
 */

export interface DelegatedGrant {
  /** Unique grant id (caller-supplied or generated). */
  grant_id: string;
  /** Verified principal delegating authority (never an agent). */
  actor_id: string;
  /** The specialist agent identity receiving the grant. */
  agent_id: string;
  /** Exactly one workspace. Grants never span workspaces. */
  workspace_id: string;
  /** Tools the agent may call — must be a subset of the actor's tools. */
  allowed_tools: string[];
  /** "read" and/or "write". Subset of the actor's write capability. */
  allowed_actions: ("read" | "write")[];
  /** Epoch seconds. Validation fails at/after this time. */
  expires_at: number;
  /** 0 = unlimited; otherwise validation fails after this many uses. */
  max_uses: number;
  /** Current use count (mutated by recordGrantUse). */
  uses: number;
}

export interface CreateGrantInput {
  grant_id: string;
  actor_id: string;
  actor_tools: string[];
  actor_can_write: boolean;
  agent_id: string;
  workspace_id: string;
  allowed_tools: string[];
  allowed_actions: ("read" | "write")[];
  ttl_seconds: number;
  max_uses?: number;
  /** Tool registry to validate tool names against (explicit input). */
  registry: Record<string, unknown>;
}

const MIN_TTL_SECONDS = 1;
const MAX_TTL_SECONDS = 60 * 60 * 4; // 4 hours — delegation windows stay short.

function isNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Creates a validated delegated grant, or returns null (fail-closed)
 * when the requested grant would exceed the actor's own authority.
 *
 * Subset rule: every requested tool must (a) exist in the tool
 * registry and (b) be within the actor's own tool list. Requesting
 * "write" requires the actor to hold write capability. This is the
 * agent-privilege-escalation control: an agent can never receive
 * more authority than its delegating actor already had.
 */
export function createDelegatedGrant(
  input: CreateGrantInput,
  now: number,
): DelegatedGrant | null {
  if (!input || typeof input !== "object") return null;
  if (
    !isNonEmptyString(input.grant_id) ||
    !isNonEmptyString(input.actor_id) ||
    !isNonEmptyString(input.agent_id) ||
    !isNonEmptyString(input.workspace_id)
  ) {
    return null;
  }
  if (input.actor_id === input.agent_id) return null;

  if (!Array.isArray(input.actor_tools) || input.actor_tools.length === 0) return null;
  if (!Array.isArray(input.allowed_tools) || input.allowed_tools.length === 0) return null;
  if (!Array.isArray(input.allowed_actions) || input.allowed_actions.length === 0) return null;

  const actionSet = new Set<string>(input.allowed_actions);
  if (actionSet.size !== input.allowed_actions.length) return null;
  for (const a of input.allowed_actions) {
    if (a !== "read" && a !== "write") return null;
  }
  if (actionSet.has("write") && input.actor_can_write !== true) return null;

  // Subset enforcement: every allowed tool must be a registered tool
  // AND within the actor's own authority.
  const actorSet = new Set<string>(input.actor_tools);
  for (const tool of input.allowed_tools) {
    if (!isNonEmptyString(tool)) return null;
    if (!input.registry || !Object.prototype.hasOwnProperty.call(input.registry, tool)) return null;
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

  const maxUses =
    input.max_uses === undefined || input.max_uses === 0
      ? 0
      : input.max_uses;
  if (typeof maxUses !== "number" || !Number.isInteger(maxUses) || maxUses < 0) {
    return null;
  }

  return {
    grant_id: input.grant_id,
    actor_id: input.actor_id,
    agent_id: input.agent_id,
    workspace_id: input.workspace_id,
    allowed_tools: input.allowed_tools.slice(),
    allowed_actions: input.allowed_actions.slice(),
    expires_at: now + input.ttl_seconds,
    max_uses: maxUses,
    uses: 0,
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
  if (!check || typeof check !== "object") {
    return { valid: false, reason: "missing_check" };
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
