import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BRIDGE_CAPABILITIES,
  BRIDGE_ERROR_CODES,
  BRIDGE_GLOBAL_KEY,
  BRIDGE_PROTOCOL,
  BRIDGE_READY_EVENT,
  connectBrowserBridge,
  describeBridgeAvailability,
  disconnectBrowserBridge,
  isKnownBridgeCapability,
  resolveBrowserBridge,
  subscribeBridgeReady,
  validateConnectRequest,
} from '../apps/brand-studio/browser-bridge.mjs';

function makeScope({ bridge, storageWrites } = {}) {
  const scope = {
    listeners: {},
    addEventListener(type, listener) { (this.listeners[type] = this.listeners[type] || []).push(listener); },
    removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== listener); },
    dispatch(type) { (this.listeners[type] || []).forEach((listener) => listener({ type })); },
  };
  if (bridge !== undefined) scope[BRIDGE_GLOBAL_KEY] = bridge;
  if (storageWrites) scope.localStorage = { setItem: (key, value) => storageWrites.push([key, value]), getItem: () => null, removeItem: () => {} };
  return scope;
}

function throwingBridgeScope() {
  const scope = makeScope();
  Object.defineProperty(scope, BRIDGE_GLOBAL_KEY, { get() { throw new Error('bridge getter exploded'); } });
  return scope;
}

function makeBridge(overrides = {}) {
  const calls = { connect: [], disconnect: 0 };
  const bridge = {
    protocol: BRIDGE_PROTOCOL,
    async connect(request) { calls.connect.push(request); return { connected: true, operatorLabel: 'REM operator' }; },
    async disconnect() { calls.disconnect += 1; },
    ...overrides,
  };
  return { bridge, calls };
}

function validRequest(overrides = {}) {
  return {
    scope: { workspace: 'remRADAR' },
    requestedCapabilities: [...BRIDGE_CAPABILITIES],
    reason: 'Brand Studio live preview takeover',
    previewUrl: 'https://preview.example/page',
    ...overrides,
  };
}

