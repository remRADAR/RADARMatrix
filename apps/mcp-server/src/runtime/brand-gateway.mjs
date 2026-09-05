import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { DevelopmentAuthenticationProvider } = require('../providers/authentication.cjs');
const { DefaultAuthorizationProvider } = require('../providers/authorization.cjs');
const { DevelopmentMembershipProvider } = require('../providers/membership.cjs');

const WORKSPACE_ID = 'w_dev';
const authProvider = new DevelopmentAuthenticationProvider();
const authorizationProvider = new DefaultAuthorizationProvider();
const membershipProvider = new DevelopmentMembershipProvider({
  members: {
    admin_123: [WORKSPACE_ID],
    editor_456: [WORKSPACE_ID],
    contributor_789: [WORKSPACE_ID],
    viewer_000: [WORKSPACE_ID],
  },
});

const TOOL_REGISTRY = {
  'radar.get_context': { requiredRole: 'viewer', write: false },
  'radar.search': { requiredRole: 'viewer', write: false },
  'radar.remember': { requiredRole: 'contributor', write: true },
  'radar.record_decision': { requiredRole: 'editor', write: true },
};

const rateState = new Map();
const RATE_LIMITS = {
  'radar.get_context': { capacity: 60, refillPerSecond: 1 },
  'radar.search': { capacity: 60, refillPerSecond: 1 },
  'radar.remember': { capacity: 12, refillPerSecond: 12 / 3600 },
  'radar.record_decision': { capacity: 12, refillPerSecond: 12 / 3600 },
};

export class GatewayError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class BrandGateway {
  constructor(store) {
    this.store = store;
  }

  async invoke(request) {
    const startedAt = Date.now();
    const requestId = request?.context?.request_id || `req_${randomUUID()}`;
    const timestamp = new Date().toISOString();
    const tool = request?.tool;
    const params = request?.params || {};
    const context = request?.context;
    const descriptor = TOOL_REGISTRY[tool];

    try {
      this.validateRequest(request, descriptor);
      const authenticated = authProvider.authenticate(request);
      if (!authenticated) throw new GatewayError('UNAUTHENTICATED', 'Authentication failed', 401);
      if (authenticated.workspace_id !== WORKSPACE_ID || !membershipProvider.isMember(authenticated.caller_id, authenticated.workspace_id)) {
        throw new GatewayError('WORKSPACE_FORBIDDEN', 'Caller is not a member of the requested workspace', 403);
      }
      const principal = { ...authenticated, roles: authenticated.roles };
      if (!authorizationProvider.isAuthorized(principal, TOOL_REGISTRY_FOR_AUTH, tool)) {
        throw new GatewayError('FORBIDDEN', 'Caller is not authorized to invoke this tool', 403);
      }
      this.consumeRate(authenticated.caller_id, authenticated.workspace_id, tool);

      const workspace = this.store.getWorkspace(authenticated.workspace_id);
      if (!workspace) throw new GatewayError('WORKSPACE_NOT_FOUND', 'Workspace not found', 404);
      if (workspace.safety.mutationPause && descriptor.write && tool !== 'radar.record_decision') {
        throw new GatewayError('MUTATIONS_PAUSED', 'Instagram and workspace mutations are paused', 423);
      }
      if (descriptor.write && tool !== 'radar.record_decision' && !request.approval?.approved) {
        throw new GatewayError('APPROVAL_REQUIRED', 'Explicit approval is required before a write operation', 428);
      }
      if (descriptor.write && params.requires_consent === true && request.consent?.granted !== true) {
        throw new GatewayError('CONSENT_REQUIRED', 'Explicit consent is required before this action', 428);
      }

      const data = await this.execute(tool, params, authenticated, request);
      await this.store.appendAudit({ requestId, callerId: authenticated.caller_id, workspaceId: authenticated.workspace_id, tool, isWrite: descriptor.write, success: true, action: params.action || tool });
      return this.response(true, data, requestId, timestamp, startedAt);
    } catch (error) {
      const normalized = error instanceof GatewayError ? error : new GatewayError('INTERNAL_ERROR', 'Gateway execution failed', 500);
      const callerId = context?.caller_id || 'unknown';
      await this.store.appendAudit({ requestId, callerId, workspaceId: context?.workspace_id || 'unknown', tool: tool || 'unknown', isWrite: Boolean(descriptor?.write), success: false, errorCode: normalized.code });
      return this.response(false, { code: normalized.code, message: normalized.message, status: normalized.status }, requestId, timestamp, startedAt);
    }
  }

  validateRequest(request, descriptor) {
    if (!request || typeof request !== 'object' || !descriptor) throw new GatewayError('INVALID_REQUEST', 'Unknown or missing gateway tool', 400);
    if (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)) throw new GatewayError('INVALID_REQUEST', 'params must be an object', 400);
    if (!request.context || typeof request.context !== 'object') throw new GatewayError('INVALID_REQUEST', 'Request context is required', 400);
    if (request.context.workspace_id !== WORKSPACE_ID) throw new GatewayError('INVALID_REQUEST', 'Invalid workspace context', 400);
    if (request.params.workspace_id && request.params.workspace_id !== request.context.workspace_id) throw new GatewayError('INVALID_REQUEST', 'Workspace mismatch between context and params', 400);
  }

  consumeRate(callerId, workspaceId, tool) {
    const rule = RATE_LIMITS[tool];
    if (!rule) return;
    const key = `${callerId}:${workspaceId}:${tool}`;
    const now = Date.now();
    const previous = rateState.get(key) || { tokens: rule.capacity, at: now };
    const elapsed = Math.max(0, (now - previous.at) / 1000);
    const tokens = Math.min(rule.capacity, previous.tokens + elapsed * rule.refillPerSecond);
    if (tokens < 1) throw new GatewayError('RATE_GOVERNANCE_BLOCK', 'Internal rate-governance budget exhausted', 429);
    rateState.set(key, { tokens: tokens - 1, at: now });
  }

  async execute(tool, params, authenticated, request) {
    const workspaceId = authenticated.workspace_id;
    if (tool === 'radar.get_context') return { workspace: this.store.getWorkspace(workspaceId), workspace_id: workspaceId };
    if (tool === 'radar.search') return { results: [], total: 0, query: params.query || '' };
    if (tool === 'radar.remember') {
      if (params.asset) return { asset: await this.store.addAsset(workspaceId, params.asset), approval: request.approval };
      if (params.content) return { content: await this.store.createContent(workspaceId, params.content), approval: request.approval };
      return { memory_id: `memory_${randomUUID()}`, recorded_at: new Date().toISOString() };
    }
    if (tool === 'radar.record_decision') {
      if (params.action === 'emergency_stop') return { safety: await this.store.pauseMutations(workspaceId, params.reason || 'Operator emergency stop') };
      return { decision_id: `decision_${randomUUID()}`, recorded_at: new Date().toISOString() };
    }
    throw new GatewayError('UNKNOWN_TOOL', 'Unknown gateway tool', 404);
  }

  response(success, payload, requestId, timestamp, startedAt) {
    return success
      ? { success: true, data: payload, metadata: { request_id: requestId, timestamp, execution_time_ms: Date.now() - startedAt } }
      : { success: false, error: payload, metadata: { request_id: requestId, timestamp, execution_time_ms: Date.now() - startedAt } };
  }
}

const TOOL_REGISTRY_FOR_AUTH = Object.fromEntries(Object.entries(TOOL_REGISTRY).map(([name, descriptor]) => [name, { required_role: descriptor.requiredRole, is_write_operation: descriptor.write }]));
