/**
 * @radarmatrix/contracts
 *
 * Provider, storage, runtime, and agent adapter contracts for RADARMatrix.
 * M1a deliverable (2026-11-01).
 *
 * These interfaces are the stable seams between Matrix Core and its
 * providers. They are TYPE-ONLY today: no runtime code in this package
 * executes yet, and nothing is simulated. The interfaces mirror the
 * verified gateway/provider implementations so future adapters can be
 * built against a stable contract without weakening the fail-closed
 * security model.
 *
 * Contract law (binding):
 * 1. Fail closed: absence of evidence is denial of access.
 * 2. Unknown principals never receive implicit access.
 * 3. Membership is an explicit map — no wildcard or fallback membership.
 * 4. Authentication (identity), membership (workspace access), and
 *    authorization (tool-level RBAC) stay separate concerns.
 * 5. Audit events are generated for every write operation, success or not.
 * 6. Adapters report honest status. Never simulate capabilities.
 *
 * Statuses follow the implemented / connected / simulated / planned /
 * unavailable vocabulary. See README.md for the current status table.
 */

export type Role = "viewer" | "contributor" | "editor" | "admin";
export type CallerId = string;
export type WorkspaceId = string;
export type ToolName = string;
export type ISO8601Timestamp = string;

/**
 * The principal emitted by an AuthenticationProvider.
 *
 * M1a follow-up (Finding B): roles is string[], NOT Role[]. The
 * development authentication provider accepts arbitrary non-empty
 * role strings from configuration (normalizePrincipals), and the
 * authorization provider correctly filters unknown roles
 * (getHighestRole). The contract describes the implementation
 * accurately; the Role union remains the type of validated role
 * definitions (tool registry, role hierarchy).
 *
 * Note: the gateway maps principal.roles to caller_roles on its
 * internal authenticated request; the authorization provider
 * accepts either field.
 */
export interface Principal {
  caller_id: CallerId;
  roles: readonly string[];
  workspace_id: WorkspaceId;
  request_id: string;
  timestamp: ISO8601Timestamp;
}

/** Mirrors providers/authentication.cjs (development fixture implementation). */
export interface AuthenticationProvider {
  authenticate(request: unknown): Principal | null;
  hasPrincipal(callerId: CallerId): boolean;
  getPrincipal(callerId: CallerId): { caller_id: CallerId; roles: string[] } | null;
  snapshot(): Record<CallerId, { caller_id: CallerId; roles: string[] }>;
}

/** Mirrors providers/membership.cjs (explicit, fail-closed map). */
export interface MembershipProvider {
  isMember(callerId: CallerId, workspaceId: WorkspaceId): boolean;
  getWorkspaces(callerId: CallerId): WorkspaceId[];
  hasCaller(callerId: CallerId): boolean;
  snapshot(): Record<CallerId, WorkspaceId[]>;
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  required_role: Role;
  is_write_operation: boolean;
  input_schema: Record<string, unknown>;
}

export type ToolRegistry = Record<ToolName, ToolDefinition>;

/** Mirrors providers/authorization.cjs (role hierarchy viewer=1 .. admin=4). */
export interface AuthorizationProvider {
  isAuthorized(principal: Principal, toolRegistry: ToolRegistry, toolName: ToolName): boolean;
  getHighestRole(roles: readonly string[]): Role | null;
  getRoleLevel(role: string): number;
  snapshot(): { roles: Record<Role, number> };
}

export interface AuditEvent {
  operation: string;
  caller_id: CallerId;
  workspace_id: WorkspaceId;
  tool: ToolName;
  timestamp: ISO8601Timestamp;
  is_write: boolean;
  success: boolean;
  error_code?: string;
}

/** Interface only. Today the gateway audits to console (dev boundary). */
export interface AuditSink {
  append(event: AuditEvent): void | Promise<void>;
}

/**
 * Interface only. runtime/workspace-store.mjs (JSON) is the reference
 * implementation shape. The Cloudflare D1 adapter is planned at
 * milestone M7 — no database has been created.
 */
