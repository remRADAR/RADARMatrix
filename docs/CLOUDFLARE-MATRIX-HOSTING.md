# Cloudflare hosting plan for matrix.radarcharts.net

## Status

Prepared, not deployed. No DNS record, custom domain, Worker, or production configuration has been created or changed for matrix.radarcharts.net. Attaching the production hostname requires explicit owner authorization (see Owner gates).

## Why a dedicated root subdomain

The Matrix Console PWA manifest uses start URL "/?screen=halo" and scope "/", and the service worker is served at "/sw.js" for root-scope control. All asset references are root-absolute ("/assets/...", "/icons/...", "/manifest.webmanifest", "/offline.html"). A dedicated root subdomain serves every path at the origin root, so:

- the manifest scope and start URL are correct without any changes;
- the service worker controls the whole origin;
- root-absolute asset paths resolve correctly (under a subpath they would 404).

The repository Vercel root routing targets Brand Studio rather than Matrix Console, so that root must not be used as the Halo install URL. This plan gives the Matrix Console its own origin.

## Deployment shape: Cloudflare Workers static assets

- Worker name (staging-first): "matrix-radarcharts".
- Assets-only Worker: no server code, no bindings, no vars, no secrets.
- Config: apps/matrix-console/wrangler.matrix.jsonc, checked into the repository and passed explicitly with --config, so Wrangler auto-discovery is not relied on.
- assets.directory: "./dist", resolved relative to the config file.
- assets.not_found_handling: "single-page-application": any unmatched path serves the SPA index with HTTP 200, so "/halo" and direct routes work without a redirect chain.
- Wrangler version pinned to 4.157.0, the same version as the staging deploy script.

## Pre-deploy verification (unchanged gates)

npm run typecheck; npm run build:matrix-console; npm run test:matrix-console (builds production assets and runs the PWA smoke); npm run create:cloudflare-manifest. The smoke test asserts manifest start URL and scope, service-worker behavior markers, the offline fallback, icons, and the Android 7 load-path compatibility guard.

## Deploy sequence

1. Build locally with the commands above; verify dist/index.html, dist/manifest.webmanifest, dist/sw.js and dist/offline.html exist.
2. Supply CLOUDFLARE_ACCOUNT_ID and a token with Workers Scripts permission. Account IDs and tokens are supplied by the owner or operator; none are stored in this repository or in the Worker config.
3. First deploy (staging): npx --yes wrangler@4.157.0 deploy --config apps/matrix-console/wrangler.matrix.jsonc. The workers.dev preview URL on the account subdomain is served over HTTPS and supports full PWA verification, including install prompts, before any production hostname is attached.
4. Verify on the preview URL: "/" renders the Matrix Console; "/?screen=halo" renders Halo; "/halo" serves the SPA shell and routes to Halo (direct-route and SPA-fallback behavior); "/manifest.webmanifest", "/sw.js", "/offline.html", the icons and the hashed "/assets/*" files return HTTP 200; the PWA is installable in a Chromium browser.
5. Production hostname (OWNER GATED): add the custom domain matrix.radarcharts.net to the Worker. This creates or uses DNS records in the radarcharts.net zone and changes production behavior; do not do this without explicit owner authorization. If the zone lives in a different Cloudflare account, coordinate with the zone owner first.

## HTTPS and security requirements

- Cloudflare serves HTTPS automatically; a secure context is required for service workers and the Add-to-Home-Screen install prompt.
- Force HTTPS at the edge; do not serve the site over plain HTTP.
- No secrets, API keys or account tokens are stored in this repository or in the Worker config. The Worker itself is static-asset-only and runs no server code.

## Caching expectations and checks

- Hashed build assets under /assets/ are immutable per build and can be cached aggressively. The service worker additionally caches the shell and same-origin assets after first load, so releases rely on the worker cache-versioning protocol (bump CACHE_VERSION in apps/matrix-console/public/sw.js when the shell contract changes).
- After the first staging deploy, confirm the effective Cache-Control responses with curl -I. Where headers need overriding, use the static-assets _headers mechanism per current Cloudflare documentation (verify support at deploy time) so that: hashed /assets/* are long-lived immutable; /sw.js is no-cache or short max-age so updates are always fetchable; /manifest.webmanifest and /index.html are no-cache or short max-age; /offline.html and /icons/* are cacheable.
- Treat Cloudflare edge cache and purge timing as part of any release procedure.

## What this plan does NOT do

- No deployment executed for matrix.radarcharts.net; no Worker created for it. The staging deploy script (scripts/deploy-matrix-console-wrangler.sh) targets a separate staging Worker named "radarmatrix-prototype" on the remradar workers.dev subdomain, and as of the last recorded checkpoint no Worker version was deployed there either.
- No DNS change, no custom domain attach, no zone change, no account or credential change, no production traffic.

## Owner gates (unchanged)

- Attaching matrix.radarcharts.net (production hostname) requires explicit owner authorization.
- Public staging timing and URL are an owner decision.
- No merges of PR #17 or PR #19 without owner approval.
