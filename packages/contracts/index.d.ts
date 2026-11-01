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

export interface RuntimeExecutionRequest {
  command: string;
  cwd?: string;
  timeoutMs?: number;
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