export interface StorageAdapter {
  readonly id: string;
  readonly status: "connected" | "unavailable";
  init(): Promise<void>;
  readWorkspace(workspaceId: WorkspaceId): Promise<unknown>;
  writeWorkspace(workspaceId: WorkspaceId, data: unknown): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
}

/**
 * RM-IEP/1 execution request shape. Arbitrary command strings are
 * deliberately not representable at this boundary: adapters receive an
 * allowlisted named tool and validated object arguments only.
 */
export interface RuntimeExecutionRequest {
  protocol: "RM-IEP/1";
  tool: ToolName;
  arguments: Record<string, unknown>;
  session_id: string;
  /** Required for any consequential operation. Absence means deny. */
  approvalToken?: string;
}

export interface RuntimeExecutionResult {
  status: "executed" | "unavailable" | "denied";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  notes?: string;
}

/**
 * Interface only. The first real runtime adapter is the planned
 * github-readonly adapter (milestone M3). Today there is NO runtime
 * execution anywhere — agent routing is plan-only.
 */
export interface RuntimeAdapter {
  readonly id: string;
  readonly status: "connected" | "unavailable";
  describe(): { id: string; capabilities: string[]; status: string };
  execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult>;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  adapter: string;
  allowedMcpTools: ToolName[];
  status: "implemented" | "simulated" | "planned" | "unavailable";
}

/** Interface only. runtime/agent-routing.cjs is the plan-only seed. */
export interface AgentAdapter {
  readonly id: string;
  readonly status: "connected" | "unavailable";
  plan(goal: string, options?: { category?: string; maxSpecialists?: number }): unknown;
}

/** Interface only (planned). */
export interface RateLimiter {
  check(key: string): { allowed: boolean; remaining: number };
}

export interface GatewayResponse {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string; status: number };
  metadata: {
    request_id: string;
    timestamp: ISO8601Timestamp;
    execution_time_ms: number;
  };
}

/* ==========================================================================
 * M2 SECTION (2026-11-01, owner-approved) — production identity architecture
 * ==========================================================================
 *
 * Added in M2 Phase P0. Still TYPE-ONLY: no runtime code in this package.
 *
 * The branded ladder below mirrors the gateway's security pipeline at the
 * type level, so untrusted input cannot flow into authorized execution
 * unchecked. A brand can only be constructed by the component that owns
 * the corresponding verification step:
 *
 *   UnverifiedIdentity            (raw request context — never trusted)
 *     -> VerifiedPrincipal        (only from a token-verifying
 *                                 AuthenticationProvider)
 *       -> WorkspaceMember       (only from a MembershipProvider)
 *         -> AuthorizedContext   (only from an AuthorizationProvider)
 *           -> DelegatedAuthority (only from delegated-grant validation)
 *             -> VerifiedApproval (only from ApprovalProvider verification)
 *
 * Roles and workspace access are NEVER taken from token claims: claims
 * prove identity only. Authority is resolved from membership records and
 * the tool registry at request time (fail closed).
 */

declare const __verifiedPrincipal: unique symbol;
declare const __workspaceMember: unique symbol;
declare const __authorizedContext: unique symbol;
declare const __delegatedAuthority: unique symbol;
declare const __verifiedApproval: unique symbol;

/** Raw, untrusted request context. Never a basis for access. */
export interface UnverifiedIdentity {
  readonly caller_id?: string;
  readonly workspace_id?: string;
  readonly token?: string;
}

/** A principal whose identity was cryptographically verified. */
export type VerifiedPrincipal = Principal & {
  readonly [__verifiedPrincipal]: true;
};

/** A verified principal's validated membership in one workspace. */
export type WorkspaceMember = {
  caller_id: CallerId;
  workspace_id: WorkspaceId;
  role: Role;
  readonly [__workspaceMember]: true;
};

/** A principal + tool pair that passed RBAC authorization. */
export type AuthorizedContext = {
  principal: VerifiedPrincipal;
  tool: ToolName;
  readonly [__authorizedContext]: true;
};

/** Authority granted to an agent, strictly narrower than its actor's. */
export type DelegatedAuthority = {
  grant: DelegatedGrant;
  readonly [__delegatedAuthority]: true;
};

