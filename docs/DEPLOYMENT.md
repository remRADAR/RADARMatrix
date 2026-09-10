# RADARMatrix Deployment Readiness

## Current state

RADARMatrix previously used a separate Supabase project for durable workspace storage. That NairaLeap-hosted project has now been intentionally deleted; the migration below remains the source of truth for the replacement remRADAR project:

| Property | Value |
|---|---|
| Project | RADARMatrix |
| Project ref | **Retired; do not reuse** (`xtwrbgfdrlkqddszfwpt`) |
| Region | `eu-west-1` |
| Status at setup | `DELETED; replacement pending` |
| Project-creation quote | `$0.00/month` at setup time |

The first workspace migration is stored at `supabase/migrations/001_radarmatrix_workspace.sql`. It creates RLS-enabled tables for workspaces, memberships, brand assets, content, community items, safety state, rate events, and audit events. It seeds only the development workspace `w_dev` and development callers used by the local test runtime.

## Local runtime

The local Brand Studio still uses the atomic JSON `WorkspaceStore` by default so development remains dependency-free:

```bash
npm run brand:dev
```

The local data path can be changed with `RADARMATRIX_DATA_FILE`. The `.data/` directory is ignored by Git.

## Production runtime requirements

The production deployment must replace the development caller fixture with verified Supabase Auth or another OAuth/OIDC provider. It must use server-side Supabase credentials for database writes, keep the service-role key out of browser code, enforce workspace membership in the database, and keep Instagram mutations paused until connector permissions, webhook signatures, rate governance, consent, and emergency-stop monitoring are verified.

Required deployment environment variables are expected to be:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY   # server-side only; never expose to the browser
```

No live Instagram credentials, service-role key, or production OAuth secret is stored in this repository. The Vercel deployment should remain protected until these environment variables, authentication flows, and server-side storage adapter are configured and tested.

## Deployment sequence

1. Configure Supabase Auth and map authenticated users to `workspace_members`.
2. Implement the server-side Supabase repository behind the existing `BrandGateway` interface.
3. Add signed webhook ingestion and durable event processing.
4. Configure Vercel environment variables in the protected project environment.
5. Deploy a protected preview and verify login, persistence, audit records, mobile layouts, and emergency-stop behavior.
6. Keep Instagram in observe-only mode until all safety gates pass.
7. Enable approval-gated mutations only after a human operator has reviewed the live deployment.
