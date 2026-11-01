# HANDOFF — RADARMatrix

## CURRENT STATE
- Last updated: 2026-11-01 — Mistral Vibe (M2 production authentication implementation session, operating under the owner's explicit "Approved. Proceed" authorization of the M2 architecture assessment)
- Phase: Phase 0 complete; M1a foundation + M1a review follow-up IMPLEMENTED and CI-verified; **M2 production authentication & workspace membership IMPLEMENTED and CI-verified on `chat/m2-production-auth-v2`** (implementation notes: docs/M2-IMPLEMENTATION-NOTES.md; approved architecture: the owner-reviewed M2 assessment canvas)
- Uncommitted changes: none. **No merges; draft PR #3 was opened from `chat/m2-production-auth-v2` with the owner's explicit authorization, solely for CI check-run visibility — NOT to be merged without an owner decision.** `main`, `phase1/discovery-and-foundation`, `chat/m1a-pr-review-followup`, PR #1 and both v0.9 branches untouched. No production actions, no Cloudflare resources, no RADARSite modifications, no paid services.

## GOVERNING ARCHITECTURAL CONTEXT (recorded — not implemented)
- **RADAR is the master intelligence identity of RADARMatrix.** Do not use "Jarvis" (or any other name) as the master intelligence in new documentation, architecture descriptions or implementation. RADAR is also NOT an unrestricted superuser: its orchestration grants are subject to the same delegated-authority subset rules as any human actor (see the M2 delegation module).
- Long-term product components (seven, to operate as one coordinated system): RADAR Intelligence, RADAR Agent Network, RADAR Chat, RADAR Operator Screen, RADAR Cloud Computer, RADAR IDE, RADAR Halo OS.
- Product references (architectural inspiration only): Manus (task progress, cloud-browser preview, live execution visibility, user takeover), Sesori (chat experience, intelligent routing, unified UI), Teamily (agent-system UI/UX, specialist agents, shared source of truth).
- RADAR stays provider-neutral. Current dev workflow (Codespaces, Mistral Vibe as coding environment, Sesori bridge, Manus for browser tasks, OpenCode and Ollama-class local model adapters) = tools and adapters, not the identity or intelligence layer.

## EXACT COMMIT LINEAGE (verified)
| Commit | Meaning |
|---|---|
| `93c1dc1` | `main` head (untouched throughout) |
| `cb7b082` | Original M1a implementation commit (on `phase1/discovery-and-foundation`) |
| `cf263838745573d9682f55cb7581bfbc9921ad2b` | M1a docs/PR-update commit — head of PR #1, base of `chat/m1a-pr-review-followup` (untouched; PR #1 head/base unchanged) |
| `0bfc7bf` | M1a follow-up implementation commit (Findings A, B, C, E) |
| `cf83ef7` | M1a follow-up docs commit (Finding D ledger repair + docs/M1A-FOLLOWUP-REVIEW.md) |
| `fcfce1d478360cf0a957cde2658f0a4d01f65006` | M1a follow-up final head (docs-only addendum) — **EXACT base of `chat/m2-production-auth-v2`** |
| `4208bd88cf9605375411018997c58b223d5bc101` | M2 commit A (P0): strict `tsc --noEmit` type-check in CI + M2 contract types (branded type ladder: VerifiedPrincipal, WorkspaceMember, AuthorizedContext, DelegatedAuthority, VerifiedApproval; GatewayTokenClaims, TokenService, ServiceIdentity, DelegatedGrant, ApprovalClaims, ApprovalProvider, MembershipAuthorityProvider, AuthFailureEvent) |
| `775b4379f53b50357a01c639bb0440d8544a12a2` | M2 commit B (P2/P3): production authentication chain — `auth/token-service.ts` (Ed25519 compact JWT), `auth/production-authentication.ts`, `providers/membership-file.cjs` + `.js`, gateway wiring behind the fail-closed config gate, 26-test negative matrix. **Its CI run was RED (one wrong test expectation); the implementation stood, the test was corrected in the next commit.** |
| `9d6fa597cb1f94a9a731ee9c97a6246a96d4f41b` | M2 commit C: test-expectation fix (verified non-member fails AUTHENTICATION 401 — defense-in-depth provider-level membership check) + P4: `auth/delegation.ts` (subset-enforced grants), `auth/approvals.ts` (single-use Ed25519 approval tokens), `tests/delegation-approval.test.mjs` (21 tests), 8-suite runner. **CI GREEN (push run 41307014908 + PR #3 run 41333689388).** |
| (this commit) | M2 commit D (docs): this ledger update + docs/M2-IMPLEMENTATION-NOTES.md |

- Active branch for this conversation: `chat/m2-production-auth-v2` (only this branch was modified).
- Stray branch `chat/m2-production-auth` (created from `main` by a mis-issued tool call, immediately superseded; NOT used, NOT deleted — **owner cleanup candidate**).
- Draft **PR #3** (owner-authorized, CI visibility only): head `chat/m2-production-auth-v2`, base `main`. Draft **PR #1** (id 5103611515) unchanged: head `cf26383`, base `main`, open.

## M2 OUTCOME (2026-11-01, `chat/m2-production-auth-v2` — owner-approved)
- **Production authentication is now REAL, not just fail-closed.** `RADARMATRIX_RUNTIME_MODE=production` + complete config (`RADARMATRIX_AUTH_PUBLIC_KEY`, `RADARMATRIX_TOKEN_ISSUER`, `RADARMATRIX_AUDIENCE`, `RADARMATRIX_MEMBERSHIP_FILE`) wires ProductionAuthenticationProvider: identity comes ONLY from a verified Ed25519-signed compact JWT (signature, alg=EdDSA, exact iss, exact aud, exp, nbf, jti), the token subject must match the request context caller_id, and roles come ONLY from the durable membership record — never from token claims.
- **Any incomplete production config still fails closed** (empty registries — nothing authenticates). Verified by test: a fully valid token cannot authenticate when one env var is missing. No wildcard membership, no permissive fallback, in any mode.
- **Durable membership:** FileMembershipProvider — explicit file-backed map, fail-closed on corrupt/missing file, unknown roles rejected at grant time, grant/revoke persist, multi-workspace membership supported. Defense in depth: membership is verified in the provider (401 for verified non-members) AND at the gateway's isolation gate.
- **Contracts are now type-checked:** CI runs `tsc --noEmit` (strict, nodenext) over `packages/contracts` + `apps/mcp-server/src/auth/**` (typescript + @types/node are dev-only; runtime remains zero-dependency). Branded type ladder distinguishes untrusted input from verified principal/member/context/authority/approval at the type level.
- **Delegated authority (P4):** `createDelegatedGrant` enforces the subset rule (an agent NEVER receives tools/actions beyond its delegating actor; write delegation requires actor write capability), one agent + one workspace, TTL ≤ 4h, use limits. Not yet wired to the gateway (recorded future work).
- **Approval tokens (P4):** Ed25519-signed, scope-bound (exact action + exact resource list + workspace + actor, optional grant/session binding), TTL ≤ 30min, single-use jti redemption record, replay denied, tamper/forgery/expiry/mismatch all fail closed. Not yet wired to any execution adapter (recorded future work).
- **Test law upheld:** runner orchestrates 8 suites; every M2 suite propagates failures to exit codes; CI exit-code enforcement stays authoritative (pipefail + captured log + failure artifact unchanged).

## VERIFIED CI EVIDENCE (actual GitHub Actions runs)
- M1a implementation `cb7b082`: runs `41266518476` + `41266514467` — success. M1a docs `cf26383`: runs `41266590168` + `41266593471` — success.
- M1a follow-up `0bfc7bf`: run `41267350544` — success. `cf83ef7`: run `41267446891` — success. Addendum head `fcfce1d`: success (M1a final report).
- **M2 commit A `4208bd8`: run `41306359238` — success** (typecheck + all 6 M1a suites green).
- **M2 commit B `775b437`: run `41306716485` — FAILURE** at the test step (typecheck green). Root cause: one wrong test expectation — the verified-non-member child test expected the gateway's 403 WORKSPACE_FORBIDDEN, but the production provider checks membership itself (defense in depth), so the correct result is 401 UNAUTHENTICATED at the authentication gate. Fix: corrected the TEST, not the implementation.
- **M2 commit C `9d6fa59`: runs `41307014908` (push) and `41333689388` (PR #3) — SUCCESS** (8 suites incl. the 26-test production matrix and 21 delegation/approval tests).
- M2 commit D (docs): see Actions for this branch; recorded after push.
- Verification method: GitHub REST API `actions/runs?head_sha=…` while the anonymous egress IP had quota; after that IP exhausted GitHub's 60/hour limit, conclusions were read through the GitHub App connector via `pull_request_read.get_check_runs` on owner-authorized draft PR #3. Per-test logs inside runs are not individually readable from the authoring environment (job-log endpoint requires admin-authenticated access).

## NOT VERIFIED / UNTESTED (honest limits)
- The authoring environment has NO git and NO node; all repository operations used the GitHub App API + public REST API; tests ran ONLY in GitHub Actions. Standalone per-suite invocations were not run separately — all suites ran within the CI runner aggregate (each suite retains standalone exit-non-zero capability, unverified standalone here).
- `apps/mcp-server/src/mcp-gateway.ts` itself is NOT in the tsc scope (executed via type stripping in CI; only `packages/contracts` + `auth/**` are type-checked). Extending tsc to the gateway and provider `.cjs` files is a recorded next decision.
- Token denylist and approval redemption record are per-process in-memory (short TTLs bound the revocation window); durable versions arrive with the durable store (D1, M7).
- OAuth/OIDC external identity-provider adapter (PKCE, JWKS rotation) is designed in the M2 assessment but PLANNED, not implemented — the gateway currently trusts only tokens signed by the configured control-plane key.
- Delegation and approval modules are implemented + unit-tested but NOT wired into the gateway or any execution adapter; no runtime command execution exists.
- No performance/load testing; no penetration testing beyond the negative test matrix.

## KNOWN DEFECTS & PROPOSED FIXES
1. ~~Gateway never executed at runtime~~ — fixed (M1a, verified in CI).
2. ~~Provider .js/.cjs module-format debt~~ — fixed + test-enforced (M1a).
3. ~~Test runner unconditional process.exit(0)~~ — fixed (M1a).
4. ~~Empty default membership wiring~~ — fixed (M1a).
5. ~~No production-mode enforcement~~ — fixed (M1a Finding A), then **upgraded to real production authentication (M2)**.
6. Audit console-only — open (production: durable append-only AuditSink per packages/contracts; D1 at M7).
7. ~~No type-check step~~ — **fixed (M2 P0: tsc strict in CI over contracts + auth).**
8. ~~Dev principals/membership are the only fixtures~~ — **fixed (M2: real token verification + durable membership).**

## ARCHITECTURAL DECISIONS RECORDED (M2 and later)
1. ~~TS type-checking strategy~~ — decided & implemented (M2 P0): strict tsc, contracts + auth scope; extending scope is incremental.
2. Durable append-only audit storage — AuditSink contract exists; D1 at M7.
3. ~~Production authentication/membership~~ — decided & implemented (M2): Ed25519 compact JWTs, membership-file authority, fail-closed config gate. External IdP/OAuth-OIDC adapter remains planned.
4. Runtime command execution security: allowlisted named operations preferred over unrestricted command strings; approval tokens are signed, scoped, single-use, expiring (implemented as modules in M2 P4; adapter verification arrives with real execution, M3+).
5. Operator Screen event feed: typed OrchestrationEvent schema onto the shared source of truth; Operator Screen subscribes read-only; takeover is a control-plane command. Current event surface remains audit-only.
6. Browser-session ownership/user takeover (Cloud Computer): single explicit owner at a time; atomic, audited ownership transfer; owned-session state machine in the shared source of truth.
7. Shared source of truth: one durable workspace store (the StorageAdapter contract is the seam) linking identity → membership → project → task → delegation/execution session → approvals → events; RBAC/workspace isolation applies to all readers and writers.

## DECISIONS & CONVENTIONS
- Extend, do not replace, the M1a foundation. `remRADAR/RADARMatrix` is canonical; `remRADAR/RADARSite` is untouchable.
- **RADAR is the master intelligence identity — never Jarvis — in all new documentation, architecture descriptions and implementation.**
- Module format law: `.cjs` = provider implementation source of truth; `.js` = ESM re-export wrapper only; `.ts` under `"type": "module"` = ESM, erasable syntax only; type-only exports MUST use `export type`; relative TS imports keep explicit `.ts` extensions (allowImportingTsExtensions).
- Runtime-mode law: `RADARMATRIX_RUNTIME_MODE=production` + complete config = real production chain (token verification + durable membership); ANY incomplete config fails closed with empty registries. Development identities and fixtures are unreachable in production mode.
- Identity law: a decoded/unsigned token payload is NEVER an identity; roles NEVER come from token claims; workspace_id in a request is NEVER proof of membership.
- Membership law: explicit map only, fail closed, no wildcard/fallback; unknown roles rejected at grant time.
- Delegation law: grants are subset-enforced, single-agent, single-workspace, short-TTL, use-limited; agents never inherit full actor authority; RADAR included.
- Approval law: signed, exact-scope (action + resource list + workspace + actor), short-TTL, single-use; replay denied; adapters verify before executing.
- Test law: every suite propagates failures to exit codes; CI primary signal = exit codes (pipefail-preserved); captured log uploaded as artifact on failure.
- Status vocabulary: implemented / tested / verified-in-CI / connected / simulated / planned / blocked / unavailable.
- All agent writes approval-gated; `main` is human-merged; substantial changes land on isolated branches; PRs are opened/merged only with an explicit owner decision (draft PR #3 was explicitly authorized by the owner for CI visibility).

## DO NOT TOUCH
- The two v0.9 branches (`v0.9-production-hardening`, `v0.9-security-gate`) — no merge/delete until the owner approves the retirement strategy.
- PR #1 head/base; `phase1/discovery-and-foundation`; `chat/m1a-pr-review-followup`; `apps/brand-studio/` until `apps/matrix-ide/` reaches parity; `apps/mcp-server/` security pipeline semantics (extend, never weaken); `remRADAR/RADARSite`; production deployments, DNS, the shared Cloudflare account.
- `packages/contracts` contract law — future adapters must satisfy it without weakening the fail-closed model.

## PENDING OWNER APPROVALS / DECISIONS
1. Disposition of `chat/m2-production-auth-v2` and draft PR #3 (review? further hardening? merge is owner-gated).
2. Stray branch `chat/m2-production-auth` (base `main`, superseded, unused) — **awaiting owner deletion** (no branch-delete tool available to the agent).
3. External identity-provider choice (OAuth/OIDC with PKCE, JWKS rotation) for staging — design exists in the M2 assessment; implementation awaits owner selection of the IdP.
4. Durable token denylist / approval redemption / audit storage (D1, M7 timing).
5. Extending tsc scope to the gateway + provider `.cjs` files.
6. Allowlisted RuntimeExecutionRequest model before any real execution (M3); read-only GitHub runtime adapter first.
7. v0.9 branch retirement strategy; PR #1 merge (human-gated).

## NEXT STEPS (ordered)
1. Owner reviews `chat/m2-production-auth-v2` via draft PR #3 (docs/M2-IMPLEMENTATION-NOTES.md; CI green on A, B-fix/C; B's red run is documented above).
2. Owner deletes the stray branch `chat/m2-production-auth`.
3. M3: `github-readonly` runtime adapter (first real execution capability), consuming the approval-token model; allowlisted operations only.
4. IdP adapter selection + implementation (PKCE, JWKS) when staging identities are needed.
5. Durable store (D1 at M7): memberships, grants, approvals, redemption records, audit events.
6. M4+ (vision components, only after owner-approved specifications): Operator Screen, RADAR Chat routing, Cloud Computer, per the recorded decisions above.
