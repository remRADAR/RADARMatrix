import { createRuntime, createRequestHandler } from '../apps/brand-studio/server.mjs';

const runtime = await createRuntime();
if (!runtime.runtimeError) throw new Error('Expected production runtime to report missing configuration in this smoke test');
const handler = createRequestHandler(runtime);
const request = Object.assign(new (await import('node:stream')).Readable({ read() { this.push(null); } }), { method: 'GET', url: '/api/health', headers: {} });
const response = { statusCode: 0, headers: {}, writeHead(status, headers) { this.statusCode = status; this.headers = headers; }, end(body) { this.body = body; } };
await handler(request, response);
if (response.statusCode !== 503) throw new Error(`Expected 503, got ${response.statusCode}`);
console.log('deployment smoke passed: production API fails closed with 503');
