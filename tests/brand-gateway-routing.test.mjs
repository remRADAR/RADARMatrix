import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { WorkspaceStore } from '../apps/mcp-server/src/runtime/workspace-store.mjs';
import { BrandGateway } from '../apps/mcp-server/src/runtime/brand-gateway.mjs';

process.env.RADARMATRIX_RUNTIME_MODE = 'development';
process.env.RADARMATRIX_NO_LISTEN = '1';
const { createRequestHandler } = await import('../apps/brand-studio/server.mjs');

function makeRequest(method, url, payload, callerId = 'viewer_000') {
  const chunks = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))];
  const request = Readable.from(chunks);
  request.method = method;
  request.url = url;
  request.headers = { 'x-radarmatrix-caller-id': callerId };
  return request;
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(body) { this.body = body || ''; },
  };
}

export async function runAllTests() {
  const tempDir = await mkdtemp(join(tmpdir(), 'radarmatrix-routing-'));
  try {
    const store = new WorkspaceStore(join(tempDir, 'workspace.json'));
    await store.init();
    const gateway = new BrandGateway(store);
    const handler = createRequestHandler({ gateway, storageMode: 'json', runtimeError: null });
    const before = store.getWorkspace('w_dev');

    const directoryResponse = makeResponse();
    await handler(makeRequest('GET', '/api/agents'), directoryResponse);
    assert.equal(directoryResponse.statusCode, 200);
    const directory = JSON.parse(directoryResponse.body).data;
    assert.equal(directory.executionMode, 'plan_only');
    assert.equal(directory.agents.length, 9);
    assert.ok(directory.agents.every((agent) => agent.allowedMcpTools.length === 0));

    const planResponse = makeResponse();
    await handler(makeRequest('POST', '/api/task-routing/plan', {
      goal: 'Plan a RADAR social intelligence review of artist community signals',
      category: 'auto',
    }), planResponse);
    assert.equal(planResponse.statusCode, 200);
    const plan = JSON.parse(planResponse.body).data;
    assert.equal(plan.assignments[0].agent.id, 'radar_social_intelligence');
    assert.equal(plan.execution.started, false);
    assert.equal(plan.execution.providerConfigured, false);
    assert.equal(plan.approvalGate.sideEffectsPerformed, false);

    const invalidResponse = makeResponse();
    await handler(makeRequest('POST', '/api/task-routing/plan', { goal: '   ', category: 'auto' }), invalidResponse);
    assert.equal(invalidResponse.statusCode, 400);
    assert.equal(JSON.parse(invalidResponse.body).error.code, 'INVALID_TASK');

    const tooLongResponse = makeResponse();
    await handler(makeRequest('POST', '/api/task-routing/plan', { goal: 'x'.repeat(4001), category: 'auto' }), tooLongResponse);
    assert.equal(tooLongResponse.statusCode, 413);
    assert.equal(JSON.parse(tooLongResponse.body).error.code, 'TASK_TOO_LONG');

    const invalidCategoryResponse = makeResponse();
    await handler(makeRequest('POST', '/api/task-routing/plan', { goal: 'Review an app', category: '../private' }), invalidCategoryResponse);
    assert.equal(invalidCategoryResponse.statusCode, 400);
    assert.equal(JSON.parse(invalidCategoryResponse.body).error.code, 'INVALID_CATEGORY');

    const isolated = await gateway.invoke({
      tool: 'radar.plan_task',
      params: { workspace_id: 'w_other', goal: 'Research market trends' },
      context: { caller_id: 'viewer_000', workspace_id: 'w_dev' },
    });
    assert.equal(isolated.success, false);
    assert.equal(isolated.error.code, 'INVALID_REQUEST');

    assert.deepEqual(store.getWorkspace('w_dev'), before, 'read-only routing must not mutate workspace data or activity');
    console.log('brand gateway routing tests passed: viewer access, workspace scope, validation, and no side effects');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await runAllTests();
