# ADR: Cloud Source of Truth

**Status:** Proposed; owner approval required. No cloud resources or account configuration are changed by Stage 0.1.

## Evidence

- Repository architecture documents describe future Cloudflare Workers, D1, R2, and Vectorize deployment.
- `docs/DEPLOYMENT.md` records the earlier Supabase project as deleted/retired and says a replacement is pending, while the local Brand Studio still has JSON storage and an optional Supabase adapter path.
- README states that live MCP, OAuth/OIDC, database, vector, and production Cloudflare connectivity are not implemented.
- Cloudflare read-only inspection in the prior checkpoint found account `825459f1f313c6c9427bf6718bbd4907`, workers.dev subdomain `radarcharts-cache`, and existing Workers `radarsite-cache-maintenance` and `radarsite-staging`; no `radarmatrix-prototype` Worker was created.
- The Cloudflare account identity is an unresolved infrastructure dependency; intended-account confirmation is still required before any deployment.

## Responsibility candidates

| Responsibility | Current state | Candidate / recommendation |
|---|---|---|
| Static Console hosting | Prototype branch only; no staging Worker | Cloudflare static Worker or Pages after intended account and transfer path are confirmed |
| API/MCP edge | Not live | Cloudflare Worker candidate; must preserve gateway authority |
| Workspace/membership | Local JSON/dev; Supabase path pending | Choose one authoritative production store before implementation |
| Documents | Not connected | R2 candidate, subject to data model and retention decision |
| Vectors | Not connected | Vectorize candidate, subject to embedding/provider decision |
| Durable audit | Local/console today | D1 or dedicated audit store candidate; append-only and retention required |
| Auth/identity | Production provider deployment-gated | Dedicated OAuth/OIDC authority; never infer from Cloudflare hosting |
| Device sync | Not implemented | Authenticated Cloudflare edge/service plus durable store |
| Agent execution | Not implemented | Separate authorized execution service; not static hosting and not arbitrary Worker authority |
| OS release metadata | Not implemented | Signed metadata distribution; cloud does not boot the OS |
| Secrets | No production secrets in repo | Provider secret store with rotation and least privilege |

## Decision requirements

Before production cloud implementation, owner approval must resolve the authoritative workspace store, identity provider, audit store, document/vector stores, device-sync service, and migration path from the retired Supabase reference. Each service must have one owner and one source of truth.

## Guardrails

Cloudflare is a cloud control plane and hosting environment, not the bootable RADAR OS. No DNS, database, Worker, storage, identity, secret, or paid resource is created by this ADR.
