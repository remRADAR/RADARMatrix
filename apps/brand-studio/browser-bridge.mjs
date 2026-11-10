/**
 * RADARMatrix browser bridge contract — fail-closed foundation.
 *
 * This module defines the contract between the Brand Studio Browser Takeover
 * panel and a trusted, host-injected browser bridge. It deliberately contains
 * no browser-session service, no CDP/WebRTC transport, no session store, and
 * no host adapter. It only:
 *
 *   - declares the protocol identifier, capability allowlist, request and
 *     result shapes, readiness event name, and structured error codes;
 *   - validates every connect request and every host response at runtime;
 *   - resolves the host-injected bridge fail-closed: a missing, malformed,
 *     protocol-incompatible, or throwing bridge resolves to "unavailable";
 *   - never calls `connect` on its own, never stores session or token
 *     material, and never logs request or response payloads.
 *
 * Security boundary: the page hosting this code is only trusted to ASK for a
 * session. The trusted host adapter is the sole authority that grants one.
 * Any workspace, capability, role, or user claim in a request is an
 * unverified claim until the trusted host validates it. Nothing in this
 * module treats those claims as authorization.
 */

/** Protocol/version identifier the host bridge must declare. */
export const BRIDGE_PROTOCOL = 'radar-browser-bridge/1';

/** Global property a trusted host uses to expose the bridge. */
export const BRIDGE_GLOBAL_KEY = 'RADAR_BROWSER_BRIDGE';

/** Event a trusted host dispatches when the bridge is injected late. */
export const BRIDGE_READY_EVENT = 'radar-browser-bridge-ready';

/**
 * The complete capability allowlist. Anything outside this set is rejected
 * before the host is invoked. Arbitrary code execution, credential access,
 * downloads, uploads, and unrestricted keyboard/mouse control are NOT part
 * of this contract and must not be added without a host-side authority that
 * can enforce them.
 *
 * @typedef {'read_view' | 'navigate'} BridgeCapability
 * @type {readonly BridgeCapability[]}
 */
export const BRIDGE_CAPABILITIES = Object.freeze(['read_view', 'navigate']);

/**
 * Structured error codes surfaced by this contract. Consumers must key all
 * user-facing or audit behaviour off these codes, never off free-form text.
 * Messages produced by this module are fixed strings: they never embed
 * request or response values, so no scope, session, or token material can
 * leak through an error path.
 */
export const BRIDGE_ERROR_CODES = Object.freeze({
  MISSING_BRIDGE: 'missing_bridge',
  MALFORMED_BRIDGE: 'malformed_bridge',
  UNSUPPORTED_PROTOCOL: 'unsupported_protocol',
  INVALID_REQUEST: 'invalid_request',
  INVALID_SCOPE: 'invalid_scope',
  UNSUPPORTED_CAPABILITY: 'unsupported_capability',
  SESSION_EXPIRED: 'session_expired',
  HOST_ADAPTER_UNAVAILABLE: 'host_adapter_unavailable',
});

/**
 * Session scope of a connect request.
 * @typedef {Object} BridgeScope
 * @property {string} workspace Non-empty workspace identifier this page serves.
 * @property {string} [session] Optional session identifier previously issued by the trusted host.
 */

/**
 * Connect request. These are the only fields a connect request may carry;
 * unknown keys are rejected. The trusted host — never this page — decides
 * whether the requested scope and capabilities are granted.
 * @typedef {Object} BridgeConnectRequest
 * @property {BridgeScope} scope
 * @property {BridgeCapability[]} requestedCapabilities Non-empty subset of BRIDGE_CAPABILITIES.
 * @property {string} [reason] Optional human-readable reason (max 200 chars).
 * @property {string} [previewUrl] Optional absolute http(s) URL without embedded credentials (max 2048 chars).
 */

/**
 * @typedef {{ status: 'connected', operatorLabel: string | null }} BridgeConnectedResult
 * @typedef {{ status: 'denied', reason: string | null }} BridgeDeniedResult
 * @typedef {{ status: 'error', code: string, message: string }} BridgeErrorResult
 * @typedef {BridgeConnectedResult | BridgeDeniedResult | BridgeErrorResult} BridgeConnectOutcome
 * @typedef {{ status: 'disconnected' } | BridgeErrorResult} BridgeDisconnectOutcome
 * @typedef {{ ok: true, value: BridgeConnectRequest } | { ok: false, code: string, message: string }} BridgeValidation
 */

