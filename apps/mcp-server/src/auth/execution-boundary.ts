/**
 * RM-IEP/1 — local execution interface protocol boundary contracts.
 *
 * Contract-only security surface: this module validates messages and frames;
 * it never spawns processes, dispatches tools, or performs live execution.
 */
export const RM_IEP_VERSION = "RM-IEP/1" as const;
export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const MAX_ARGUMENT_KEYS = 64;

export type NamedToolIdentifier =
  | "radar.search"
  | "radar.recall"
  | "radar.get_context"
  | "radar.get_project"
  | "radar.get_entity"
  | "radar.remember"
  | "radar.record_decision"
  | "radar.list_agents"
  | "radar.plan_task";
export type ExecutionMessageType =
  | "execution.request"
  | "execution.response"
  | "execution.cancel"
  | "execution.failure"
  | "execution.audit";
export type ExecutionStatus = "accepted" | "completed" | "cancelled" | "failed" | "denied";

export interface ExecutionSessionClaims {
  token_use: "execution-session";
  session_id: string;
  actor_id: string;
  agent_id: string;
  workspace_id: string;
  audience: "local-execution";
  issuer: string;
  issued_at: number;
  expires_at: number;
  jti: string;
}
export interface NamedToolCall { name: NamedToolIdentifier; arguments: Record<string, unknown> }
export interface ExecutionRequestEnvelope {
  version: typeof RM_IEP_VERSION;
  type: "execution.request";
  message_id: string;
  session: ExecutionSessionClaims;
  request_id: string;
  tool: NamedToolCall;
  created_at: number;
}
export interface ExecutionResponseEnvelope {
  version: typeof RM_IEP_VERSION;
  type: "execution.response";
  message_id: string;
  request_id: string;
  status: ExecutionStatus;
  created_at: number;
  result?: Record<string, unknown>;
  error_code?: string;
}
export interface ExecutionCancellationEnvelope {
  version: typeof RM_IEP_VERSION;
  type: "execution.cancel";
  message_id: string;
  request_id: string;
  session_id: string;
  reason: string;
  created_at: number;
}
export interface ExecutionFailureEnvelope {
  version: typeof RM_IEP_VERSION;
  type: "execution.failure";
  message_id: string;
  request_id: string;
  session_id: string;
  code: string;
  retryable: boolean;
  created_at: number;
}
export interface ExecutionAuditEnvelope {
  version: typeof RM_IEP_VERSION;
  type: "execution.audit";
  message_id: string;
  request_id: string;
  session_id: string;
  actor_id: string;
  agent_id: string;
  workspace_id: string;
  tool: NamedToolIdentifier;
  outcome: ExecutionStatus;
  created_at: number;
}
export type ExecutionEnvelope = ExecutionRequestEnvelope | ExecutionResponseEnvelope | ExecutionCancellationEnvelope | ExecutionFailureEnvelope | ExecutionAuditEnvelope;
export type ValidationResult<T> = { valid: true; value: T } | { valid: false; code: string };

const TOOL_NAMES: readonly NamedToolIdentifier[] = [
  "radar.search", "radar.recall", "radar.get_context", "radar.get_project", "radar.get_entity",
  "radar.remember", "radar.record_decision", "radar.list_agents", "radar.plan_task",
];
const TOOL_REQUIRED_KEYS: Readonly<Record<NamedToolIdentifier, readonly string[]>> = Object.freeze({
  "radar.search": ["workspace_id", "query"],
  "radar.recall": ["workspace_id"],
  "radar.get_context": ["workspace_id"],
  "radar.get_project": ["workspace_id", "project_id"],
  "radar.get_entity": ["workspace_id", "entity_id"],
  "radar.remember": ["workspace_id", "content"],
  "radar.record_decision": ["workspace_id", "decision", "rationale"],
  "radar.list_agents": ["workspace_id"],
  "radar.plan_task": ["workspace_id", "goal"],
});
const hasOwn = (v: object, k: string): boolean => Object.prototype.hasOwnProperty.call(v, k);
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096 && !/[\u0000-\u001f]/u.test(v);
const finiteInteger = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

export function validateNamedToolCall(value: unknown): ValidationResult<NamedToolCall> {
  if (!object(value) || !text(value.name) || !TOOL_NAMES.includes(value.name as NamedToolIdentifier) || !object(value.arguments)) return { valid: false, code: "invalid_named_tool" };
  const args = value.arguments;
  if (Object.keys(args).length > MAX_ARGUMENT_KEYS || hasOwn(args, "command") || hasOwn(args, "cmd") || hasOwn(args, "shell") || hasOwn(args, "argv")) return { valid: false, code: "arbitrary_command_rejected" };
  for (const key of TOOL_REQUIRED_KEYS[value.name as NamedToolIdentifier]) if (!text(args[key])) return { valid: false, code: "invalid_tool_arguments" };
  for (const [key, arg] of Object.entries(args)) {
    if (!text(key) || arg === undefined || typeof arg === "function" || typeof arg === "symbol") return { valid: false, code: "invalid_tool_arguments" };
    if (key === "limit" || key === "offset" || key === "maxSpecialists") {
      if (!finiteInteger(arg) || arg < 0 || arg > 1000) return { valid: false, code: "invalid_tool_arguments" };
    }
    if (key === "tags" && (!Array.isArray(arg) || arg.some((x) => !text(x)))) return { valid: false, code: "invalid_tool_arguments" };
  }
  return { valid: true, value: { name: value.name as NamedToolIdentifier, arguments: { ...args } } };
}

