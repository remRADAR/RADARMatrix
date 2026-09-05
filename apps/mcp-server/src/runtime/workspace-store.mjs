import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_WORKSPACE = {
  id: 'w_dev',
  name: 'remRADAR',
  policy: { version: '0.4', status: 'active', updatedAt: '2026-09-05T08:00:00.000Z' },
  assets: [
    { id: 'asset_voice', name: 'Voice & tone', type: 'VOICE', tags: ['VOICE', 'CANONICAL'], description: 'Direct, culturally literate, never over-explained.', version: '0.4', updatedAt: '2026-09-05T08:00:00.000Z' },
    { id: 'asset_visual', name: 'Visual language', type: 'VISUAL', tags: ['VISUAL', 'CANONICAL'], description: 'High contrast, editorial, kinetic, human-made.', version: '0.3', updatedAt: '2026-09-04T08:00:00.000Z' },
    { id: 'asset_community', name: 'Community policy', type: 'POLICY', tags: ['POLICY', 'GOVERNANCE'], description: 'Moderation posture, escalation boundaries, and human handoff.', version: '0.2', updatedAt: '2026-09-02T08:00:00.000Z' },
    { id: 'asset_pillars', name: 'Content pillars', type: 'STRATEGY', tags: ['STRATEGY', 'CONTENT'], description: 'Culture radar, signal reports, artist worlds, and the work behind the work.', version: '0.6', updatedAt: '2026-08-31T08:00:00.000Z' },
  ],
  content: [
    { id: 'content_signal', title: 'The signal report / 05', format: 'Carousel · 8 slides', channel: 'INSTAGRAM', status: 'IN_REVIEW', owner: 'R', updatedAt: '12 min ago', requiresApproval: true },
    { id: 'content_field', title: 'Field notes: Lagos / Tokyo', format: 'Editorial · Newsletter', channel: 'NEWSLETTER', status: 'APPROVED', owner: 'R', updatedAt: '2h ago', requiresApproval: true },
    { id: 'content_voices', title: 'New voices, same frequency', format: 'Reel · 00:28', channel: 'INSTAGRAM', status: 'DRAFT', owner: 'A', updatedAt: 'Yesterday', requiresApproval: true },
    { id: 'content_collab', title: 'Collab request / @studio____', format: 'Partnership review', channel: 'COLLAB', status: 'BLOCKED', owner: 'R', updatedAt: 'Yesterday', requiresApproval: true },
  ],
  community: [
    { id: 'community_support', title: 'How do I submit a Radar feature?', kind: 'DM · support', state: 'DRAFT_REPLY', updatedAt: '8 min ago' },
    { id: 'community_praise', title: 'This visual is everything.', kind: 'Comment · praise', state: 'SUGGEST_THANKS', updatedAt: '22 min ago' },
    { id: 'community_collab', title: 'Collaboration request from @northstar', kind: 'DM · collaboration', state: 'REVIEW', updatedAt: '1h ago' },
  ],
  safety: {
    accountState: 'HEALTHY_OBSERVE_ONLY',
    healthScore: 98,
    mutationPause: false,
    webhooks: { signatureValidation: 100, eventFreshness: '42s', queueLatency: '0.8s', reconciliation: 'Passed' },
    budgets: { publishing: { used: 1, limit: 3 }, replies: { used: 8, limit: 30 }, insights: { used: 4, limit: 48 }, messages: { used: 0, limit: 60 } },
  },
  activity: [
    { id: 'activity_policy', icon: 'green', title: 'Brand policy v0.4 activated', detail: 'Policy changed by REM operator · all new content will be checked against this version.', time: '2h ago' },
    { id: 'activity_asset', icon: 'violet', title: 'Canonical asset updated: Voice & tone', detail: 'Added “never over-explain” to the social response guidelines.', time: '2h ago' },
    { id: 'activity_content', icon: 'amber', title: 'Content entered approval queue', detail: 'The signal report / 05 · Instagram carousel · explicit approval required.', time: '12 min ago' },
    { id: 'activity_community', icon: 'blue', title: 'Community event triaged', detail: 'New DM classified as support · draft reply created, not sent.', time: '8 min ago' },
  ],
};

export class WorkspaceStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = null;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      this.state = JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = { workspaces: { [DEFAULT_WORKSPACE.id]: structuredClone(DEFAULT_WORKSPACE) }, audit: [] };
      await this.persist();
    }
  }

  getWorkspace(workspaceId) {
    const workspace = this.state?.workspaces?.[workspaceId];
    return workspace ? structuredClone(workspace) : null;
  }

  async addAsset(workspaceId, input) {
    const workspace = this.requireWorkspace(workspaceId);
    const now = new Date().toISOString();
    const asset = { id: `asset_${randomUUID()}`, name: input.name, type: input.type || 'NOTE', tags: input.tags || ['DRAFT'], description: input.description || '', version: '0.1', updatedAt: now };
    workspace.assets.unshift(asset);
    this.appendActivity(workspace, 'violet', 'Canonical asset added', `${asset.name} · saved as a draft asset.`);
    await this.persist();
    return structuredClone(asset);
  }

  async createContent(workspaceId, input) {
    const workspace = this.requireWorkspace(workspaceId);
    const content = { id: `content_${randomUUID()}`, title: input.title || 'Untitled brief', format: input.format || 'Brief', channel: input.channel || 'INTERNAL', status: 'DRAFT', owner: input.owner || 'R', updatedAt: 'just now', requiresApproval: true };
    workspace.content.unshift(content);
    this.appendActivity(workspace, 'amber', 'Content brief created', `${content.title} · approval required before execution.`);
    await this.persist();
    return structuredClone(content);
  }

  async pauseMutations(workspaceId, reason = 'Operator emergency stop') {
    const workspace = this.requireWorkspace(workspaceId);
    workspace.safety.mutationPause = true;
    workspace.safety.accountState = 'MUTATIONS_PAUSED';
    this.appendActivity(workspace, 'amber', 'Instagram mutations paused', `${reason} · read-only monitoring remains active.`);
    await this.persist();
    return structuredClone(workspace.safety);
  }

  appendAudit(event) {
    this.state.audit.push({ id: `audit_${randomUUID()}`, ...event, createdAt: new Date().toISOString() });
    return this.persist();
  }

  requireWorkspace(workspaceId) {
    const workspace = this.state?.workspaces?.[workspaceId];
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
    return workspace;
  }

  appendActivity(workspace, icon, title, detail) {
    workspace.activity.unshift({ id: `activity_${randomUUID()}`, icon, title, detail, time: 'just now' });
    workspace.activity = workspace.activity.slice(0, 25);
  }

  persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      const temporary = `${this.filePath}.tmp`;
      await writeFile(temporary, JSON.stringify(this.state, null, 2), 'utf8');
      await rename(temporary, this.filePath);
    });
    return this.writeQueue;
  }
}