const KNOWN_REQUEST_KEYS = ['scope', 'requestedCapabilities', 'reason', 'previewUrl'];
const KNOWN_SCOPE_KEYS = ['workspace', 'session'];
const MAX_WORKSPACE_LENGTH = 64;
const MAX_SESSION_LENGTH = 128;
const MAX_REASON_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const MAX_LABEL_LENGTH = 80;
const ERROR_MESSAGES = Object.freeze({
  [BRIDGE_ERROR_CODES.MISSING_BRIDGE]: 'No trusted browser bridge is present on this page.',
  [BRIDGE_ERROR_CODES.MALFORMED_BRIDGE]: 'The installed browser bridge is malformed.',
  [BRIDGE_ERROR_CODES.UNSUPPORTED_PROTOCOL]: 'The installed browser bridge speaks an unsupported protocol version.',
  [BRIDGE_ERROR_CODES.INVALID_REQUEST]: 'The connect request is malformed.',
  [BRIDGE_ERROR_CODES.INVALID_SCOPE]: 'The connect request carries a missing or invalid workspace scope.',
  [BRIDGE_ERROR_CODES.UNSUPPORTED_CAPABILITY]: 'The connect request asks for a capability outside the allowlist.',
  [BRIDGE_ERROR_CODES.SESSION_EXPIRED]: 'The browser session expired or was revoked.',
  [BRIDGE_ERROR_CODES.HOST_ADAPTER_UNAVAILABLE]: 'The trusted host adapter is unavailable.',
});

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength) return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && /^[ -~]*$/.test(trimmed);
}

function errorResult(code, message) {
  return { status: 'error', code, message: message || ERROR_MESSAGES[code] || 'Unknown browser bridge error.' };
}

/**
 * @param {unknown} value
 * @returns {boolean} true when the value is inside the capability allowlist.
 */
export function isKnownBridgeCapability(value) {
  return typeof value === 'string' && BRIDGE_CAPABILITIES.includes(value);
}

/**
 * Runtime-validate a connect request without touching the host. Returns a
 * normalized copy containing only the known, bounded fields, or a structured
 * error. When `options.expectedWorkspace` is provided, a scope that names a
 * different workspace is rejected before any host invocation (cross-workspace
 * requests never leave the page).
 *
 * @param {unknown} request
 * @param {{ expectedWorkspace?: string }} [options]
 * @returns {BridgeValidation}
 */
export function validateConnectRequest(request, options = {}) {
  if (!isPlainObject(request)) return { ok: false, code: BRIDGE_ERROR_CODES.INVALID_REQUEST, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.INVALID_REQUEST] };
  const unknownKeys = Object.keys(request).filter((key) => !KNOWN_REQUEST_KEYS.includes(key));
  if (unknownKeys.length > 0) return { ok: false, code: BRIDGE_ERROR_CODES.INVALID_REQUEST, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.INVALID_REQUEST] };

  const scope = request.scope;
  if (!isPlainObject(scope)) return { ok: false, code: BRIDGE_ERROR_CODES.INVALID_SCOPE, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.INVALID_SCOPE] };
  const unknownScopeKeys = Object.keys(scope).filter((key) => !KNOWN_SCOPE_KEYS.includes(key));
  if (unknownScopeKeys.length > 0) return { ok: false, code: BRIDGE_ERROR_CODES.INVALID_SCOPE, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.INVALID_SCOPE] };
  if (!isBoundedString(scope.workspace, MAX_WORKSPACE_LENGTH)) return { ok: false, code: BRIDGE_ERROR_CODES.INVALID_SCOPE, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.INVALID_SCOPE] };
  if (scope.session !== undefined && !isBoundedString(scope.session, MAX_SESSION_LENGTH)) return { ok: false, code: BRIDGE_ERROR_CODES.INVALID_SCOPE, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.INVALID_SCOPE] };
  if (options.expectedWorkspace !== undefined && scope.workspace !== options.expectedWorkspace) {
    return { ok: false, code: BRIDGE_ERROR_CODES.INVALID_SCOPE, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.INVALID_SCOPE] };
  }

  const capabilities = request.requestedCapabilities;
  if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.length > BRIDGE_CAPABILITIES.length) {
    return { ok: false, code: BRIDGE_ERROR_CODES.UNSUPPORTED_CAPABILITY, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.UNSUPPORTED_CAPABILITY] };
  }
  if (new Set(capabilities).size !== capabilities.length) return { ok: false, code: BRIDGE_ERROR_CODES.UNSUPPORTED_CAPABILITY, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.UNSUPPORTED_CAPABILITY] };
  if (!capabilities.every(isKnownBridgeCapability)) return { ok: false, code: BRIDGE_ERROR_CODES.UNSUPPORTED_CAPABILITY, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.UNSUPPORTED_CAPABILITY] };

  if (request.reason !== undefined && !isBoundedString(request.reason, MAX_REASON_LENGTH)) {
    return { ok: false, code: BRIDGE_ERROR_CODES.INVALID_REQUEST, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.INVALID_REQUEST] };
  }

  let previewUrl;
  if (request.previewUrl !== undefined) {
    if (typeof request.previewUrl !== 'string' || request.previewUrl.length > MAX_URL_LENGTH) {
      return { ok: false, code: BRIDGE_ERROR_CODES.INVALID_REQUEST, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.INVALID_REQUEST] };
    }
    let parsed;
    try {
      parsed = new URL(request.previewUrl);
    } catch {
      return { ok: false, code: BRIDGE_ERROR_CODES.INVALID_REQUEST, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.INVALID_REQUEST] };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, code: BRIDGE_ERROR_CODES.INVALID_REQUEST, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.INVALID_REQUEST] };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, code: BRIDGE_ERROR_CODES.INVALID_REQUEST, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.INVALID_REQUEST] };
    }
    previewUrl = parsed.href;
  }

  const normalized = { scope: { workspace: scope.workspace.trim() }, requestedCapabilities: [...capabilities] };
  if (scope.session !== undefined) normalized.scope.session = scope.session.trim();
  if (request.reason !== undefined) normalized.reason = request.reason.trim();
  if (previewUrl !== undefined) normalized.previewUrl = previewUrl;
  return { ok: true, value: normalized };
}

