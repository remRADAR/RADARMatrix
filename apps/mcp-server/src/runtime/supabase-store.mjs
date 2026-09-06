import { randomUUID } from 'node:crypto';

const DEFAULT_WORKSPACE_ID = process.env.RADARMATRIX_WORKSPACE_ID || 'w_dev';

export class SupabaseWorkspaceStore {
  constructor({ url = process.env.SUPABASE_URL, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY, workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
    this.url = url?.replace(/\/$/, '');
    this.serviceRoleKey = serviceRoleKey;
    this.workspaceId = workspaceId;
    this.ready = false;
  }

  async init() {
    if (!this.url || !this.serviceRoleKey) {
      throw new Error('SUPABASE_SERVER_CREDENTIALS_REQUIRED');
    }
    const workspace = await this.request(`/rest/v1/workspaces?id=eq.${encodeURIComponent(this.workspaceId)}&select=id,name,policy_version,policy_status,created_at,updated_at`);
    if (!workspace.length) throw new Error('WORKSPACE_NOT_FOUND');
    this.ready = true;
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.url}${path}`, {
      ...options,
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.hint || `Supabase request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async getWorkspace(workspaceId) {
    this.requireWorkspace(workspaceId);
    const [workspaceRows, assetRows, contentRows, communityRows, safetyRows, auditRows] = await Promise.all([
      this.request(`/rest/v1/workspaces?id=eq.${encodeURIComponent(workspaceId)}&select=*`),
      this.request(`/rest/v1/brand_assets?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*&order=updated_at.desc`),
      this.request(`/rest/v1/content_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*&order=updated_at.desc`),
      this.request(`/rest/v1/community_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*&order=updated_at.desc`),
      this.request(`/rest/v1/safety_state?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`),
      this.request(`/rest/v1/audit_events?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*&order=created_at.desc&limit=25`),
    ]);
    const workspace = workspaceRows[0];
    if (!workspace) return null;
    const safety = safetyRows[0] || {};
    return {
      id: workspace.id,
      name: workspace.name,
      policy: { version: workspace.policy_version, status: workspace.policy_status, updatedAt: workspace.updated_at },
      assets: assetRows.map((row) => ({ id: row.id, name: row.name, type: row.asset_type, tags: row.tags || [], description: row.description, version: row.version, updatedAt: row.updated_at })),
      content: contentRows.map((row) => ({ id: row.id, title: row.title, format: row.format, channel: row.channel, status: row.status.toUpperCase(), owner: row.created_by, updatedAt: row.updated_at, requiresApproval: row.requires_approval })),
      community: communityRows.map((row) => ({ id: row.id, title: row.title, kind: row.kind, state: row.state, updatedAt: row.updated_at })),
      safety: {
        accountState: safety.account_state,
        healthScore: safety.account_state === 'healthy_observe_only' ? 98 : 90,
        mutationPause: safety.mutation_pause,
        webhooks: safety.webhook_health || {},
        budgets: safety.rate_budgets || {},
      },
      activity: auditRows.map((row) => ({ id: row.id, icon: row.success ? 'green' : 'amber', title: row.action || row.tool, detail: row.error_code || (row.success ? 'Gateway action recorded.' : 'Gateway action failed.'), time: row.created_at })),
    };
  }

  async addAsset(workspaceId, input) {
    this.requireWorkspace(workspaceId);
    const [row] = await this.request('/rest/v1/brand_assets', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ workspace_id: workspaceId, name: input.name, asset_type: input.type || 'NOTE', tags: input.tags || ['DRAFT'], description: input.description || '', created_by: process.env.RADARMATRIX_CALLER_ID || 'production' }) });
    return { id: row.id, name: row.name, type: row.asset_type, tags: row.tags || [], description: row.description, version: row.version, updatedAt: row.updated_at };
  }

  async createContent(workspaceId, input) {
    this.requireWorkspace(workspaceId);
    const [row] = await this.request('/rest/v1/content_items', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ workspace_id: workspaceId, title: input.title || 'Untitled brief', format: input.format || 'Brief', channel: input.channel || 'INTERNAL', created_by: process.env.RADARMATRIX_CALLER_ID || 'production' }) });
    return { id: row.id, title: row.title, format: row.format, channel: row.channel, status: row.status.toUpperCase(), owner: row.created_by, updatedAt: row.updated_at, requiresApproval: row.requires_approval };
  }

  async pauseMutations(workspaceId, reason = 'Operator emergency stop') {
    this.requireWorkspace(workspaceId);
    const [row] = await this.request(`/rest/v1/safety_state?workspace_id=eq.${encodeURIComponent(workspaceId)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ mutation_pause: true, account_state: 'MUTATIONS_PAUSED', updated_by: process.env.RADARMATRIX_CALLER_ID || 'production', updated_at: new Date().toISOString() }) });
    await this.appendAudit({ workspaceId, callerId: process.env.RADARMATRIX_CALLER_ID || 'production', tool: 'radar.record_decision', action: reason, isWrite: true, success: true, metadata: { emergency_stop: true } });
    return { accountState: row.account_state, mutationPause: row.mutation_pause };
  }

  async appendAudit(event) {
    await this.request('/rest/v1/audit_events', { method: 'POST', body: JSON.stringify({ workspace_id: event.workspaceId, request_id: event.requestId || `ui_${randomUUID()}`, caller_id: event.callerId || 'unknown', tool: event.tool || 'unknown', action: event.action || null, is_write: Boolean(event.isWrite), success: Boolean(event.success), error_code: event.errorCode || null, metadata: event.metadata || {} }) });
  }

  requireWorkspace(workspaceId) {
    if (workspaceId !== this.workspaceId) throw new Error('WORKSPACE_NOT_FOUND');
    if (!this.ready) throw new Error('SUPABASE_STORE_NOT_INITIALIZED');
  }
}
