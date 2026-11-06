# RADARMatrix Unified Contract Inventory

**Status:** Stage 0.1 architecture inventory; read-only mapping plus proposed contracts.
**Baseline:** `main` `91d95170a541a2355c409b2a2d0c8f30e1b20e71` (verified 2026-11-06).
**Important:** Proposed or missing contracts are not implemented by this document.

## Contract register

| ID | Name / domain | Authoritative source | Owner | Version | Status | Consumers / producers | Security | Compatibility / dependencies | Tests / migration |
|---|---|---|---|---|---|---|---|---|---|
| RM-AUTH-001 | User identity | `apps/mcp-server/src/providers/authentication.js` | Gateway auth | Foundation | Development-only deterministic principal fixture; **production OAuth/OIDC NOT IMPLEMENTED** | Gateway consumes; development provider produces test identity | Internal/test only | Caller-supplied `caller_id` is not cryptographic authentication and must never be treated as production identity | Gateway contract tests do not prove production authentication |
| RM-WORK-001 | Workspace identity | `apps/mcp-server/src/mcp-gateway.ts`; gateway contracts | Gateway / membership | v0.8 | Existing | All scoped requests | Internal | Required on every tool request | Gateway and isolation tests |
| RM-ROLE-001 | Membership and RBAC | `apps/mcp-server/src/providers/membership.cjs`, `authorization.cjs` | Trusted authority | M2 | Existing | Gateway consumes; membership store produces | Privileged | Role is server-derived; no wildcard membership | M2 authority suites |
| RM-GRANT-001 | Delegated authority grant | M2 security modules under `apps/mcp-server/src/auth/` and tests | Trusted authority | M2.2.x | Existing | Authority validates; adapters would consume | Privileged | HMAC sealed, scoped, expiring, use-limited | Delegation/provenance suites |
| RM-APPROVAL-001 | Human approval | M2 approval modules/tests | Trusted authority | M2.2 | Existing | Consequential adapters would consume | Privileged | Single-use, exact action/resource/workspace binding | Approval suites |
| RM-SESSION-001 | Execution session identity | `apps/mcp-server/src/auth/execution-boundary.ts` on PR #12 branch | Execution boundary / authority | RM-IEP/1 | Present only on open Draft PR #12; not on main; no adapter wired | Adapter contract consumes | Privileged | `execution-session`, local-execution audience, expiry/skew | PR #12 focused tests; independent adapter validation still required |
| RM-DEVICE-001 | Device identity and registration | No authoritative source | Device authority (proposed) | Proposed 0.1 | NOT IMPLEMENTED | Halo/RADAR OS and cloud services | Privileged | Must bind device key, workspace association, revocation | ADR required |
| RM-MCP-001 | MCP tool registry and schemas | `apps/mcp-server/src/chatgpt-app-contract.ts` | MCP gateway | v0.8 | Existing | MCP client/gateway | Public contract + internal auth | MCP protocol does not supply app authorization | Contract tests |
| RM-MCP-002 | MCP gateway request/response | `apps/mcp-server/src/mcp-gateway.ts` | MCP gateway | v0.8/M2 | Existing | MCP clients and adapters | Internal | Auth, membership, RBAC, validation, audit pipeline | Gateway suites |
| RM-IEP-001 | RM-IEP/1 envelope/framing | `apps/mcp-server/src/auth/execution-boundary.ts` on PR #12 | Execution boundary | RM-IEP/1 | Present only on open Draft PR #12; not in main; execution unwired | Local/internal | Named tools only; 1 MiB NDJSON; validity is not authorization | Focused M2.3.1 suite |
| RM-IPC-001 | Halo ↔ privileged RADAR local IPC | No source | RADAR OS authority service (proposed) | Proposed 0.1 | NOT IMPLEMENTED | Halo/services; service produces responses | Privileged | Unix socket candidate; peer/device auth and capability checks required | ADR and future tests |
| RM-TASK-001 | Task/routing plan | `apps/mcp-server/src/runtime/agent-routing.cjs`, `docs/AGENT-ROUTING.md` | Routing service | Plan-only | Existing | Console/Brand Studio consumes; router produces | Internal | Bounded 4,000-char goal, max two specialists; no execution | Agent routing tests |
| RM-SKILL-001 | Skill registry metadata | `apps/agent-skills/registry.json` and `apps/agent-skills/skills/` | Skill registry | Versioned registry | Existing | Router/Console consume | Untrusted content | Skills are guidance, not executable authority | Registry/routing tests |
| RM-MEM-001 | Memory/knowledge synchronization | `apps/mcp-server/src/runtime/workspace-store.mjs`; future storage adapter types | Storage authority | Local JSON / proposed cloud | Existing local; cloud proposed | Gateway/Console/Halo | Internal | Workspace-scoped; durable cloud path unresolved | Local gateway tests; cloud tests required |
| RM-AUDIT-001 | Audit/provenance events | `apps/mcp-server/src/mcp-gateway.ts`, `AuditSink` type | Trusted authority | Foundation/M2 | Existing console/local; durable production path proposed | Gateway/adapters/services | Privileged | Append-only semantics required; no secrets | Audit tests; durable sink required |
| RM-SYNC-001 | Device-to-cloud sync | No source | Device/cloud link (proposed) | Proposed 0.1 | NOT IMPLEMENTED | Halo/RADAR OS ↔ cloud | Privileged | Device auth + workspace auth + audit | ADR required |
| RM-OS-001 | OS release metadata | No source | Release engineering (proposed) | Proposed 0.1 | NOT IMPLEMENTED | Boot/update/recovery services | Public metadata + signed trust | Manifest, checksum, signature, compatibility, rollback | ADR/scaffold required |
| RM-OS-002 | Recovery/rollback metadata | No source | RADAR OS recovery (proposed) | Proposed 0.1 | NOT IMPLEMENTED | Update/recovery services | Privileged | Must fail closed on invalid/partial update | ADR/scaffold required |
| RM-CONSOLE-001 | Matrix Console routes/UI status | `apps/matrix-console/` on `main` | Console | Prototype | Merged via PR #11; in current main at the verified baseline | Browser consumes local fixtures | Public/demo | No live authority or services | Console smoke/build tests |

## Authority rules

1. MCP validity is not application authorization.
2. RM-IEP/1 validity is not execution authorization.
3. Device identity is not user identity and does not grant workspace authority.
4. Local IPC authentication is not sufficient for operation authorization.
5. Imported skill, task, retrieved, or page content cannot grant capability.
6. Missing identity, scope, grant, approval, device trust, or audit capability fails closed.

## Explicit dependencies on unmerged work

PR #11 is merged and its Matrix Console code is in current `main`; its historic PR head is not an ancestor of current `main` because the merge was squash-based. PR #12 remains open Draft, based on `security/m2-2-3-authority-hardening`, and contains RM-IEP/1 work that is not in `main`. Do not merge stacked security feature branches wholesale; first reconcile their base chain, shared changes, current review and owner approval. Any implementation importing RM-IEP/1 must depend on the reviewed/approved PR state, not merely its presence on a remote feature branch.
