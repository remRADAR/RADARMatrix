import { randomUUID } from "node:crypto";
import {
  createRedemptionRecord,
  verifyApproval,
} from "../../auth/approvals.ts";
import {
  validateGrantUse,
  type DelegatedGrant,
  type GrantIntegrityService,
} from "../../auth/delegation.ts";
import type {
  CreateExecutionInput,
  CreateExecutionResult,
  DurableAuditEvent,
  DurableExecution,
  ExecutionState,
  ReconciliationEvidence,
  ReconciliationOutcome,
} from "../../../../../packages/contracts/index.d.ts";

export interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: { changes?: number };
  error?: string;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Session {
  prepare(sql: string): D1PreparedStatement;
  getBookmark(): string | null;
}

export interface D1Binding {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
  withSession(bookmark?: string): D1Session;
}

export interface StoredExecutionRow {
  execution_id: string;
  workspace_id: string;
  actor_id: string;
  idempotency_key: string;
  tool: string;
  action: string;
  resource_fingerprint: string;
  request_fingerprint: string;
  state: ExecutionState;
  version: number;
  created_at: string;
  updated_at: string;
  provider_name: string | null;
  provider_request_id: string | null;
}

interface StoredProviderOutcomeRow {
  outcome_id: string;
  execution_id: string;
  outcome: string;
  provider_name: string;
  provider_request_id: string | null;
  observed_at: string;
  evidence_reference: string | null;
  evidence_digest: string | null;
  metadata_json: string;
}

export interface StoreGrantInput extends DelegatedGrant {}

export interface DurableExecutionResult<T = unknown> {
  readonly status: "COMMITTED" | "ROLLED_BACK" | "COMMIT_UNKNOWN" | "CONFLICT" | "STORAGE_UNAVAILABLE";
  readonly value?: T;
  readonly execution_id?: string;
  readonly conflict_code?: string;
  readonly reason?: string;
}

type D1BatchResult =
  | { readonly status: "COMMITTED"; readonly value: void }
  | { readonly status: "ROLLED_BACK"; readonly error_code: string }
  | { readonly status: "COMMIT_UNKNOWN"; readonly transaction_id: string };

export interface ReserveGrantInput {
  readonly execution_id: string;
  readonly grant_id: string;
  readonly agent_id: string;
  readonly workspace_id: string;
  readonly actor_id: string;
  readonly tool: string;
  readonly action: "read" | "write";
  readonly now_seconds: number;
}

export interface ClaimApprovalInput {
  readonly execution_id: string;
  readonly token: string;
  readonly public_key_pem: string;
  readonly now_seconds: number;
  readonly session_id?: string;
}

export interface DispatchIntentInput {
  readonly execution_id: string;
  readonly expected_version: number;
  readonly provider_name: string;
  /** Stable provider idempotency/operation key; the adapter must use it verbatim. */
  readonly provider_request_id: string;
  readonly attempt_id: string;
  readonly request_fingerprint: string;
  readonly occurred_at: string;
}

/** Supplied only by trusted server composition, never from a request. */
export interface ProviderExecutionPolicy {
  readonly enabled: boolean;
  readonly capabilities_verified: boolean;
  readonly supports_idempotency_keys: boolean;
  readonly supports_operation_lookup: boolean;
  readonly idempotency_retention_seconds: number;
  readonly maximum_recovery_window_seconds: number;
}

export interface ProviderOutcomeInput {
  readonly outcome_id: string;
  readonly execution_id: string;
  readonly expected_version: number;
  readonly outcome: "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNCERTAIN";
  readonly provider_name: string;
  readonly provider_request_id?: string;
  readonly observed_at: string;
  readonly evidence_reference?: string;
  readonly evidence_digest?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ReconcileInput {
  readonly execution_id: string;
  readonly expected_version: number;
  readonly outcome_id: string;
  readonly evidence: ReconciliationEvidence;
}

const VALID_STATES = new Set<ExecutionState>([
  "CREATED", "RESERVED", "APPROVED", "DISPATCHING",
  "SUCCEEDED", "FAILED", "CANCELLED", "UNCERTAIN",
]);
const TERMINAL_STATES = new Set<ExecutionState>(["SUCCEEDED", "FAILED", "CANCELLED"]);
const SAFE_METADATA_KEY = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const MAX_METADATA_BYTES = 8 * 1024;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  if (!nonEmpty(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function safeMetadata(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_audit_metadata");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (!SAFE_METADATA_KEY.test(key) || /(secret|token|password|credential|authorization|cookie|payload|body)/i.test(key)) {
      throw new Error("unsafe_audit_metadata_key");
    }
    if (!(item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
      throw new Error("unsafe_audit_metadata_value");
    }
    if (typeof item === "number" && !Number.isFinite(item)) {
      throw new Error("unsafe_audit_metadata_value");
    }
    normalized[key] = item;
  }
  const encoded = JSON.stringify(normalized);
  if (new TextEncoder().encode(encoded).byteLength > MAX_METADATA_BYTES) {
    throw new Error("audit_metadata_too_large");
  }
  return encoded;
}

function toExecution(row: StoredExecutionRow): DurableExecution {
  return {
    execution_id: row.execution_id,
    workspace_id: row.workspace_id,
    actor_id: row.actor_id,
    idempotency_key: row.idempotency_key,
    tool: row.tool,
    action: row.action,
    resource_fingerprint: row.resource_fingerprint,
    state: row.state,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.provider_request_id ? { provider_request_id: row.provider_request_id } : {}),
  };
}

/**
 * D1-backed transactional execution store. Every lifecycle mutation is one
 * D1Database.batch call; D1 batch is a sequential SQL transaction. Reads that
 * authorize or resolve a write start with `first-primary`. No adapter call is
 * made by this class. The caller may dispatch only after a T3 result explicitly
 * returns COMMITTED, and consequential use must remain feature-gated.
 */
export class D1DurableExecutionRuntime {
  private readonly enabledValue: boolean;
  private readonly providerPolicies: Readonly<Record<string, ProviderExecutionPolicy>>;