/** An approval token that passed signature, scope, and single-use checks. */
export type VerifiedApproval = {
  claims: ApprovalClaims;
  readonly [__verifiedApproval]: true;
};

/**
 * Claims of a control-plane-issued gateway token (Ed25519, compact JWT).
 * Identity claims only — roles/workspace access are NOT token claims.
 */
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

export interface TokenService {
  issue(claims: GatewayTokenClaims, signingKeyPem: string): string;
  verify(
    token: string,
    publicKeyPem: string,
    expected: { issuer: string; audience: string; isDenied?: (jti: string) => boolean },
  ): GatewayTokenClaims | null;
}

/** A registered machine identity (RADAR orchestration, adapters, agents). */
export interface ServiceIdentity {
  readonly id: string;
  readonly kind: "radar" | "agent" | "tool-adapter" | "integration";
  readonly status: "implemented" | "planned" | "unavailable";
}

/**
 * Delegated grant (M2 §7 of the assessment): an explicit, task-scoped,
 * expiring subset of the delegating actor's authority. An agent NEVER
 * inherits the actor's full permissions.
 */
export interface DelegatedGrant {
  grant_id: string;
  actor_id: CallerId;
  agent_id: string;
  workspace_id: WorkspaceId;
  task_id?: string;
  /** Must be a subset of the actor's permitted tools. */
  allowed_tools: readonly ToolName[];
  allowed_actions: readonly ("read" | "write")[];
  expires_at: number;
  max_uses: number;
  uses: number;
}

/**
 * Claims of a single-use approval token for a consequential action,
 * verified by the actual execution adapter (never by an intermediate
 * layer). Absence of a required approval means deny.
 */
export interface ApprovalClaims {
  jti: string;
  action: string;
  resource_ids: readonly string[];
  workspace_id: WorkspaceId;
  actor_id: CallerId;
  grant_id?: string;
  session_id?: string;
  iat: number;
  exp: number;
}

export interface ApprovalProvider {
  issue(request: {
    action: string;
    resource_ids: readonly string[];
    workspace_id: WorkspaceId;
    actor_id: CallerId;
    grant_id?: string;
    session_id?: string;
    ttl_seconds: number;
  }): Promise<string>;
  verify(
    token: string,
    expected: {
      action: string;
      resource_id: string;
      workspace_id: WorkspaceId;
      grant_id?: string;
      now: number;
    },
  ): Promise<VerifiedApproval | null>;
}

/**
 * Membership with authority semantics (M2): the durable membership record
 * is the ONLY source of roles. Extends the fail-closed MembershipProvider
 * law — no wildcard, no fallback, unknown roles never granted.
 */
export interface MembershipAuthorityProvider extends MembershipProvider {
  getRole(callerId: CallerId, workspaceId: WorkspaceId): Role | null;
  grant(callerId: CallerId, workspaceId: WorkspaceId, role: Role): void;
  revoke(callerId: CallerId, workspaceId: WorkspaceId): void;
}

/** Structured authentication-failure event (P1: denial monitoring). */
export interface AuthFailureEvent {
  reason:
    | "missing_token"
    | "malformed_token"
    | "bad_signature"
    | "expired"
    | "not_yet_valid"
    | "wrong_issuer"
    | "wrong_audience"
    | "revoked"
    | "identity_mismatch"
    | "not_a_member"
    | "no_role";
  subject: string;
  timestamp: ISO8601Timestamp;
}


/* ========================================================================
 * Durable Transactional Execution Layer — PR A contract baseline
 *
 * Type-only contracts. These types do NOT authorize or execute operations.
 * The runtime must keep consequential dispatch disabled until the D1
 * repository, binding-level acceptance tests, and provider reconciliation
 * gates have passed and are separately approved.
 * ====================================================================== */

export type ExecutionState =
  | "CREATED"
  | "RESERVED"
  | "APPROVED"
  | "DISPATCHING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "UNCERTAIN";

export type DurableTransactionStatus =
  | "COMMITTED"
  | "ROLLED_BACK"
  | "COMMIT_UNKNOWN"
  | "CONFLICT"
  | "STORAGE_UNAVAILABLE";