/**
 * Classify a candidate bridge object.
 * @param {unknown} candidate
 * @returns {{ ok: true, value: object } | { ok: false, code: string, message: string }}
 */
export function validateBridge(candidate) {
  try {
    if (!isPlainObject(candidate) || typeof candidate.connect !== 'function' || typeof candidate.disconnect !== 'function') {
      return { ok: false, code: BRIDGE_ERROR_CODES.MALFORMED_BRIDGE, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.MALFORMED_BRIDGE] };
    }
    if (candidate.protocol !== BRIDGE_PROTOCOL) {
      return { ok: false, code: BRIDGE_ERROR_CODES.UNSUPPORTED_PROTOCOL, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.UNSUPPORTED_PROTOCOL] };
    }
  } catch {
    return { ok: false, code: BRIDGE_ERROR_CODES.MALFORMED_BRIDGE, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.MALFORMED_BRIDGE] };
  }
  return { ok: true, value: candidate };
}

/** @typedef {{ status: 'unavailable', code: string, message: string } | { status: 'available' }} BridgeAvailability */

function inspectBrowserBridge(globalScope) {
  try {
    if (!isPlainObject(globalScope)) {
      return {
        availability: { status: 'unavailable', code: BRIDGE_ERROR_CODES.MISSING_BRIDGE, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.MISSING_BRIDGE] },
        bridge: null,
      };
    }
    const raw = globalScope[BRIDGE_GLOBAL_KEY];
    if (raw === undefined || raw === null) {
      return {
        availability: { status: 'unavailable', code: BRIDGE_ERROR_CODES.MISSING_BRIDGE, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.MISSING_BRIDGE] },
        bridge: null,
      };
    }
    const validation = validateBridge(raw);
    if (!validation.ok) {
      return { availability: { status: 'unavailable', code: validation.code, message: validation.message }, bridge: null };
    }
    return { availability: { status: 'available' }, bridge: validation.value };
  } catch {
    return {
      availability: { status: 'unavailable', code: BRIDGE_ERROR_CODES.MALFORMED_BRIDGE, message: ERROR_MESSAGES[BRIDGE_ERROR_CODES.MALFORMED_BRIDGE] },
      bridge: null,
    };
  }
}

/**
 * Read the host-injected bridge from a global scope (the page passes
 * `window`). A missing, malformed, protocol-incompatible, or throwing
 * property is reported as unavailable — never as a usable bridge.
 *
 * @param {unknown} globalScope
 * @returns {BridgeAvailability}
 */
export function describeBridgeAvailability(globalScope) {
  return inspectBrowserBridge(globalScope).availability;
}