  constructor(
    private readonly db: D1Binding,
    private readonly grantIntegrity: GrantIntegrityService,
    options: {
      readonly enabled: boolean;
      readonly providers?: Readonly<Record<string, ProviderExecutionPolicy>>;
    },
  ) {
    this.enabledValue = options?.enabled === true;
    const policies = Object.create(null) as Record<string, ProviderExecutionPolicy>;
    for (const [name, policy] of Object.entries(options?.providers || {})) {
      if (nonEmpty(name) && policy && typeof policy === "object") policies[name] = Object.freeze({ ...policy });
    }
    this.providerPolicies = Object.freeze(policies);
    if (!db || typeof db.batch !== "function" || typeof db.withSession !== "function") {
      throw new Error("d1_binding_unavailable");
    }
    if (!grantIntegrity || typeof grantIntegrity.seal !== "function" || typeof grantIntegrity.matches !== "function") {
      throw new Error("grant_integrity_unavailable");
    }
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  private guardEnabled(): void {
    if (!this.enabled) throw new Error("durable_execution_disabled");
  }

  private stmt(sql: string, ...values: unknown[]): D1PreparedStatement {
    return this.db.prepare(sql).bind(...values);
  }

  private primary() {
    return this.db.withSession("first-primary");
  }

  private assertAfterPreviousWrite(assertionId: string): D1PreparedStatement[] {
    return [
      this.stmt(
        "INSERT INTO transaction_assertions (assertion_id, ok) SELECT ?, CASE WHEN changes() = 1 THEN 1 ELSE 0 END",
        assertionId,
      ),
      this.stmt("DELETE FROM transaction_assertions WHERE assertion_id = ?", assertionId),
    ];
  }

  private async batch(statements: D1PreparedStatement[]): Promise<D1BatchResult> {
    if (statements.length === 0) return { status: "ROLLED_BACK", error_code: "empty_transaction" };
    try {
      const results = await this.db.batch(statements);
      if (!Array.isArray(results) || results.length !== statements.length) {
        return { status: "COMMIT_UNKNOWN", transaction_id: randomUUID() };
      }
      if (results.some((result) => !result || result.success !== true)) {
        // Cloudflare documents a statement failure as aborting/rolling back
        // the full batch. Treat only an explicit failed result as rollback.
        return { status: "ROLLED_BACK", error_code: "d1_batch_statement_failed" };
      }
      return { status: "COMMITTED", value: undefined };
    } catch {
      // A rejected D1 call does not establish rollback. Do not retry it here.
      return { status: "COMMIT_UNKNOWN", transaction_id: randomUUID() };
    }
  }

  private async getExecutionPrimary(executionId: string): Promise<StoredExecutionRow | null> {
    return this.primary()
      .prepare("SELECT * FROM executions WHERE execution_id = ?")
      .bind(executionId)
      .first<StoredExecutionRow>();
  }

  private async getProviderOutcomePrimary(outcomeId: string): Promise<StoredProviderOutcomeRow | null> {
    return this.primary()
      .prepare("SELECT * FROM provider_outcomes WHERE outcome_id = ?")
      .bind(outcomeId)
      .first<StoredProviderOutcomeRow>();
  }

  async getByScopedIdempotencyKey(
    key: Pick<CreateExecutionInput, "workspace_id" | "actor_id" | "idempotency_key">,
  ): Promise<DurableExecutionResult<DurableExecution | null>> {
    if (!this.enabled) return { status: "STORAGE_UNAVAILABLE", reason: "durable_execution_disabled" };
    try {
      const row = await this.primary()
        .prepare("SELECT * FROM executions WHERE workspace_id = ? AND actor_id = ? AND idempotency_key = ?")
        .bind(key.workspace_id, key.actor_id, key.idempotency_key)
        .first<StoredExecutionRow>();
      return { status: "COMMITTED", value: row ? toExecution(row) : null };
    } catch {
      return { status: "STORAGE_UNAVAILABLE", reason: "primary_read_failed" };
    }
  }

  /** T0: unique insert, creation audit, then primary read for replay/conflict. */
  async createOrReplay(input: CreateExecutionInput): Promise<DurableExecutionResult<CreateExecutionResult>> {
    if (!this.enabled) return { status: "STORAGE_UNAVAILABLE", reason: "durable_execution_disabled" };
    if (!input || ![
      input.execution_id, input.workspace_id, input.actor_id, input.idempotency_key,
      input.tool, input.action, input.resource_fingerprint, input.request_fingerprint,
    ].every(nonEmpty)) return { status: "ROLLED_BACK", reason: "invalid_execution_identity" };
    const createdAt = new Date().toISOString();
    const eventId = randomUUID();
    const metadata = safeMetadata({ version: 0 });
    const op = await this.batch([
      this.stmt(
        `INSERT INTO executions (execution_id, workspace_id, actor_id, idempotency_key, tool, action, resource_fingerprint, request_fingerprint, state, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', 0, ?, ?)
         ON CONFLICT (workspace_id, actor_id, idempotency_key) DO NOTHING`,
        input.execution_id, input.workspace_id, input.actor_id, input.idempotency_key,
        input.tool, input.action, input.resource_fingerprint, input.request_fingerprint,
        createdAt, createdAt,
      ),
      this.stmt(
        `INSERT INTO audit_events (event_id, workspace_id, actor_id, execution_id, sequence, event_type, to_state, occurred_at, metadata_json)
         SELECT ?, ?, ?, ?, 0, 'execution.created', 'CREATED', ?, ? WHERE changes() = 1`,
        eventId, input.workspace_id, input.actor_id, input.execution_id, createdAt, metadata,
      ),
    ]);
    if (op.status !== "COMMITTED") {
      return { status: op.status, execution_id: input.execution_id, reason: op.status === "COMMIT_UNKNOWN" ? "t0_commit_unknown" : op.error_code };
    }
    try {
      const row = await this.primary()
        .prepare("SELECT * FROM executions WHERE workspace_id = ? AND actor_id = ? AND idempotency_key = ?")
        .bind(input.workspace_id, input.actor_id, input.idempotency_key)
        .first<StoredExecutionRow>();
      if (!row) return { status: "COMMIT_UNKNOWN", execution_id: input.execution_id, reason: "t0_primary_read_missing" };
      const same = row.tool === input.tool && row.action === input.action &&
        row.resource_fingerprint === input.resource_fingerprint &&
        row.request_fingerprint === input.request_fingerprint;
      if (!same) return { status: "CONFLICT", execution_id: row.execution_id, conflict_code: "IDEMPOTENCY_CONFLICT" };
      const kind = row.execution_id === input.execution_id ? "CREATED" : "REPLAY";
      return { status: "COMMITTED", execution_id: row.execution_id, value: { kind, execution: toExecution(row) } };
    } catch {
      return { status: "COMMIT_UNKNOWN", execution_id: input.execution_id, reason: "t0_primary_read_failed" };
    }
  }

  /** Trusted server-side provisioning only. Never expose this via a request route. */
  async storeGrant(grant: StoreGrantInput): Promise<DurableExecutionResult<void>> {
    if (!this.enabled) return { status: "STORAGE_UNAVAILABLE", reason: "durable_execution_disabled" };
    if (!grant || ![
      grant.grant_id, grant.actor_id, grant.agent_id, grant.workspace_id, grant.integrity_hash,
    ].every(nonEmpty)) return { status: "ROLLED_BACK", reason: "invalid_grant" };
    const currentSeal = this.grantIntegrity.seal({
      grant_id: grant.grant_id, actor_id: grant.actor_id, agent_id: grant.agent_id,
      workspace_id: grant.workspace_id, allowed_tools: grant.allowed_tools,
      allowed_actions: grant.allowed_actions, expires_at: grant.expires_at,
      max_uses: grant.max_uses, uses: grant.uses,
    });
    if (!this.grantIntegrity.matches(grant.integrity_hash, currentSeal)) {
      return { status: "CONFLICT", conflict_code: "GRANT_SEAL_INVALID" };
    }
    const op = await this.batch([
      this.stmt(
        `INSERT INTO delegated_grants (grant_id, actor_id, agent_id, workspace_id, allowed_tools_json, allowed_actions_json, expires_at, max_uses, uses, integrity_hash, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
         ON CONFLICT (grant_id) DO NOTHING`,
        grant.grant_id, grant.actor_id, grant.agent_id, grant.workspace_id,
        JSON.stringify(grant.allowed_tools), JSON.stringify(grant.allowed_actions),
        grant.expires_at, grant.max_uses, grant.uses, grant.integrity_hash,
      ),
    ]);
    if (op.status !== "COMMITTED") return { status: op.status, reason: op.status === "COMMIT_UNKNOWN" ? "grant_store_commit_unknown" : op.error_code };
    try {
      const row = await this.primary().prepare("SELECT integrity_hash FROM delegated_grants WHERE grant_id = ?")
        .bind(grant.grant_id).first<{ integrity_hash: string }>();
      if (row?.integrity_hash !== grant.integrity_hash) return { status: "CONFLICT", conflict_code: "GRANT_ID_CONFLICT" };
      return { status: "COMMITTED" };
    } catch {
      return { status: "COMMIT_UNKNOWN", reason: "grant_store_primary_read_failed" };
    }
  }

  /** T1: primary-read/HMAC validation then guarded CAS + reservation + audit batch. */
  async reserveGrantUse(input: ReserveGrantInput): Promise<DurableExecutionResult<{ reservation_id: string }>> {
    if (!this.enabled) return { status: "STORAGE_UNAVAILABLE", reason: "durable_execution_disabled" };
    if (!input || ![
      input.execution_id, input.grant_id, input.agent_id, input.workspace_id,
      input.actor_id, input.tool, input.action,
    ].every(nonEmpty) || !Number.isFinite(input.now_seconds)) {
      return { status: "ROLLED_BACK", reason: "invalid_reservation_input" };
    }
    try {
      const session = this.primary();
      const grantRow = await session.prepare("SELECT * FROM delegated_grants WHERE grant_id = ?")
        .bind(input.grant_id).first<Record<string, unknown>>();
      const executionRow = await session.prepare("SELECT * FROM executions WHERE execution_id = ?")
        .bind(input.execution_id).first<StoredExecutionRow>();
      if (!grantRow || !executionRow) return { status: "CONFLICT", conflict_code: "GRANT_OR_EXECUTION_NOT_FOUND" };
      const grant: DelegatedGrant = {
        grant_id: String(grantRow.grant_id), actor_id: String(grantRow.actor_id), agent_id: String(grantRow.agent_id),
        workspace_id: String(grantRow.workspace_id), allowed_tools: JSON.parse(String(grantRow.allowed_tools_json)),
        allowed_actions: JSON.parse(String(grantRow.allowed_actions_json)), expires_at: Number(grantRow.expires_at),
        max_uses: Number(grantRow.max_uses), uses: Number(grantRow.uses), integrity_hash: String(grantRow.integrity_hash),
      };
      if (executionRow.state !== "CREATED" || executionRow.workspace_id !== input.workspace_id ||
          executionRow.actor_id !== input.actor_id || executionRow.tool !== input.tool || executionRow.action !== input.action ||
          grant.actor_id !== input.actor_id) return { status: "CONFLICT", conflict_code: "RESERVATION_SCOPE_CONFLICT" };
      const valid = validateGrantUse(grant, {
        agent_id: input.agent_id, workspace_id: input.workspace_id, tool: input.tool, action: input.action,
      }, input.now_seconds, this.grantIntegrity);
      if (!valid.valid) return { status: "CONFLICT", conflict_code: valid.reason || "GRANT_DENIED" };
      const updatedGrant: DelegatedGrant = { ...grant, uses: grant.uses + 1 };
      updatedGrant.integrity_hash = this.grantIntegrity.seal({
        grant_id: updatedGrant.grant_id, actor_id: updatedGrant.actor_id, agent_id: updatedGrant.agent_id,
        workspace_id: updatedGrant.workspace_id, allowed_tools: updatedGrant.allowed_tools,
        allowed_actions: updatedGrant.allowed_actions, expires_at: updatedGrant.expires_at,
        max_uses: updatedGrant.max_uses, uses: updatedGrant.uses,
      });
      const now = new Date(input.now_seconds * 1000).toISOString();
      const reservationId = randomUUID();
      const auditId = randomUUID();
      const assertionId = randomUUID();
      const op = await this.batch([
        this.stmt(
          `UPDATE delegated_grants SET uses = ?, integrity_hash = ?
           WHERE grant_id = ? AND status = 'ACTIVE' AND uses = ? AND integrity_hash = ? AND expires_at > ? AND (max_uses = 0 OR uses < max_uses)`,
          updatedGrant.uses, updatedGrant.integrity_hash, grant.grant_id, grant.uses, grant.integrity_hash, input.now_seconds,
        ),
        ...this.assertAfterPreviousWrite(assertionId),
        this.stmt(
          `INSERT INTO reservations (reservation_id, execution_id, grant_id, workspace_id, actor_id, reserved_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          reservationId, executionRow.execution_id, grant.grant_id, input.workspace_id, input.actor_id, now,
        ),
        this.stmt(
          `UPDATE executions SET state = 'RESERVED', version = 1, updated_at = ?
           WHERE execution_id = ? AND state = 'CREATED' AND version = 0`,
          now, input.execution_id,
        ),
        ...this.assertAfterPreviousWrite(randomUUID()),
        this.stmt(
          `INSERT INTO audit_events (event_id, workspace_id, actor_id, execution_id, sequence, event_type, from_state, to_state, occurred_at, metadata_json)
           VALUES (?, ?, ?, ?, 1, 'grant.reserved', 'CREATED', 'RESERVED', ?, ?)`,
          auditId, input.workspace_id, input.actor_id, input.execution_id, now,
          safeMetadata({ grant_id: grant.grant_id, reservation_id: reservationId }),
        ),
      ]);
      return op.status === "COMMITTED"
        ? { status: "COMMITTED", execution_id: input.execution_id, value: { reservation_id: reservationId } }
        : { status: op.status, execution_id: input.execution_id, reason: op.status === "COMMIT_UNKNOWN" ? "t1_commit_unknown" : op.error_code };
    } catch {
      return { status: "COMMIT_UNKNOWN", execution_id: input.execution_id, reason: "t1_storage_or_validation_unknown" };
    }
  }

  /** T2: signature/scope verification plus durable unique JTI claim and audit. */
  async claimApproval(input: ClaimApprovalInput): Promise<DurableExecutionResult<{ jti: string }>> {
    if (!this.enabled) return { status: "STORAGE_UNAVAILABLE", reason: "durable_execution_disabled" };
    if (!input || ![input.execution_id, input.token, input.public_key_pem].every(nonEmpty) || !Number.isFinite(input.now_seconds)) {
      return { status: "ROLLED_BACK", reason: "invalid_approval_input" };
    }
    try {
      const row = await this.getExecutionPrimary(input.execution_id);
      if (!row || row.state !== "RESERVED" || row.version !== 1) return { status: "CONFLICT", conflict_code: "EXECUTION_NOT_RESERVED" };
      const verification = verifyApproval(input.token, input.public_key_pem, {
        action: row.action, resource_id: row.resource_fingerprint,
        workspace_id: row.workspace_id, actor_id: row.actor_id,
        session_id: input.session_id,
      }, createRedemptionRecord(), input.now_seconds);
      if (!verification.valid || !verification.jti) return { status: "CONFLICT", conflict_code: verification.reason || "APPROVAL_DENIED" };
      const jti = verification.jti;
      const payload = input.token.split(".")[0];
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
      if (typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp <= input.now_seconds) {
        return { status: "CONFLICT", conflict_code: "APPROVAL_EXPIRY_INVALID" };
      }
      const expiresAt = new Date(claims.exp * 1000).toISOString();
      const now = new Date(input.now_seconds * 1000).toISOString();
      const auditId = randomUUID();
      const op = await this.batch([
        this.stmt(
          `INSERT INTO approval_claims (jti, execution_id, workspace_id, actor_id, action, resource_fingerprint, claimed_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          jti, input.execution_id, row.workspace_id, row.actor_id, row.action, row.resource_fingerprint, now,
          expiresAt,
        ),
        this.stmt(
          `UPDATE executions SET state = 'APPROVED', version = 2, updated_at = ?
           WHERE execution_id = ? AND state = 'RESERVED' AND version = 1`,
          now, input.execution_id,
        ),
        ...this.assertAfterPreviousWrite(randomUUID()),
        this.stmt(
          `INSERT INTO audit_events (event_id, workspace_id, actor_id, execution_id, sequence, event_type, from_state, to_state, occurred_at, metadata_json)
           VALUES (?, ?, ?, ?, 2, 'approval.claimed', 'RESERVED', 'APPROVED', ?, ?)`,
          auditId, row.workspace_id, row.actor_id, input.execution_id, now, safeMetadata({ jti }),
        ),
      ]);
      return op.status === "COMMITTED"
        ? { status: "COMMITTED", execution_id: input.execution_id, value: { jti } }
        : { status: op.status, execution_id: input.execution_id, reason: op.status === "COMMIT_UNKNOWN" ? "t2_commit_unknown" : op.error_code };
    } catch {
      return { status: "COMMIT_UNKNOWN", execution_id: input.execution_id, reason: "t2_storage_or_validation_unknown" };
    }
  }

  /** T3: only persist intent. Caller must not dispatch unless this returns COMMITTED. */
  async markDispatching(input: DispatchIntentInput): Promise<DurableExecutionResult<{ attempt_id: string; provider_request_id: string }>> {
    if (!this.enabled) return { status: "STORAGE_UNAVAILABLE", reason: "durable_execution_disabled" };
    if (!input || ![
      input.execution_id, input.provider_name, input.provider_request_id, input.attempt_id,
      input.request_fingerprint,
    ].every(nonEmpty) || !isIsoDate(input.occurred_at) || !Number.isInteger(input.expected_version)) {
      return { status: "ROLLED_BACK", reason: "invalid_dispatch_intent" };
    }
    const policy = this.providerPolicies[input.provider_name];
    if (!policy || policy.enabled !== true || policy.capabilities_verified !== true ||
        policy.supports_idempotency_keys !== true || policy.supports_operation_lookup !== true ||
        !Number.isSafeInteger(policy.idempotency_retention_seconds) ||
        !Number.isSafeInteger(policy.maximum_recovery_window_seconds) ||
        policy.idempotency_retention_seconds < policy.maximum_recovery_window_seconds ||
        policy.maximum_recovery_window_seconds < 1) {
      return { status: "CONFLICT", execution_id: input.execution_id, conflict_code: "PROVIDER_NOT_RECONCILABLE" };
    }
    const row = await this.getExecutionPrimary(input.execution_id).catch(() => null);
    if (!row) return { status: "STORAGE_UNAVAILABLE", execution_id: input.execution_id, reason: "execution_not_found_or_storage_unavailable" };
    if (row.state !== "APPROVED" || row.version !== input.expected_version || row.request_fingerprint !== input.request_fingerprint) {
      return { status: "CONFLICT", execution_id: input.execution_id, conflict_code: "DISPATCH_PRECONDITION_FAILED" };
    }
    const auditId = randomUUID();
    const op = await this.batch([
      this.stmt(
        `UPDATE executions SET state = 'DISPATCHING', version = version + 1, updated_at = ?, provider_name = ?, provider_request_id = ?
         WHERE execution_id = ? AND state = 'APPROVED' AND version = ? AND request_fingerprint = ?`,
        input.occurred_at, input.provider_name, input.provider_request_id,
        input.execution_id, input.expected_version, input.request_fingerprint,
      ),
      ...this.assertAfterPreviousWrite(randomUUID()),
      this.stmt(
        `INSERT INTO dispatch_intents (execution_id, provider_name, provider_request_id, request_fingerprint, attempt_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        input.execution_id, input.provider_name, input.provider_request_id,
        input.request_fingerprint, input.attempt_id, input.occurred_at,
      ),
      this.stmt(
        `INSERT INTO audit_events (event_id, workspace_id, actor_id, execution_id, sequence, event_type, from_state, to_state, occurred_at, metadata_json)
         SELECT ?, workspace_id, actor_id, execution_id, ?, 'dispatch.started', 'APPROVED', 'DISPATCHING', ?, ?
         FROM executions WHERE execution_id = ?`,
        auditId, input.expected_version + 1, input.occurred_at,
        safeMetadata({ provider: input.provider_name, attempt_id: input.attempt_id }),
        input.execution_id,
      ),
    ]);
    return op.status === "COMMITTED"
      ? { status: "COMMITTED", execution_id: input.execution_id, value: { attempt_id: input.attempt_id, provider_request_id: input.provider_request_id } }
      : { status: op.status, execution_id: input.execution_id, reason: op.status === "COMMIT_UNKNOWN" ? "t3_commit_unknown_no_dispatch" : op.error_code };
  }

  /** T4: persist the provider result, projection and audit in one batch. */
  async recordOutcome(input: ProviderOutcomeInput): Promise<DurableExecutionResult<void>> {
    if (!this.enabled) return { status: "STORAGE_UNAVAILABLE", reason: "durable_execution_disabled" };
    if (!input || ![
      input.outcome_id, input.execution_id, input.provider_name,
    ].every(nonEmpty) || !isIsoDate(input.observed_at) || !Number.isInteger(input.expected_version)) {
      return { status: "ROLLED_BACK", reason: "invalid_provider_outcome" };
    }
    const metadata = safeMetadata(input.metadata || {});
    let priorOutcome: StoredProviderOutcomeRow | null;
    try {
      priorOutcome = await this.getProviderOutcomePrimary(input.outcome_id);
    } catch {
      return { status: "STORAGE_UNAVAILABLE", execution_id: input.execution_id, reason: "outcome_idempotency_read_failed" };
    }
    if (priorOutcome) {
      const same = priorOutcome.execution_id === input.execution_id && priorOutcome.outcome === input.outcome &&
        priorOutcome.provider_name === input.provider_name &&
        priorOutcome.provider_request_id === (input.provider_request_id ?? null) &&
        priorOutcome.observed_at === input.observed_at &&
        priorOutcome.evidence_reference === (input.evidence_reference ?? null) &&
        priorOutcome.evidence_digest === (input.evidence_digest ?? null) &&
        priorOutcome.metadata_json === metadata;
      return same
        ? { status: "COMMITTED", execution_id: input.execution_id }
        : { status: "CONFLICT", execution_id: input.execution_id, conflict_code: "OUTCOME_ID_CONFLICT" };
    }
    const row = await this.getExecutionPrimary(input.execution_id).catch(() => null);
    if (!row) return { status: "STORAGE_UNAVAILABLE", execution_id: input.execution_id, reason: "execution_not_found_or_storage_unavailable" };
    if (!["SUCCEEDED", "FAILED", "CANCELLED", "UNCERTAIN"].includes(input.outcome) ||
        row.state !== "DISPATCHING" || row.version !== input.expected_version ||
        row.provider_name !== input.provider_name ||
        (input.provider_request_id !== undefined && row.provider_request_id !== input.provider_request_id)) {
      return { status: "CONFLICT", execution_id: input.execution_id, conflict_code: "OUTCOME_PRECONDITION_FAILED" };
    }
    const auditId = randomUUID();
    const target: ExecutionState = input.outcome;
    const op = await this.batch([
      this.stmt(
        `UPDATE executions SET state = ?, version = version + 1, updated_at = ?
         WHERE execution_id = ? AND state = 'DISPATCHING' AND version = ?`,
        target, input.observed_at, input.execution_id, input.expected_version,
      ),
      ...this.assertAfterPreviousWrite(randomUUID()),
      this.stmt(
        `INSERT INTO provider_outcomes (outcome_id, execution_id, outcome, provider_name, provider_request_id, observed_at, evidence_reference, evidence_digest, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.outcome_id, input.execution_id, input.outcome, input.provider_name,
        input.provider_request_id ?? null, input.observed_at,
        input.evidence_reference ?? null, input.evidence_digest ?? null, metadata,
      ),
      this.stmt(
        `INSERT INTO audit_events (event_id, workspace_id, actor_id, execution_id, sequence, event_type, from_state, to_state, occurred_at, metadata_json)
         SELECT ?, workspace_id, actor_id, execution_id, ?, ?, 'DISPATCHING', ?, ?, ?
         FROM executions WHERE execution_id = ?`,
        auditId, input.expected_version + 1, `provider.${input.outcome.toLowerCase()}`,
        target, input.observed_at, safeMetadata({ provider: input.provider_name, outcome_id: input.outcome_id }),
        input.execution_id,
      ),
    ]);
    return op.status === "COMMITTED"
      ? { status: "COMMITTED", execution_id: input.execution_id }
      : { status: op.status, execution_id: input.execution_id, reason: op.status === "COMMIT_UNKNOWN" ? "t4_commit_unknown" : op.error_code };
  }

  /** Reconciliation is observation/reduction only. It never dispatches. */
  async reconcile(input: ReconcileInput): Promise<DurableExecutionResult<void>> {
    if (!this.enabled) return { status: "STORAGE_UNAVAILABLE", reason: "durable_execution_disabled" };
    const evidence = input?.evidence;
    if (!input || !nonEmpty(input.execution_id) || !nonEmpty(input.outcome_id) ||
        !evidence || !nonEmpty(evidence.provider) || !isIsoDate(evidence.observed_at) ||
        !Number.isInteger(input.expected_version)) {
      return { status: "ROLLED_BACK", reason: "invalid_reconciliation_input" };
    }
    if (!["CONFIRMED_SUCCEEDED", "CONFIRMED_FAILED", "STILL_PENDING", "UNKNOWN", "UNSUPPORTED", "RECONCILIATION_CONFLICT"].includes(evidence.outcome)) {
      return { status: "ROLLED_BACK", execution_id: input.execution_id, reason: "invalid_reconciliation_outcome" };
    }
    let priorOutcome: StoredProviderOutcomeRow | null;
    try {
      priorOutcome = await this.getProviderOutcomePrimary(input.outcome_id);
    } catch {
      return { status: "STORAGE_UNAVAILABLE", execution_id: input.execution_id, reason: "reconciliation_idempotency_read_failed" };
    }
    if (priorOutcome) {
      const metadata = safeMetadata({ reconciliation_outcome: evidence.outcome, provider: evidence.provider });
      const same = priorOutcome.execution_id === input.execution_id && priorOutcome.outcome === evidence.outcome &&
        priorOutcome.provider_name === evidence.provider &&
        priorOutcome.provider_request_id === (evidence.provider_request_id ?? null) &&
        priorOutcome.observed_at === evidence.observed_at &&
        priorOutcome.evidence_reference === (evidence.evidence_reference ?? null) &&
        priorOutcome.evidence_digest === (evidence.evidence_digest ?? null) && priorOutcome.metadata_json === metadata;
      return same
        ? { status: "COMMITTED", execution_id: input.execution_id }
        : { status: "CONFLICT", execution_id: input.execution_id, conflict_code: "RECONCILIATION_OUTCOME_ID_CONFLICT" };
    }
    const row = await this.getExecutionPrimary(input.execution_id).catch(() => null);
    if (!row) return { status: "STORAGE_UNAVAILABLE", execution_id: input.execution_id, reason: "execution_not_found_or_storage_unavailable" };
    if (row.state !== "UNCERTAIN" || row.version !== input.expected_version ||
        row.provider_name !== evidence.provider ||
        (evidence.provider_request_id !== undefined && row.provider_request_id !== evidence.provider_request_id)) {
      return { status: "CONFLICT", execution_id: input.execution_id, conflict_code: "RECONCILIATION_PRECONDITION_FAILED" };
    }
    const terminalByOutcome: Partial<Record<ReconciliationOutcome, ExecutionState>> = {
      CONFIRMED_SUCCEEDED: "SUCCEEDED",
      CONFIRMED_FAILED: "FAILED",
    };
    const newState = terminalByOutcome[evidence.outcome] ?? "UNCERTAIN";
    const metadata = safeMetadata({ reconciliation_outcome: evidence.outcome, provider: evidence.provider });
    const auditId = randomUUID();
    const op = await this.batch([
      this.stmt(
        `UPDATE executions SET state = ?, version = version + 1, updated_at = ?
         WHERE execution_id = ? AND state = 'UNCERTAIN' AND version = ?`,
        newState, evidence.observed_at, input.execution_id, input.expected_version,
      ),
      ...this.assertAfterPreviousWrite(randomUUID()),
      this.stmt(
        `INSERT INTO provider_outcomes (outcome_id, execution_id, outcome, provider_name, provider_request_id, observed_at, evidence_reference, evidence_digest, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.outcome_id, input.execution_id, evidence.outcome, evidence.provider,
        evidence.provider_request_id ?? null, evidence.observed_at,
        evidence.evidence_reference ?? null, evidence.evidence_digest ?? null, metadata,
      ),
      this.stmt(
        `INSERT INTO audit_events (event_id, workspace_id, actor_id, execution_id, sequence, event_type, from_state, to_state, occurred_at, metadata_json)
         SELECT ?, workspace_id, actor_id, execution_id, ?, 'execution.reconciled', 'UNCERTAIN', ?, ?, ?
         FROM executions WHERE execution_id = ?`,
        auditId, input.expected_version + 1, newState, evidence.observed_at,
        safeMetadata({ reconciliation_outcome: evidence.outcome, provider: evidence.provider, outcome_id: input.outcome_id }),
        input.execution_id,
      ),
    ]);
    return op.status === "COMMITTED"
      ? { status: "COMMITTED", execution_id: input.execution_id }
      : { status: op.status, execution_id: input.execution_id, reason: op.status === "COMMIT_UNKNOWN" ? "reconciliation_commit_unknown" : op.error_code };
  }

  async getAuditForExecution(executionId: string): Promise<DurableExecutionResult<DurableAuditEvent[]>> {
    if (!this.enabled) return { status: "STORAGE_UNAVAILABLE", reason: "durable_execution_disabled" };
    try {
      const rows = await this.primary()
        .prepare("SELECT * FROM audit_events WHERE execution_id = ? ORDER BY sequence ASC")
        .bind(executionId)
        .all<{
          event_id: string; workspace_id: string; actor_id: string; execution_id: string;
          sequence: number; event_type: string; from_state: ExecutionState | null;
          to_state: ExecutionState | null; occurred_at: string; metadata_json: string;
        }>();
      if (!rows || rows.success !== true || !Array.isArray(rows.results)) {
        return { status: "STORAGE_UNAVAILABLE", reason: "audit_primary_read_failed" };
      }
      return {
        status: "COMMITTED",
        value: rows.results.map((row) => ({
          event_id: row.event_id, workspace_id: row.workspace_id, actor_id: row.actor_id,
          execution_id: row.execution_id, sequence: row.sequence, event_type: row.event_type,
          ...(row.from_state ? { from_state: row.from_state } : {}),
          ...(row.to_state ? { to_state: row.to_state } : {}),
          occurred_at: row.occurred_at, metadata: JSON.parse(row.metadata_json),
        })),
      };
    } catch {
      return { status: "STORAGE_UNAVAILABLE", reason: "audit_primary_read_failed" };
    }
  }

  async listUnresolved(input: { readonly before: string; readonly limit: number }): Promise<DurableExecutionResult<DurableExecution[]>> {
    if (!this.enabled) return { status: "STORAGE_UNAVAILABLE", reason: "durable_execution_disabled" };
    if (!isIsoDate(input?.before) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
      return { status: "ROLLED_BACK", reason: "invalid_recovery_query" };
    }
    try {
      const rows = await this.primary()
        .prepare("SELECT * FROM executions WHERE state IN ('DISPATCHING','UNCERTAIN') AND updated_at <= ? ORDER BY updated_at ASC LIMIT ?")
        .bind(input.before, input.limit)
        .all<StoredExecutionRow>();
      if (!rows || rows.success !== true || !Array.isArray(rows.results)) {
        return { status: "STORAGE_UNAVAILABLE", reason: "recovery_primary_read_failed" };
      }
      return { status: "COMMITTED", value: rows.results.map(toExecution) };
    } catch {
      return { status: "STORAGE_UNAVAILABLE", reason: "recovery_primary_read_failed" };
    }
  }
}

export function createD1DurableExecutionRuntime(
  db: D1Binding,
  grantIntegrity: GrantIntegrityService,
  enabled: boolean,
  providers: Readonly<Record<string, ProviderExecutionPolicy>> = {},
): D1DurableExecutionRuntime {
  return new D1DurableExecutionRuntime(db, grantIntegrity, { enabled, providers });
}

export function isTerminalExecutionState(state: ExecutionState): boolean {
  return VALID_STATES.has(state) && TERMINAL_STATES.has(state);
}