/**
 * Identity is server-composed. The request fingerprint is immutable and
 * binds the canonical tool/action/resource representation approved upstream.
 */
export interface ExecutionIdentity {
  readonly execution_id: string;
  readonly workspace_id: WorkspaceId;
  readonly actor_id: CallerId;
  readonly idempotency_key: string;
  readonly tool: ToolName;
  readonly action: string;
  readonly resource_fingerprint: string;
}

export interface DurableExecution extends ExecutionIdentity {
  readonly state: ExecutionState;
  readonly version: number;
  readonly created_at: ISO8601Timestamp;
  readonly updated_at: ISO8601Timestamp;
  readonly provider_request_id?: string;
  readonly outcome_evidence_id?: string;
}

export interface CreateExecutionInput extends ExecutionIdentity {
  readonly request_fingerprint: string;
}

export type CreateExecutionResult =
  | { readonly kind: "CREATED"; readonly execution: DurableExecution }
  | { readonly kind: "REPLAY"; readonly execution: DurableExecution }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" };

export interface ExecutionTransition {
  readonly execution_id: string;
  readonly expected_state: ExecutionState;
  readonly expected_version: number;
  readonly next_state: ExecutionState;
  readonly event: DurableAuditEvent;
}

export interface DurableAuditEvent {
  readonly event_id: string;
  readonly workspace_id: WorkspaceId;
  readonly actor_id: CallerId;
  readonly execution_id: string;
  readonly sequence: number;
  readonly event_type: string;
  readonly from_state?: ExecutionState;
  readonly to_state?: ExecutionState;
  readonly occurred_at: ISO8601Timestamp;
  /** Sanitized, bounded metadata only; never credentials or raw secrets. */
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

/** Opaque handle scoped to one repository transaction. */
export interface TransactionContext {
  readonly transaction_id: string;
}

export type TransactionResult<T> =
  | { readonly status: "COMMITTED"; readonly value: T }
  | { readonly status: "ROLLED_BACK"; readonly error_code: string }
  | { readonly status: "COMMIT_UNKNOWN"; readonly transaction_id: string }
  | { readonly status: "CONFLICT"; readonly conflict_code: string }
  | { readonly status: "STORAGE_UNAVAILABLE"; readonly retryable: boolean };

/**
 * Executes one logical storage boundary. Implementations must not hold this
 * transaction open during external network I/O. An unknown result is never
 * equivalent to rollback and never permits dispatch.
 */
export interface TransactionRunner {
  run<T>(
    operation: (transaction: TransactionContext) => Promise<T>,
  ): Promise<TransactionResult<T>>;
}

export interface ExecutionRepository {
  createOrReplay(
    transaction: TransactionContext,
    input: CreateExecutionInput,
  ): Promise<CreateExecutionResult>;
  getByScopedIdempotencyKey(
    transaction: TransactionContext,
    key: Pick<ExecutionIdentity, "workspace_id" | "actor_id" | "idempotency_key">,
  ): Promise<DurableExecution | null>;
  transition(
    transaction: TransactionContext,
    change: ExecutionTransition,
  ): Promise<DurableExecution | null>;
  listUnresolved(
    transaction: TransactionContext,
    input: { readonly before: ISO8601Timestamp; readonly limit: number },
  ): Promise<readonly DurableExecution[]>;
}

export interface ReservationRepository {
  reserveGrantUse(
    transaction: TransactionContext,
    input: {
      readonly execution_id: string;
      readonly grant_id: string;
      readonly workspace_id: WorkspaceId;
      readonly actor_id: CallerId;
      readonly agent_id: string;
      readonly tool: ToolName;
      readonly action: string;
      readonly expected_seal: string;
      readonly now: ISO8601Timestamp;
    },
  ): Promise<{ readonly reserved: true; readonly reservation_id: string } | { readonly reserved: false; readonly reason: string }>;
}

export interface ApprovalClaimRepository {
  claim(
    transaction: TransactionContext,
    input: {
      readonly jti: string;
      readonly execution_id: string;
      readonly workspace_id: WorkspaceId;
      readonly actor_id: CallerId;
      readonly action: string;
      readonly resource_fingerprint: string;
      readonly expires_at: ISO8601Timestamp;
      readonly now: ISO8601Timestamp;
    },
  ): Promise<{ readonly claimed: true } | { readonly claimed: false; readonly reason: string }>;
}

export interface DurableAuditRepository {
  append(transaction: TransactionContext, event: DurableAuditEvent): Promise<void>;
  getForExecution(
    transaction: TransactionContext,
    executionId: string,
  ): Promise<readonly DurableAuditEvent[]>;
}

export type ReconciliationOutcome =
  | "CONFIRMED_SUCCEEDED"
  | "CONFIRMED_FAILED"
  | "STILL_PENDING"
  | "UNKNOWN"
  | "UNSUPPORTED"
  | "RECONCILIATION_CONFLICT";

export interface ReconciliationEvidence {
  readonly provider: string;
  readonly provider_request_id?: string;
  readonly observed_at: ISO8601Timestamp;
  readonly outcome: ReconciliationOutcome;
  readonly evidence_reference?: string;
  readonly evidence_digest?: string;
}

/** Provider contract only; implementations must declare real capabilities. */
export interface ReconciliationAdapter {
  readonly capabilities: {
    readonly supports_idempotency_keys: boolean;
    readonly supports_operation_lookup: boolean;
  };
  reconcile(input: {
    readonly execution_id: string;
    readonly idempotency_key: string;
    readonly provider_request_id?: string;
    readonly request_fingerprint: string;
  }): Promise<ReconciliationEvidence>;
}

/* ==========================================================================
 * M4 SECTION (2026-11-25) — control-plane domain contracts
 * ==========================================================================
 *
 * PROPOSAL (Rule 9): additive, type-only draft authored as an isolated
 * branch + owner-gated draft PR. Owner authorization for contract-first
 * M4 authoring was recorded in-session on 2026-11-25 (acceleration plan,
 * docs/ACCELERATED-DEVELOPMENT-PLAN.md §8 "Author M4 contracts NOW
 * (contracts-first) while the owner reviews the security chain").
 *
 * Note on M4 naming (recorded conflict, owner to reconcile): the Phase 1
 * build plan defines M4 as the Matrix IDE, while HANDOFF.md and the
 * accelerated development plan use "M4 contracts-first" and place the IDE
 * under W2. This section follows the newer authorities (HANDOFF.md,
 * 2026-11-04, and docs/ACCELERATED-DEVELOPMENT-PLAN.md). No milestone is
 * declared complete or moved by these type declarations.
 *
 * This section defines the core domain seams shared by the workstreams:
 * W3 (tasks/planning/routing), W4 (persistence schemas), W2 (event feed
 * for panels). It adds no runtime code, executes nothing, and widens no
 * existing contract. Consumers import these types; implementations must
 * preserve the existing fail-closed pipeline
 * (authenticate → authorize → isolation → audit → execute) and the
 * durable execution laws above.
 *
 * Domain law (binding for implementations of these contracts):
 * 1. No task may reach a terminal COMPLETED_* state because an agent
 *    reported success. Only independent verification evidence produces
 *    COMPLETED_VERIFIED (see VerificationReport).
 * 2. Scheduling is idempotent per (workspace_id, idempotency_key);
 *    duplicate scheduling of the same task is a conflict, never a
 *    second task.
 * 3. Consequential actions carry an ApprovalClaims token verified by
 *    the real execution adapter. This layer never issues, stores, or
 *    re-verifies approval tokens — ApprovalProvider already owns that.
 * 4. Digests over evidence that supports authority or completion claims
 *    are keyed (HMAC) per the M2.2.1 law: recomputed unkeyed hashes are
 *    never accepted for authority-bearing data.
 * 5. Every state is honestly reportable: BLOCKED and COMPLETED_UNVERIFIED
 *    exist so systems can tell the truth instead of failing silently.
 * ======================================================================== */

/** Stable identifier of a project within one workspace. */
export type ProjectId = string;
/** Stable identifier of a task within one project. */
export type TaskId = string;

export interface Project {
  readonly project_id: ProjectId;
  readonly workspace_id: WorkspaceId;
  readonly title: string;
  readonly goal: string;
  readonly repository?: {
    readonly owner: string;
    readonly name: string;
    readonly default_branch?: string;
  };
  readonly created_at: ISO8601Timestamp;
  readonly updated_at: ISO8601Timestamp;
}

export type ProjectStatus =
  | "DRAFT"
  | "PLANNING"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED_VERIFIED"
  | "COMPLETED_UNVERIFIED"
  | "BLOCKED"
  | "CANCELLED";

export interface ProjectState {
  readonly project: Project;
  readonly status: ProjectStatus;
  /** Present when BLOCKED; names what must be resolved, never a secret. */
  readonly blocking_reason?: string;
  readonly task_graph_version: number;
}

/** An independently checkable condition a task must satisfy. */
export interface AcceptanceCriterion {
  readonly criterion_id: string;
  readonly description: string;
  /** The kind of evidence that can prove or refute this criterion. */
  readonly evidence_kind:
    | "test_run"
    | "file_diff"
    | "build_result"
    | "live_check"
    | "artifact_inspection"
    | "human_review";
  readonly required: boolean;
}

/**
 * Task states form a strict lifecycle. There is deliberately no
 * "COMPLETED" state reachable from an agent report: only verification
 * produces COMPLETED_VERIFIED, and unverified final work is
 * COMPLETED_UNVERIFIED (visible, labeled, never silently "done").
 */
export type TaskState =
  | "PLANNED"
  | "READY"
  | "ASSIGNED"
  | "AWAITING_APPROVAL"
  | "EXECUTING"
  | "UNDER_VERIFICATION"
  | "COMPLETED_VERIFIED"
  | "COMPLETED_UNVERIFIED"
  | "VERIFICATION_FAILED"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED";

export interface Task {
  readonly task_id: TaskId;
  readonly project_id: ProjectId;
  readonly workspace_id: WorkspaceId;
  readonly title: string;
  readonly description: string;
  readonly state: TaskState;
  readonly acceptance_criteria: readonly AcceptanceCriterion[];
  /** Server-composed idempotency scope; duplicate keys conflict. */
  readonly idempotency_key: string;
  readonly assigned_agent_id?: string;
  /** Present when BLOCKED; names what must be resolved. */
  readonly blocking_reason?: string;
  readonly created_at: ISO8601Timestamp;
  readonly updated_at: ISO8601Timestamp;
}

/** A declared ordering constraint between two tasks of one project. */
export interface TaskDependency {
  readonly task_id: TaskId;
  readonly depends_on: TaskId;
  readonly kind: "finish_to_start";
}

/**
 * An immutable plan revision. Plans are revised by producing a new
 * revision, never by mutating history: prior revisions stay inspectable.
 */
export interface TaskGraph {
  readonly project_id: ProjectId;
  readonly revision: number;
  readonly tasks: readonly Task[];
  readonly dependencies: readonly TaskDependency[];
  readonly created_at: ISO8601Timestamp;
}

/** The deterministic explanation attached to every routing decision. */
export interface SpecialistSelection {
  readonly task_id: TaskId;
  readonly selected_agent_id: string;
  /**
   * Deterministic reason code (e.g. "capability_match", "only_qualified",
   * "fallback_by_policy"). Rationale text may supplement, never replace,
   * the code.
   */
  readonly reason_code: string;
  readonly rationale?: string;
  readonly required_capabilities: readonly string[];
  /** True only after the registry check, not self-reported by the agent. */
  readonly capabilities_verified: boolean;
  /**
   * True only after the server confirms the agent's delegated authority
   * covers every tool this task needs (DelegatedGrant subset law).
   */
  readonly permissions_verified: boolean;
  readonly decided_at: ISO8601Timestamp;
}

/**
 * Control-plane record linking one task to its controlled execution.
 * Immutable once terminal. Links to the durable layer by execution_id
 * when the durable runtime is connected; the link is evidence, not a
 * success claim.
 */
export interface TaskExecutionRecord {
  readonly task_id: TaskId;
  readonly execution_id: string;
  readonly workspace_id: WorkspaceId;
  readonly attempt: number;
  readonly started_at: ISO8601Timestamp;
  readonly ended_at?: ISO8601Timestamp;
  readonly outcome:
    | "running"
    | "succeeded"
    | "failed"
    | "timeout"
    | "interrupted"
    | "cancelled"
    | "outcome_unknown";
  /** Sanitized, bounded references; never credentials or raw secrets. */
  readonly artifact_references: readonly string[];
  readonly error_code?: string;
}

/**
 * A queued request for a human decision on a consequential action.
 * The approval token itself is issued and verified only by
 * ApprovalProvider at the execution boundary — it is never embedded here.
 */
export interface ApprovalRequest {
  readonly request_id: string;
  readonly workspace_id: WorkspaceId;
  readonly action: string;
  readonly resource_ids: readonly string[];
  readonly requested_by: CallerId;
  readonly reason: string;
  readonly status: "pending" | "approved" | "rejected" | "expired";
  readonly created_at: ISO8601Timestamp;
  readonly decided_at?: ISO8601Timestamp;
  readonly decided_by?: CallerId;
}

/** Consumer-facing feed event for panels (W2). Same sanitization law as
 * DurableAuditEvent metadata: bounded, no secrets, no raw prompts. */
export interface ActivityEvent {
  readonly event_id: string;
  readonly workspace_id: WorkspaceId;
  readonly kind:
    | "project_created"
    | "plan_revised"
    | "task_state_changed"
    | "agent_assigned"
    | "execution_started"
    | "execution_finished"
    | "approval_requested"
    | "approval_decided"
    | "verification_recorded";
  readonly subject: { readonly project_id?: ProjectId; readonly task_id?: TaskId };
  readonly occurred_at: ISO8601Timestamp;
  readonly summary: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

/** Hash of collected evidence. Keyed digests are required wherever the
 * digest supports an authority or completion claim (see domain law 4). */
export type EvidenceDigest =
  | { readonly algorithm: "hmac-sha256"; readonly value: string }
  | { readonly algorithm: "sha256"; readonly value: string };

/** One collected, honestly-reported piece of evidence. */
export interface VerificationEvidence {
  readonly evidence_id: string;
  readonly kind: AcceptanceCriterion["evidence_kind"];
  /** Where it came from (e.g. "github", "ci", "execution-workspace"). */
  readonly source: string;
  /**
   * Binds the evidence to exactly one subject: repository identity and
   * source revision are required, so stale or foreign evidence cannot
   * masquerade as proof for another task or commit.
   */
  readonly subject: {
    readonly repository?: string;
    readonly revision?: string;
    readonly task_id?: TaskId;
  };
  readonly digest: EvidenceDigest;
  readonly collected_at: ISO8601Timestamp;
  /** Honest collection result; collection debt is never a pass. */
  readonly collection_status: "collected" | "missing" | "stale" | "unavailable";
}

export type VerificationVerdict =
  | "VERIFIED"
  | "VERIFICATION_FAILED"
  | "BLOCKED"
  | "UNVERIFIED";

/** Per-criterion outcome inside a verification report. */
export interface CriterionResult {
  readonly criterion_id: string;
  readonly required: boolean;
  readonly outcome: "passed" | "failed" | "not_evaluated";
  readonly evidence_ids: readonly string[];
}

/**
 * The structured result of independent verification, produced only by
 * the verification component — never by a task worker or agent. A
 * required criterion with no collected evidence yields BLOCKED or
 * UNVERIFIED, never VERIFIED (fail closed, domain law 1).
 */
export interface VerificationReport {
  readonly task_id: TaskId;
  readonly workspace_id: WorkspaceId;
  readonly verdict: VerificationVerdict;
  readonly criteria_results: readonly CriterionResult[];
  readonly evidence: readonly VerificationEvidence[];
  readonly issued_at: ISO8601Timestamp;
  /**
   * Sanitized explanation when the verdict is not VERIFIED. Missing
   * credentials, unavailable services, and unexecuted tests are named
   * here honestly.
   */
  readonly notes?: string;
}
