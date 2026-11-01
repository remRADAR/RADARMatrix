# @radarmatrix/contracts

Provider, storage, runtime, and agent adapter contracts for RADARMatrix. **M1a deliverable (2026-11-01).**

These interfaces are the stable seams between Matrix Core and its providers. They are **type-only** today: no runtime code in this package executes yet, and nothing is simulated. Production implementations must satisfy these contracts **without weakening the gateway's fail-closed security model**.

## Contract law (binding)

1. Fail closed: absence of evidence is denial of access.
2. Unknown principals never receive implicit access.
3. Membership is an explicit map — no wildcard or fallback membership.
4. Authentication (identity), membership (workspace access), and authorization (tool-level RBAC) stay separate concerns.
5. Audit events are generated for every write operation, success or not.
6. Adapters report honest status. Never simulate capabilities.

## Interfaces and current status

| Interface | Mirrors | Status |
|---|---|---|
| AuthenticationProvider | providers/authentication.cjs (development fixture: 4-principal allowlist) | implemented (dev); production OAuth/OIDC provider **planned** |
| MembershipProvider | providers/membership.cjs (explicit dev map, fail-closed) | implemented (dev); durable membership repository **planned** |
| AuthorizationProvider | providers/authorization.cjs (RBAC hierarchy viewer=1..admin=4) | **implemented** |
| AuditSink | console-only audit in mcp-gateway.ts | **interface only**; durable append-only sink **planned** (console audit remains the dev boundary) |
| StorageAdapter | runtime/workspace-store.mjs (JSON) as reference shape | **interface only**; Cloudflare D1 adapter **planned at M7** — no database created |
| RuntimeAdapter | none | **interface only**; github-readonly adapter **planned at M3** — currently **unavailable**; no runtime execution exists anywhere (routing is plan-only) |
| AgentAdapter | runtime/agent-routing.cjs (plan-only router) | **interface only**; execution adapters **planned** |
| RateLimiter | none | **planned** |

Statuses follow the implemented / connected / simulated / planned / unavailable vocabulary. Nothing in this package claims a capability that does not exist.

## Verification status

These contracts have **not** been type-checked: no TypeScript compiler step exists in CI yet (zero-budget toolchain decision, M2). The interfaces are exercised indirectly at runtime through the gateway imports via Node type stripping. Do not treat them as compiler-verified.