/**
 * Resolve the host-injected bridge, or null when it is missing, malformed,
 * protocol-incompatible, or throwing. Callers must treat null as
 * "unavailable" and must not fabricate a connected state.
 *
 * @param {unknown} globalScope
 * @returns {object | null}
 */
export function resolveBrowserBridge(globalScope) {
  return inspectBrowserBridge(globalScope).bridge;
}

/**
 * Subscribe to the host's late-injection readiness event. The handler is
 * invoked for re-evaluation only — this function never connects. The
 * returned unsubscribe removes the listener and is idempotent.
 *
 * @param {unknown} globalScope
 * @param {() => void} handler
 * @returns {() => void}
 */
export function subscribeBridgeReady(globalScope, handler) {
  if (!isPlainObject(globalScope) || typeof handler !== 'function' || typeof globalScope.addEventListener !== 'function') {
    return () => {};
  }
  const listener = () => {
    try {
      handler();
    } catch {
      // A throwing readiness observer must not break the page; the state
      // simply stays as it was, which is the fail-closed direction.
    }
  };
  globalScope.addEventListener(BRIDGE_READY_EVENT, listener);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    try {
      if (typeof globalScope.removeEventListener === 'function') globalScope.removeEventListener(BRIDGE_READY_EVENT, listener);
    } catch {
      // Cleanup is best-effort; the listener is simply left in place.
    }
  };
}

function bridgeForConnection(globalScope) {
  const inspected = inspectBrowserBridge(globalScope);
  if (inspected.availability.status !== 'available') {
    return { error: errorResult(inspected.availability.code, inspected.availability.message), bridge: null };
  }
  return { error: null, bridge: inspected.bridge };
}

function codeFromThrown(thrown) {
  if (isPlainObject(thrown) && Object.values(BRIDGE_ERROR_CODES).includes(thrown.code)) return thrown.code;
  return BRIDGE_ERROR_CODES.HOST_ADAPTER_UNAVAILABLE;
}

function sanitizeText(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value.trim() : null;
}

function interpretConnectResponse(response) {
  if (!isPlainObject(response)) return errorResult(BRIDGE_ERROR_CODES.MALFORMED_BRIDGE);
  if (response.connected === true) {
    // Copy ONLY the allowlisted result fields. Anything else the host may
    // return (session tokens, identifiers, diagnostics) is dropped here and
    // must never reach storage, URLs, DOM attributes, or logs.
    return { status: 'connected', operatorLabel: sanitizeText(response.operatorLabel, MAX_LABEL_LENGTH) };
  }
  if (response.connected === false) {
    return { status: 'denied', reason: sanitizeText(response.reason, MAX_REASON_LENGTH) };
  }
  return errorResult(BRIDGE_ERROR_CODES.MALFORMED_BRIDGE);
}

/**
 * Request a browser session from the trusted host bridge. This never runs on
 * its own: it is called only from an explicit operator action. The request is
 * validated first, so unknown capabilities and invalid or cross-workspace
 * scopes are rejected before the host is invoked. A throwing bridge maps to
 * an error result, never to a connected state.
 *
 * @param {unknown} globalScope
 * @param {unknown} request
 * @param {{ expectedWorkspace?: string }} [options]
 * @returns {Promise<BridgeConnectOutcome>}
 */
export async function connectBrowserBridge(globalScope, request, options = {}) {
  const resolved = bridgeForConnection(globalScope);
  if (resolved.error) return resolved.error;
  const validated = validateConnectRequest(request, options);
  if (!validated.ok) return errorResult(validated.code, validated.message);
  let response;
  try {
    response = await resolved.bridge.connect(validated.value);
  } catch (thrown) {
    return errorResult(codeFromThrown(thrown));
  }
  try {
    return interpretConnectResponse(response);
  } catch {
    return errorResult(BRIDGE_ERROR_CODES.MALFORMED_BRIDGE);
  }
}

/**
 * End a browser session via the trusted host bridge. The caller clears any
 * local connected state regardless of the outcome; an error result must
 * never be rendered as a connected state.
 *
 * @param {unknown} globalScope
 * @returns {Promise<BridgeDisconnectOutcome>}
 */
export async function disconnectBrowserBridge(globalScope) {
  const resolved = bridgeForConnection(globalScope);
  if (resolved.error) return resolved.error;
  try {
    await resolved.bridge.disconnect();
  } catch (thrown) {
    return errorResult(codeFromThrown(thrown));
  }
  return { status: 'disconnected' };
}
