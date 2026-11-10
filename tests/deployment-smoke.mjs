import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

process.env.RADARMATRIX_RUNTIME_MODE = 'production';
process.env.RADARMATRIX_STORAGE = 'supabase';
process.env.RADARMATRIX_CALLER_ID = 'deployment-smoke-test';
process.env.RADARMATRIX_NO_LISTEN = '1';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { createRuntime, createRequestHandler } = await import('../apps/brand-studio/server.mjs');
const runtime = await createRuntime();
if (runtime.runtimeError !== 'SUPABASE_SERVER_CREDENTIALS_REQUIRED') {
  throw new Error(`Expected deterministic missing-storage configuration, got: ${runtime.runtimeError ?? 'no runtime error'}`);
}

function makeRequest(method, url, payload) {
  const body = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))];
  return Object.assign(Readable.from(body), { method, url, headers: {} });
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(body) { this.body = body ?? ''; },
  };
}

async function request(handler, method, url, payload, expectedCode) {
  const response = makeResponse();
  await handler(makeRequest(method, url, payload), response);
  const body = JSON.parse(response.body);
  if (response.statusCode !== 503) throw new Error(`${method} ${url}: expected 503, received ${response.statusCode}`);
  if (body?.error?.code !== expectedCode) {
    throw new Error(`${method} ${url}: expected ${expectedCode}, received ${body?.error?.code ?? 'no error code'}`);
  }
  return body;
}

const handler = createRequestHandler(runtime);
await request(handler, 'GET', '/api/health', undefined, 'STORAGE_CONFIGURATION_REQUIRED');
await request(handler, 'GET', '/api/workspace', undefined, 'STORAGE_CONFIGURATION_REQUIRED');
await request(handler, 'POST', '/api/assets', { name: 'must-not-write', type: 'NOTE' }, 'STORAGE_CONFIGURATION_REQUIRED');

const moduleUrl = new URL('../apps/brand-studio/server.mjs', import.meta.url).href;
const missingAuthProgram = `
  process.env.RADARMATRIX_RUNTIME_MODE = 'production';
  process.env.RADARMATRIX_STORAGE = 'supabase';
  process.env.RADARMATRIX_NO_LISTEN = '1';
  process.env.RADARMATRIX_CALLER_ID = '';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { createRuntime, createRequestHandler } = await import(${JSON.stringify(moduleUrl)});
  const { Readable } = await import('node:stream');
  const runtime = await createRuntime();
  const request = Object.assign(Readable.from([]), { method: 'GET', url: '/api/health', headers: {} });
  const response = { statusCode: 0, body: '', writeHead(status) { this.statusCode = status; }, end(body) { this.body = body; } };
  await createRequestHandler(runtime)(request, response);
  const body = JSON.parse(response.body);
  if (response.statusCode !== 503 || body?.error?.code !== 'AUTH_CONFIGURATION_REQUIRED') {
    throw new Error('missing production caller must fail closed with AUTH_CONFIGURATION_REQUIRED');
  }
`;
const missingAuth = spawnSync(process.execPath, ['--input-type=module', '-e', missingAuthProgram], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  encoding: 'utf8',
  env: { ...process.env, RADARMATRIX_CALLER_ID: '' },
});
if (missingAuth.status !== 0) {
  throw new Error(`missing-auth subprocess failed: ${missingAuth.stderr || missingAuth.stdout || missingAuth.error}`);
}

console.log('deployment smoke passed: missing production storage and auth fail closed on reads and writes');
