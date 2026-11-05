# Cloudflare staging asset upload

This runbook records the direct Cloudflare Static Assets flow for the Matrix Console. It is intentionally separate from the Worker deployment step.

## Verified inputs

- Asset source: `apps/matrix-console/dist/`
- Manifest: `apps/matrix-console/cloudflare-assets-manifest.json`
- Worker name: `radarmatrix-prototype`
- Account ID: `825459f1f313c6c9427bf6718bbd4907`
- workers.dev subdomain: `radarcharts-cache`

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
