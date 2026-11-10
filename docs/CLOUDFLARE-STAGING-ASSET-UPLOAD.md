# Cloudflare staging asset upload

This runbook records the direct Cloudflare Static Assets flow for the Matrix Console. It is intentionally separate from the Worker deployment step.

## Verified inputs

- Asset source: `apps/matrix-console/dist/`
- Manifest: `apps/matrix-console/cloudflare-assets-manifest.json`
- Worker name: `radarmatrix-prototype`
- Account ID: `f3ea4523accdd48e8469707368b39799`
- workers.dev subdomain: `remradar`

## Correct API sequence

1. Register the manifest:

   `POST /accounts/{account_id}/workers/scripts/{script_name}/assets-upload-session`

   Body: `{ "manifest": { "/path": { "hash": "<32 hex>", "size": <bytes> } } }`

   The response contains an upload JWT and `buckets`. If `buckets` is empty, the returned JWT is already the completion JWT.

2. Upload only the hashes listed in each bucket:

   `POST /accounts/{account_id}/workers/assets/upload?base64=true`

   Authenticate with the short-lived upload JWT. Each multipart field name is the hash, each value is the base64-encoded raw file bytes, and each part carries the file MIME type.

3. Deploy a Worker version:

   `PUT /accounts/{account_id}/workers/scripts/{script_name}`

   Use multipart metadata with `main_module`, an `assets` binding named `ASSETS`, and `assets.jwt` set to the completion JWT. The Worker module should delegate requests to `env.ASSETS.fetch(request)`.

## Hash rule

The manifest uses Cloudflare's documented reference algorithm:

`sha256(base64(file_bytes) + file_extension).hexdigest().slice(0, 32)`

Paths use forward slashes and begin with `/`. Sizes are raw byte counts, not base64 lengths.

## Previous failure diagnosis

The earlier upload attempted to attach an `assets` binding directly in the one-step script upload. Cloudflare rejected it with error `10305: Cannot use an assets binding without assets.` That endpoint does not replace the upload-session flow: the asset completion JWT must be obtained first.

The temporary CDN and GitHub/CDN URLs were also rejected by the Cloudflare connector's outbound fetch policy, so asset bytes must be sent through the hash-keyed base64 upload endpoint rather than fetched by the connector runtime.


## Connected-account verification (2026-11-05)

The active Cloudflare connector is account `f3ea4523accdd48e8469707368b39799` with workers.dev subdomain `remradar`. The verified build passed `typecheck`, production build, Matrix Console smoke tests, deterministic manifest regeneration, and `git diff --check`. Manifest registration succeeded and returned three upload buckets; no asset bytes were uploaded and no Worker version was deployed in this checkpoint.

## Local Wrangler deployment

The repository includes `scripts/deploy-matrix-console-wrangler.sh`. It rebuilds and smoke-tests the console, regenerates the manifest, creates a temporary asset-serving Worker entrypoint, and invokes Wrangler with the connected account. It does not add a persistent Wrangler config or attach routes, domains, variables, or secrets.

```bash
export CLOUDFLARE_API_TOKEN='…'
export CLOUDFLARE_ACCOUNT_ID='f3ea4523accdd48e8469707368b39799'

# Compile and validate only; no upload.
WRANGLER_DRY_RUN=1 npm run deploy:matrix-console:wrangler

# Build and deploy to the connected account.
npm run deploy:matrix-console:wrangler
```

`CLOUDFLARE_WORKER_NAME`, `CLOUDFLARE_COMPATIBILITY_DATE`, and `WRANGLER_VERSION` may be overridden. The default Worker name is `radarmatrix-prototype`, and the default Wrangler version is `4.157.0`.

## GitHub Actions CI/CD

`.github/workflows/deploy-staging.yml` deploys on every push to the `staging` branch. It uses the `staging` GitHub Environment and runs the same `npm run deploy:matrix-console:wrangler` script used locally.

Configure the following in the repository's **Settings → Environments → staging**:

- Secret: `CLOUDFLARE_API_TOKEN` with the minimum Workers deployment permissions required by Wrangler.
- Variable: `CLOUDFLARE_ACCOUNT_ID` set to `f3ea4523accdd48e8469707368b39799`.
- Optional variable: `CLOUDFLARE_WORKER_NAME`, defaulting to `radarmatrix-prototype`.

The workflow has `contents: read` permission, serializes staging deployments with a concurrency group, and does not configure routes, domains, secrets, or persistent Wrangler configuration.