export async function runAllTests() {
  // --- Fail-closed resolution: no bridge installed -------------------------
  {
    const scope = makeScope();
    assert.equal(resolveBrowserBridge(scope), null, 'a missing bridge must resolve to null');
    const availability = describeBridgeAvailability(scope);
    assert.equal(availability.status, 'unavailable');
    assert.equal(availability.code, BRIDGE_ERROR_CODES.MISSING_BRIDGE);
    const outcome = await connectBrowserBridge(scope, validRequest());
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.code, BRIDGE_ERROR_CODES.MISSING_BRIDGE, 'no bridge means no connection attempt');
  }

  // --- Fail-closed resolution: malformed bridges ---------------------------
  // An explicitly nulled bridge property is still "missing" — the point is
  // that it is unavailable, never usable.
  {
    const scope = makeScope({ bridge: null });
    assert.equal(resolveBrowserBridge(scope), null, 'a nulled bridge must resolve to null');
    const availability = describeBridgeAvailability(scope);
    assert.equal(availability.status, 'unavailable');
    assert.equal(availability.code, BRIDGE_ERROR_CODES.MISSING_BRIDGE);
    const outcome = await connectBrowserBridge(scope, validRequest());
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.code, BRIDGE_ERROR_CODES.MISSING_BRIDGE);
  }

  const malformedBridges = [
    [42, BRIDGE_ERROR_CODES.MALFORMED_BRIDGE],
    ['bridge', BRIDGE_ERROR_CODES.MALFORMED_BRIDGE],
    [{}, BRIDGE_ERROR_CODES.MALFORMED_BRIDGE],
    [{ connect() {}, disconnect() {} }, BRIDGE_ERROR_CODES.UNSUPPORTED_PROTOCOL],
    [{ protocol: BRIDGE_PROTOCOL }, BRIDGE_ERROR_CODES.MALFORMED_BRIDGE],
  ];
  for (const [candidate, expectedCode] of malformedBridges) {
    const scope = makeScope({ bridge: candidate });
    assert.equal(resolveBrowserBridge(scope), null, `malformed bridge ${JSON.stringify(candidate)} must resolve to null`);
    const availability = describeBridgeAvailability(scope);
    assert.equal(availability.status, 'unavailable');
    assert.equal(availability.code, expectedCode);
    const outcome = await connectBrowserBridge(scope, validRequest());
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.code, expectedCode);
  }

  // A throwing bridge property is unavailable, never usable.
  {
    const scope = throwingBridgeScope();
    assert.equal(resolveBrowserBridge(scope), null);
    const availability = describeBridgeAvailability(scope);
    assert.equal(availability.code, BRIDGE_ERROR_CODES.MALFORMED_BRIDGE);
    const outcome = await connectBrowserBridge(scope, validRequest());
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.code, BRIDGE_ERROR_CODES.MALFORMED_BRIDGE);
  }

  // --- Fail-closed resolution: unsupported protocol -------------------------
  {
    const { bridge } = makeBridge({ protocol: 'radar-browser-bridge/0' });
    const scope = makeScope({ bridge });
    assert.equal(resolveBrowserBridge(scope), null, 'an incompatible protocol must resolve to null');
    const availability = describeBridgeAvailability(scope);
    assert.equal(availability.code, BRIDGE_ERROR_CODES.UNSUPPORTED_PROTOCOL);
    const outcome = await connectBrowserBridge(scope, validRequest());
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.code, BRIDGE_ERROR_CODES.UNSUPPORTED_PROTOCOL);
  }

  // --- Request validation: unknown capability rejected before the host ----
  {
    const { bridge, calls } = makeBridge();
    const scope = makeScope({ bridge });
    const request = validRequest({ requestedCapabilities: ['read_view', 'mouse'] });
    const validation = validateConnectRequest(request);
    assert.equal(validation.ok, false);
    assert.equal(validation.code, BRIDGE_ERROR_CODES.UNSUPPORTED_CAPABILITY);
    const outcome = await connectBrowserBridge(scope, request);
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.code, BRIDGE_ERROR_CODES.UNSUPPORTED_CAPABILITY);
    assert.equal(calls.connect.length, 0, 'unknown capabilities must be rejected before host invocation');
    assert.equal(isKnownBridgeCapability('mouse'), false);
    assert.equal(isKnownBridgeCapability('read_view'), true);
    assert.equal(isKnownBridgeCapability('navigate'), true);
  }

  // --- Request validation: scope rejected before the host ------------------
  {
    const { bridge, calls } = makeBridge();
    const scope = makeScope({ bridge });

    const missingScope = validRequest({ scope: undefined });
    assert.equal(validateConnectRequest(missingScope).code, BRIDGE_ERROR_CODES.INVALID_SCOPE);
    const emptyWorkspace = validRequest({ scope: { workspace: '   ' } });
    assert.equal(validateConnectRequest(emptyWorkspace).code, BRIDGE_ERROR_CODES.INVALID_SCOPE);
    const unknownScopeKey = validRequest({ scope: { workspace: 'remRADAR', role: 'admin' } });
    assert.equal(validateConnectRequest(unknownScopeKey).code, BRIDGE_ERROR_CODES.INVALID_SCOPE, 'page-supplied role claims are not part of the scope');
    const sessionClaim = validRequest({ scope: { workspace: 'remRADAR', session: 'x'.repeat(129) } });
    assert.equal(validateConnectRequest(sessionClaim).code, BRIDGE_ERROR_CODES.INVALID_SCOPE);

    const crossWorkspace = validRequest();
    for (const bad of [missingScope, emptyWorkspace, unknownScopeKey, sessionClaim]) {
      const outcome = await connectBrowserBridge(scope, bad);
      assert.equal(outcome.status, 'error');
      assert.equal(outcome.code, BRIDGE_ERROR_CODES.INVALID_SCOPE);
    }
    const cross = await connectBrowserBridge(scope, crossWorkspace, { expectedWorkspace: 'other-workspace' });
    assert.equal(cross.status, 'error');
    assert.equal(cross.code, BRIDGE_ERROR_CODES.INVALID_SCOPE, 'cross-workspace requests are rejected before host invocation');
    const matching = await connectBrowserBridge(scope, validRequest(), { expectedWorkspace: 'remRADAR' });
    assert.equal(matching.status, 'connected');
    assert.equal(calls.connect.length, 1, 'only the valid, in-scope request reaches the host');
  }

  // --- Request validation: malformed requests ------------------------------
  {
    assert.equal(validateConnectRequest(null).code, BRIDGE_ERROR_CODES.INVALID_REQUEST);
    assert.equal(validateConnectRequest('connect').code, BRIDGE_ERROR_CODES.INVALID_REQUEST);
    assert.equal(validateConnectRequest(validRequest({ injected: true })).code, BRIDGE_ERROR_CODES.INVALID_REQUEST, 'unknown top-level fields are rejected');
    assert.equal(validateConnectRequest(validRequest({ reason: 'x'.repeat(201) })).code, BRIDGE_ERROR_CODES.INVALID_REQUEST);
    assert.equal(validateConnectRequest(validRequest({ previewUrl: 'ftp://preview.example' })).code, BRIDGE_ERROR_CODES.INVALID_REQUEST);
    assert.equal(validateConnectRequest(validRequest({ previewUrl: 'https://user:pass@preview.example' })).code, BRIDGE_ERROR_CODES.INVALID_REQUEST, 'credentials in the preview URL are rejected');
    assert.equal(validateConnectRequest(validRequest({ previewUrl: 'not a url' })).code, BRIDGE_ERROR_CODES.INVALID_REQUEST);
    assert.equal(validateConnectRequest(validRequest({ requestedCapabilities: [] })).code, BRIDGE_ERROR_CODES.UNSUPPORTED_CAPABILITY);
    assert.equal(validateConnectRequest(validRequest({ requestedCapabilities: 'read_view' })).code, BRIDGE_ERROR_CODES.UNSUPPORTED_CAPABILITY);
    assert.equal(validateConnectRequest(validRequest({ requestedCapabilities: ['read_view', 'read_view'] })).code, BRIDGE_ERROR_CODES.UNSUPPORTED_CAPABILITY, 'duplicate capabilities are rejected');
    const ok = validateConnectRequest(validRequest());
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.value.requestedCapabilities, [...BRIDGE_CAPABILITIES]);
    assert.equal(ok.value.previewUrl, 'https://preview.example/page');
  }

  // --- Bridge method throws: error state, never connected ------------------
  {
    const { bridge } = makeBridge({ connect: async () => { throw new Error('adapter exploded'); } });
    const scope = makeScope({ bridge });
    const outcome = await connectBrowserBridge(scope, validRequest());
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.code, BRIDGE_ERROR_CODES.HOST_ADAPTER_UNAVAILABLE);
    assert.notEqual(outcome.status, 'connected');
  }
  {
    const expired = Object.assign(new Error('session expired'), { code: BRIDGE_ERROR_CODES.SESSION_EXPIRED });
    const { bridge } = makeBridge({ connect: async () => { throw expired; } });
    const scope = makeScope({ bridge });
    const outcome = await connectBrowserBridge(scope, validRequest());
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.code, BRIDGE_ERROR_CODES.SESSION_EXPIRED, 'a revoked session maps to its structured code');
  }

  // --- Response validation: garbage, denial, and sanitization --------------
  {
    const { bridge } = makeBridge({ connect: async () => null });
    const outcome = await connectBrowserBridge(makeScope({ bridge }), validRequest());
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.code, BRIDGE_ERROR_CODES.MALFORMED_BRIDGE);
  }
  {
    const { bridge } = makeBridge({ connect: async () => ({ connected: 'yes' }) });
    const outcome = await connectBrowserBridge(makeScope({ bridge }), validRequest());
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.code, BRIDGE_ERROR_CODES.MALFORMED_BRIDGE, 'a truthy non-boolean connected flag is not a session');
  }
  {
    const { bridge } = makeBridge({ connect: async () => ({ connected: false, reason: 'operator quota reached' }) });
    const outcome = await connectBrowserBridge(makeScope({ bridge }), validRequest());
    assert.equal(outcome.status, 'denied');
    assert.equal(outcome.reason, 'operator quota reached');
  }
  {
    // The host may return extra fields; only the allowlisted result fields
    // survive, so token material can never reach storage, URLs, DOM, or logs.
    const { bridge } = makeBridge({ connect: async () => ({ connected: true, token: 'tok_secret_value', sessionToken: 'tok_secret_value_2', operatorLabel: 'REM operator' }) });
    const outcome = await connectBrowserBridge(makeScope({ bridge }), validRequest());
    assert.equal(outcome.status, 'connected');
    assert.equal(outcome.operatorLabel, 'REM operator');
    const serialized = JSON.stringify(outcome);
    assert.ok(!serialized.includes('tok_secret_value'), 'token material must not survive response validation');
    assert.deepEqual(Object.keys(outcome).sort(), ['operatorLabel', 'status']);
  }

  // --- Readiness event: re-evaluation only, no automatic connection --------
  {
    const { bridge, calls } = makeBridge();
    const scope = makeScope();
    let reevaluations = 0;
    const unsubscribe = subscribeBridgeReady(scope, () => {
      reevaluations += 1;
      resolveBrowserBridge(scope);
    });
    assert.equal(reevaluations, 0);
    assert.equal(resolveBrowserBridge(scope), null, 'before injection the bridge is unavailable');
    scope[BRIDGE_GLOBAL_KEY] = bridge;
    scope.dispatch(BRIDGE_READY_EVENT);
    assert.equal(reevaluations, 1, 'the ready event causes exactly one re-evaluation');
    assert.equal(calls.connect.length, 0, 'readiness must never trigger a connection attempt');
    assert.equal(resolveBrowserBridge(scope), bridge, 'after injection the bridge resolves');
    unsubscribe();
    scope.dispatch(BRIDGE_READY_EVENT);
    assert.equal(reevaluations, 1, 'cleanup removes the readiness listener');
  }
  {
    // Cleanup is idempotent and safe on scopes without event support.
    const unsubscribe = subscribeBridgeReady(makeScope(), () => {});
    assert.doesNotThrow(unsubscribe);
    assert.doesNotThrow(unsubscribe);
    assert.doesNotThrow(() => subscribeBridgeReady(null, () => {})());
  }

  // --- Explicit connect/disconnect lifecycle -------------------------------
  {
    const { bridge, calls } = makeBridge();
    const scope = makeScope({ bridge });
    const connected = await connectBrowserBridge(scope, validRequest());
    assert.equal(connected.status, 'connected');
    assert.equal(calls.connect.length, 1);
    assert.deepEqual(calls.connect[0].scope, { workspace: 'remRADAR' }, 'the host receives only the normalized, bounded request');
    const disconnected = await disconnectBrowserBridge(scope);
    assert.equal(disconnected.status, 'disconnected');
    assert.equal(calls.disconnect, 1);
    const noBridgeDisconnect = await disconnectBrowserBridge(makeScope());
    assert.equal(noBridgeDisconnect.status, 'error');
    assert.equal(noBridgeDisconnect.code, BRIDGE_ERROR_CODES.MISSING_BRIDGE);
  }

  // --- No session material in storage, URL, DOM, or logs -------------------
  {
    const storageWrites = [];
    const { bridge } = makeBridge({ connect: async () => ({ connected: true, token: 'tok_secret_value', operatorLabel: 'REM operator' }) });
    const scope = makeScope({ bridge, storageWrites });
    const logged = [];
    const realLog = console.log;
    const realError = console.error;
    console.log = (...args) => logged.push(args.join(' '));
    console.error = (...args) => logged.push(args.join(' '));
    try {
      const outcome = await connectBrowserBridge(scope, validRequest());
      await disconnectBrowserBridge(scope);
      assert.equal(outcome.status, 'connected');
    } finally {
      console.log = realLog;
      console.error = realError;
    }
    assert.equal(storageWrites.length, 0, 'session/token material must never be written to storage');
    assert.equal(logged.length, 0, 'the contract module must never log request or response payloads');
  }
  {
    // Static boundary check: the contract module has no storage, cookie,
    // document, or logging surface at all.
    const source = readFileSync(fileURLToPath(new URL('../apps/brand-studio/browser-bridge.mjs', import.meta.url)), 'utf8');
    for (const forbidden of ['localStorage', 'sessionStorage', 'document.cookie', 'console.log', 'console.error', 'window.location']) {
      assert.ok(!source.includes(forbidden), `browser-bridge.mjs must not reference ${forbidden}`);
    }
  }

  // --- Shipped UI fails closed without a trusted host bridge ---------------
  {
    const html = readFileSync(fileURLToPath(new URL('../apps/brand-studio/index.html', import.meta.url)), 'utf8');
    const buttonTag = html.match(/<button[^>]*id="browser-connect"[^>]*>/);
    assert.ok(buttonTag, 'the Browser Takeover connect button must exist');
    assert.ok(buttonTag[0].includes('disabled'), 'the shipped connect button must be disabled by default');
    assert.ok(html.includes('data-workspace='), 'the preview view must declare the workspace scope it serves');
  }

  console.log('browser bridge contract tests passed: fail-closed resolution, bounded requests, sanitized results, readiness without auto-connect, cleanup, and no session material in storage or logs');
}

if (import.meta.url === `file://${process.argv[1]}`) await runAllTests();
