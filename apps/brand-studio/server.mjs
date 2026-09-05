import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceStore } from '../mcp-server/src/runtime/workspace-store.mjs';
import { BrandGateway } from '../mcp-server/src/runtime/brand-gateway.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataFile = process.env.RADARMATRIX_DATA_FILE || join(root, '../../.data/workspace.json');
const port = Number(process.env.PORT || 4173);
const workspaceId = 'w_dev';
const callerId = process.env.RADARMATRIX_CALLER_ID || 'admin_123';
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const store = new WorkspaceStore(dataFile);
await store.init();
const gateway = new BrandGateway(store);

function safePath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://localhost:${port}`).pathname);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const absolute = normalize(join(root, requested));
  return absolute.startsWith(root) ? absolute : null;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function gatewayContext() {
  return { caller_id: callerId, workspace_id: workspaceId, request_id: `ui_${Date.now()}` };
}

async function invoke(tool, params, requestBody = {}) {
  return gateway.invoke({ tool, params: { ...params, workspace_id: workspaceId }, context: gatewayContext(), approval: requestBody.approval, consent: requestBody.consent });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      if (request.method === 'GET' && url.pathname === '/api/workspace') {
        const result = await invoke('radar.get_context', {});
        sendJson(response, result.success ? 200 : result.error.status, result);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/assets') {
        const body = await readJson(request);
        const result = await invoke('radar.remember', { asset: { name: body.name, type: body.type, description: body.description, tags: body.tags } }, { approval: body.approval });
        sendJson(response, result.success ? 201 : result.error.status, result);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/content') {
        const body = await readJson(request);
        const result = await invoke('radar.remember', { content: { title: body.title, format: body.format, channel: body.channel }, requires_consent: Boolean(body.requires_consent) }, { approval: body.approval, consent: body.consent });
        sendJson(response, result.success ? 201 : result.error.status, result);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/emergency-stop') {
        const body = await readJson(request);
        const result = await invoke('radar.record_decision', { action: 'emergency_stop', reason: body.reason || 'Operator emergency stop' }, { approval: { approved: true } });
        sendJson(response, result.success ? 200 : result.error.status, result);
        return;
      }
      sendJson(response, 404, { success: false, error: { code: 'NOT_FOUND', message: 'API route not found', status: 404 } });
    } catch (error) {
      const status = error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
      sendJson(response, status, { success: false, error: { code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON', message: status === 413 ? 'Request body is too large' : 'Request body must be valid JSON', status } });
    }
    return;
  }

  const path = safePath(request.url || '/');
  if (!path) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Bad request');
    return;
  }

  try {
    const body = await readFile(path);
    response.writeHead(200, {
      'content-type': contentTypes[extname(path)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`RADARMatrix Brand Studio running at http://127.0.0.1:${port}`);
  console.log(`Workspace storage: ${dataFile}`);
  console.log(`Development caller: ${callerId}`);
});
