# Live Preview and Browser Control

## What is implemented

Brand Studio has a Live Preview view with a URL field, an isolated `iframe`, loading status, and an open-in-new-tab link. The client accepts only absolute `http:`/`https:` URLs without embedded credentials. The frame uses a sandbox without `allow-same-origin`; it cannot expose the target page's DOM to the parent app. A target can refuse embedding through its own CSP or `X-Frame-Options` policy. The preview does not promise to inherit the user's OpenCode/Chrome login or cookies.

The Browser Takeover panel is a host integration point, not a running remote-control service. Its button remains disabled by default. The app never fakes connection state. A trusted host must inject the following adapter into the Brand Studio top-level page, before the app initializes, and dispatch `radar-browser-bridge-ready` if it is injected later:

```js
window.RADAR_BROWSER_BRIDGE = {
  async connect({ previewUrl, requestedCapabilities }) {
    // Authenticate the operator and create a short-lived, scoped browser session.
    // Return { connected: true, operatorLabel?: string } only after the service confirms it.
  },
  async disconnect() {
    // Revoke the session and close its control channel.
  }
};
window.dispatchEvent(new Event('radar-browser-bridge-ready'));
```

The operator must click Take over and confirm the target URL before `connect` is called. The UI requests `viewport`, `mouse`, and `keyboard` capabilities. A provider may grant a narrower set or reject the request; the UI accepts connected status only when the provider returns `{ connected: true }`. The operator can return control via `disconnect`.

## Required before enabling in a deployment

The repository currently contains no browser-session service, Chrome DevTools Protocol broker, remote framebuffer/WebRTC transport, session store, or host-injected adapter. Therefore takeover cannot yet control a browser. Do not enable a production button by adding a placeholder adapter.

A production bridge needs verified user/workspace identity, same-site origin and CSRF protection, explicit capability allowlists, a short-lived session token held outside URLs/local storage, session expiration and revocation, one-session-per-user limits, audited connect/disconnect events, rate limits, and a safe browser/container isolation boundary. Credentials must never be copied into preview URLs, logs, or agent prompts. Any page content exposed during a future takeover remains untrusted input; it cannot alter the router, grant tools, or approve external actions.

## Files

- `apps/brand-studio/index.html` — view and iframe markup
- `apps/brand-studio/app.js` — URL validation, load/open behavior, optional bridge contract
- `apps/brand-studio/styles.css` — responsive preview/control layout