export function validateExecutionSessionClaims(value: unknown, now: number): ValidationResult<ExecutionSessionClaims> {
  if (!object(value) || value.token_use !== "execution-session" || value.audience !== "local-execution" || !text(value.session_id) || !text(value.actor_id) || !text(value.agent_id) || !text(value.workspace_id) || !text(value.issuer) || !text(value.jti) || !finiteInteger(value.issued_at) || !finiteInteger(value.expires_at) || !finiteInteger(now) || value.expires_at <= value.issued_at || value.expires_at <= now || value.issued_at > now + 30) return { valid: false, code: "invalid_execution_session" };
  return { valid: true, value: value as unknown as ExecutionSessionClaims };
}

function common(value: unknown, type: ExecutionMessageType): boolean {
  return object(value) && value.version === RM_IEP_VERSION && value.type === type && text(value.message_id) && finiteInteger(value.created_at);
}
export function validateExecutionEnvelope(value: unknown, now = Date.now()): ValidationResult<ExecutionEnvelope> {
  if (!object(value) || !text(value.type)) return { valid: false, code: "invalid_envelope" };
  if (value.type === "execution.request") {
    if (!common(value, value.type) || !text(value.request_id)) return { valid: false, code: "invalid_request_envelope" };
    const session = validateExecutionSessionClaims(value.session, Math.floor(now / 1000));
    const tool = validateNamedToolCall(value.tool);
    if (!session.valid) return session;
    if (!tool.valid) return tool;
    return { valid: true, value: { ...value, session: session.value, tool: tool.value } as ExecutionRequestEnvelope };
  }
  if (value.type === "execution.response") {
    if (!common(value, value.type) || !text(value.request_id) || !["accepted", "completed", "cancelled", "failed", "denied"].includes(String(value.status)) || (value.result !== undefined && !object(value.result)) || (value.error_code !== undefined && !text(value.error_code))) return { valid: false, code: "invalid_response_envelope" };
    return { valid: true, value: value as unknown as ExecutionResponseEnvelope };
  }
  if (value.type === "execution.cancel") {
    if (!common(value, value.type) || !text(value.message_id) || !text(value.request_id) || !text(value.session_id) || !text(value.reason)) return { valid: false, code: "invalid_cancellation_envelope" };
    return { valid: true, value: value as unknown as ExecutionCancellationEnvelope };
  }
  if (value.type === "execution.failure") {
    if (!common(value, value.type) || !text(value.request_id) || !text(value.session_id) || !text(value.code) || typeof value.retryable !== "boolean") return { valid: false, code: "invalid_failure_envelope" };
    return { valid: true, value: value as unknown as ExecutionFailureEnvelope };
  }
  if (value.type === "execution.audit") {
    if (!common(value, value.type) || !text(value.request_id) || !text(value.session_id) || !text(value.actor_id) || !text(value.agent_id) || !text(value.workspace_id) || !text(value.tool) || !TOOL_NAMES.includes(value.tool as NamedToolIdentifier) || !["accepted", "completed", "cancelled", "failed", "denied"].includes(String(value.outcome))) return { valid: false, code: "invalid_audit_envelope" };
    return { valid: true, value: value as unknown as ExecutionAuditEnvelope };
  }
  return { valid: false, code: "unknown_message_type" };
}

export function encodeNdjsonFrame(value: unknown): ValidationResult<string> {
  const checked = validateExecutionEnvelope(value);
  if (!checked.valid) return checked;
  const line = JSON.stringify(checked.value);
  const bytes = Buffer.byteLength(line + "\n", "utf8");
  return bytes > MAX_MESSAGE_BYTES ? { valid: false, code: "message_too_large" } : { valid: true, value: line + "\n" };
}
export function decodeNdjsonFrame(frame: unknown): ValidationResult<ExecutionEnvelope> {
  if (typeof frame !== "string" || !frame.endsWith("\n") || frame.slice(0, -1).includes("\n") || Buffer.byteLength(frame, "utf8") > MAX_MESSAGE_BYTES) return { valid: false, code: "invalid_ndjson_frame" };
  try { return validateExecutionEnvelope(JSON.parse(frame.slice(0, -1))); } catch { return { valid: false, code: "invalid_json" }; }
}
