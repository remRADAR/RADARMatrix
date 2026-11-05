#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy the verified Matrix Console build as a static-assets Worker through Wrangler.
# This script intentionally creates no persistent Wrangler config, routes, domains,
# bindings, variables, or secrets. It uses only CLOUDFLARE_API_TOKEN and the account
# selected by CLOUDFLARE_ACCOUNT_ID.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/apps/matrix-console/dist"
WORKER_NAME="${CLOUDFLARE_WORKER_NAME:-radarmatrix-prototype}"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-f3ea4523accdd48e8469707368b39799}"
COMPATIBILITY_DATE="${CLOUDFLARE_COMPATIBILITY_DATE:-$(date -u +%F)}"
WRANGLER_VERSION="${WRANGLER_VERSION:-4.157.0}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/radarmatrix-wrangler.XXXXXX")"
WORKER_ENTRY="$TMP_DIR/worker.js"
WRANGLER_CONFIG="$TMP_DIR/wrangler.toml"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "node is required"
command -v npm >/dev/null 2>&1 || fail "npm is required"
[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || fail "CLOUDFLARE_API_TOKEN is not set"
[[ "$ACCOUNT_ID" =~ ^[a-f0-9]{32}$ ]] || fail "CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID"

cd "$ROOT_DIR"

echo "==> Building Matrix Console"
npm run typecheck
npm run build:matrix-console
npm run test:matrix-console
npm run create:cloudflare-manifest

[[ -f "$DIST_DIR/index.html" ]] || fail "missing $DIST_DIR/index.html"
[[ -f "$DIST_DIR/manus-routes.json" ]] || fail "missing $DIST_DIR/manus-routes.json"
find "$DIST_DIR" -type f -print -quit | grep -q . || fail "asset directory is empty"

cat > "$WORKER_ENTRY" <<'EOF'
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
EOF

# The config is temporary and contains no routes, domains, vars, secrets, or
# persistent assets settings. Wrangler receives the build directory explicitly.
cat > "$WRANGLER_CONFIG" <<EOF
name = "$WORKER_NAME"
account_id = "$ACCOUNT_ID"
compatibility_date = "$COMPATIBILITY_DATE"

[assets]
directory = "$DIST_DIR"
binding = "ASSETS"
EOF

echo "==> Wrangler $(npx --yes "wrangler@$WRANGLER_VERSION" --version | head -1)"
echo "==> Deploying $WORKER_NAME to account $ACCOUNT_ID"

WRANGLER_ARGS=(
  deploy "$WORKER_ENTRY"
  --config "$WRANGLER_CONFIG"
  --compatibility-date "$COMPATIBILITY_DATE"
  --name "$WORKER_NAME"
  --strict
  --no-bundle
  --message "Matrix Console staging $(git rev-parse --short HEAD 2>/dev/null || echo local)"
)

if [[ "${WRANGLER_DRY_RUN:-0}" == "1" ]]; then
  WRANGLER_ARGS+=(--dry-run)
  echo "==> Dry run enabled; no Cloudflare upload will occur"
fi

npx --yes "wrangler@$WRANGLER_VERSION" "${WRANGLER_ARGS[@]}"

echo "==> Deployment complete"
echo "Worker: $WORKER_NAME"
echo "Account: $ACCOUNT_ID"
echo "Build: $DIST_DIR"
echo "Expected workers.dev URL depends on the account subdomain; inspect Wrangler output above."
