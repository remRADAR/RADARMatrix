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
