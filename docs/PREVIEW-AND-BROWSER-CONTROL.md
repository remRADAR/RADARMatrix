# Live Preview and Browser Control

## What is implemented

Brand Studio has a Live Preview view with a URL field, an isolated `iframe`, loading status, and an open-in-new-tab link. The client accepts only absolute `http:`/`https:` URLs without embedded credentials. The frame uses a sandbox without `allow-same-origin`; it cannot expose the target page's DOM to the parent app. A target can refuse embedding through its own CSP or `X-Frame-Options` policy. The preview does not promise to inherit the user's OpenCode/Chrome login or cookies.

### Browser bridge contract (implemented now)

The Browser Takeover panel is a host integration point, not a running remote-control service. `apps/brand-studio/browser-bridge.mjs` defines a typed, fail-closed contract that the panel uses to talk to a host-injected bridge:

- Protocol identifier: the host bridge must declare `protocol: 'radar-browser-bridge/1'`. Any other value is rejected as an unsupported protocol.
- Capability allowlist: `read_view` and `navigate`. Requests containing anything else are rejected before the host is invoked. Arbitrary code execution, credential access, downloads/uploads, and unrestricted keyboard/mouse control are not part of this contract.
- Connect request: `{ scope: { workspace, session? }, requestedCapabilities, reason?, previewUrl? }`. These are the only fields; unknown top-level or scope keys are rejected. The page declares its workspace scope on the preview view (`data-workspace`); the trusted host, never the page, decides whether that claim is granted. When an expected workspace is known, a cross-workspace scope is rejected before host invocation.
- Connect result: `connected` is only ever reported when the host returns exactly `{ connected: true }`. Everything else the host may return (session tokens, identifiers, diagnostics) is dropped during response validation, so secret material can never reach URLs, DOM attributes, local storage, console logs, or audit metadata. A `{ connected: false, reason? }` response is surfaced as an explicit denial.
- Structured error codes: `missing_bridge`, `malformed_bridge`, `unsupported_protocol`, `invalid_request`, `invalid_scope`, `unsupported_capability`, `session_expired`, `host_adapter_unavailable`.
- Readiness: a trusted host that injects the bridge late dispatches `radar-browser-bridge-ready`. The app only re-evaluates readiness on that event; it never connects automatically.
- Resolver behaviour: a missing, malformed, protocol-incompatible, or throwing `window.RADAR_BROWSER_BRIDGE` resolves to "unavailable". The app never fabricates a connected state and never stores a session token in local storage, query parameters, the DOM, logs, or client analytics.

The takeover panel shows truthful status only: `Unavailable` (no valid bridge), `Ready for approval` (valid bridge present, no session), `Connected` (only after an explicit operator confirmation and a truthful `{ connected: true }` response), and `Disconnected` (after explicit disconnect, denial, or a failed/revoked session). The shipped markup keeps the connect button disabled until a valid bridge is present.

A trusted host must inject the following adapter into the Brand Studio top-level page, before the app initializes, and dispatch `radar-browser-bridge-ready` if it is injected later:

```js
window.RADAR_BROWSER_BRIDGE = {
  protocol: 'radar-browser-bridge/1',
  async connect({ scope, requestedCapabilities, reason, previewUrl }) {
    // Authenticate the operator, validate the scope and capabilities against
    // server-side authority, and create a short-lived, scoped browser session.
    // Return { connected: true, operatorLabel?: string } only after the
    // service confirms it; return { connected: false, reason?: string } to deny.
  },
  async disconnect() {
    // Revoke the session and close its control channel.
  }
};
window.dispatchEvent(new Event('radar-browser-bridge-ready'));
```

## What is NOT implemented

The repository intentionally contains no browser-session service, no session broker, no CDP (Chrome DevTools Protocol) broker, no remote framebuffer/WebRTC transport, no session store, no trusted host adapter, no authenticated identity binding, no host-side capability enforcement, no session expiry or revocation flow, no one-session-per-user limit, no audit event persistence, no rate limits, and no browser/container isolation boundary. The connect button does not control a browser, and no real browser action is wired. This contract slice makes the integration point explicit and fail-closed; it does not make takeover operational.

## Required before enabling a production connection button

Do not enable a production button by adding a placeholder adapter. A production bridge needs all of the following, verified independently before the button ships enabled:

- verified user/workspace identity and same-site origin + CSRF protection;
- a trusted session broker that authenticates the operator, enforces the capability allowlist server-side, and binds sessions to a verified workspace;
- short-lived session tokens held outside URLs and local storage, with expiration, revocation, and one-session-per-user limits;
- audited connect/denied/disconnect events persisted to a durable sink, with rate limits;
- a safe browser/container isolation boundary and transport (CDP or WebRTC) owned by the trusted host;
- enforcement of the contract on the host side: the page's capability and workspace claims are untrusted input and must be re-validated there.

Credentials must never be copied into preview URLs, logs, or agent prompts. Any page content exposed during a future takeover remains untrusted input; it cannot alter the router, grant tools, or approve external actions.

## Files

- `apps/brand-studio/index.html` — view and iframe markup, default-disabled takeover panel, workspace scope declaration
- `apps/brand-studio/app.js` — URL validation, load/open behaviour, truthful bridge status and explicit connect/disconnect flow
- `apps/brand-studio/browser-bridge.mjs` — fail-closed bridge contract: protocol, capability allowlist, request/result validation, resolver, readiness subscription
- `apps/brand-studio/styles.css` — responsive preview/control layout
- `tests/browser-bridge.test.mjs` — regression and negative tests for the contract and resolver
