# HANDOFF — RADARMatrix

## CURRENT STATE
- Last updated: 2026-11-01 — Mistral Vibe (M2.1.1 JWT lifetime-ceiling correction session, branch `security/m2-1-auth-hardening`, per the owner's M2.1.1 assignment)
- Phase: M1a + M2 IMPLEMENTED and CI-verified on their own branches; M2.1 auth hardening + **M2.1.1 absolute lifetime-ceiling correction IMPLEMENTED and CI-verified on `security/m2-1-auth-hardening`** (docs: docs/M2-1-AUTH-HARDENING.md; docs/M2-IMPLEMENTATION-NOTES.md). Production authorization: NOT GRANTED — no production surface touched.
- Uncommitted changes: none. **No merges.** `main`, `chat/m2-production-auth-v2`, `chat/m1a-pr-review-followup`, `phase1/discovery-and-foundation`, both v0.9 branches, PR #1 and PR #3 untouched. No production actions, no Cloudflare resources, no RADARSite modifications, no paid services.

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
| `fcfce1d478360cf0a957cde2658f0a4d01f65006` | M1a follow-up final head (docs-only addendum) — base of `chat/m2-production-auth-v2` |
| `4208bd88cf9605375411018997c58b223d5bc101` | M2 commit A (P0): strict `tsc --noEmit` type-check in CI + M2 contract types (branded type ladder: VerifiedPrincipal, WorkspaceMember, AuthorizedContext, DelegatedAuthority, VerifiedApproval; GatewayTokenClaims, TokenService, ServiceIdentity, DelegatedGrant, ApprovalClaims, ApprovalProvider, MembershipAuthorityProvider, AuthFailureEvent) |
| `775b4379f53b50357a01c639bb0440d8544a12a2` | M2 commit B (P2/P3): production authentication chain — `auth/token-service.ts` (Ed25519 compact JWT), `auth/production-authentication.ts`, `providers/membership-file.cjs` + `.js`, gateway wiring behind the fail-closed config gate, 26-test negative matrix. **Its CI run was RED (one wrong test expectation); the implementation stood, the test was corrected in the next commit.** |
| `9d6fa597cb1f94a9a731ee9c97a6246a96d4f41b` | M2 commit C: test-expectation fix (verified non-member fails AUTHENTICATION 401 — defense-in-depth provider-level membership check) + P4: `auth/delegation.ts` (subset-enforced grants), `auth/approvals.ts` (single-use Ed25519 approval tokens), `tests/delegation-approval.test.mjs` (21 tests), 8-suite runner. **CI GREEN (push run 41307014908 + PR #3 run 41333689388).** |
| `70824784b25c1dc04ea8c2bdedf7ed88e8c74986` | M2 commit D (docs): ledger + docs/M2-IMPLEMENTATION-NOTES.md. Both test runs on this head GREEN. **EXACT base of `security/m2-1-auth-hardening`** |
| `bf49aa02b2643cd139a001e868c168368bf0f989` | M2.1 commit 1: auth hardening — strict JWT temporal validation (finite exp/iat/nbf, future-iat rejection, exp>iat, 1-hour max lifetime, malformed-nbf rejection), token-purpose enforcement (`access` only on the user path), membership operational-boundary docs, 27 new tests (suite: 53). **CI run 41337292376 — SUCCESS.** |
| `52cbdff0196ecf47b7af305244a0e56a354b9f37` | M2.1 commit 2 (docs): ledger + docs/M2-IMPLEMENTATION-NOTES.md addendum + docs/M2-1-AUTH-HARDENING.md. **CI run 41337461932 — SUCCESS (every step green).** **EXACT base of the M2.1.1 correction (verified).** |
| (this commit) | M2.1.1 correction: ABSOLUTE JWT lifetime ceiling — `effectiveMaximum = min(configured, 3600)`; a caller-supplied maxLifetimeSeconds may only TIGHTEN the bound; 7 new deterministic-clock regression tests (suite: 60); three docs updated. CI recorded below. |

- Active branch for this session: `security/m2-1-auth-hardening` (continued in place from `52cbdff` per the owner's M2.1.1 assignment; no reset, rebase, force-push, or history rewrite). Only this branch was modified.
- Stray branch `chat/m2-production-auth` (created from `main` by a mis-issued tool call, immediately superseded; NOT used, NOT deleted — **owner cleanup candidate**).
- Draft **PR #3** (owner-authorized, CI visibility only): head `chat/m2-production-auth-v2`, base `main`. Draft **PR #1** (id 5103611515) unchanged: head `cf26383`, base `main`, open.

## M2.1 / M2.1.1 OUTCOME (`security/m2-1-auth-hardening`)
- **JWT validation gaps closed (M2.1):** `exp`/`iat` must be finite numbers — NaN, Infinity, and hand-crafted `1e999` payloads (which `JSON.parse` evaluates to `Infinity`) are all rejected; future-issued tokens beyond the documented 30-second clock skew are rejected (the skew policy itself is unchanged — boundary-verified by tests); `exp` must be strictly later than `iat` (`exp == iat` rejected); a present-but-malformed `nbf` is rejected — never silently accepted. Integer-overflow defense: `exp - iat` overflow yields `Infinity`, which exceeds any finite bound.
- **Token-purpose policy enforced (M2.1):** interactive user authentication (ProductionAuthenticationProvider) accepts ONLY `token_use === "access"` — service-purpose, missing-purpose, and arbitrary-purpose tokens fail closed. Service identities require a separate explicit authentication path — PLANNED, deliberately not implemented. Service privileges are never inferred from the token subject.
- **Membership operational boundary documented in source** (`membership-file.cjs`): file-backed, NOT a transactional distributed store; concurrent writers race (last-writer-wins, no locking/merge/versioning); multi-process/scaled deployments require a stronger StorageAdapter (D1, M7); revocation IS effective for subsequent decisions; corrupt/missing data fails closed. Provider semantics unchanged; no database introduced.
- **M2.1.1 defect corrected:** the M2.1 verifier accepted a caller-supplied `maxLifetimeSeconds` ABOVE 3,600 verbatim, letting a caller RAISE the documented one-hour ceiling — violating the policy "callers may tighten, never loosen." Correction: `effectiveMaximum = Math.min(configuredMaximum, MAX_TOKEN_LIFETIME_SECONDS)`. The one-hour ceiling is now an ABSOLUTE verifier policy, not a caller-overridable maximum. Nothing else changed (30s skew, signature, iss/aud, iat/exp/nbf validation, purpose enforcement, membership, dev fixtures, M1a fail-closed behavior all untouched; no dependencies added). Regression-proofed by 7 new deterministic-clock tests (suite 53 → 60): default ceiling 3600; 1800-config rejects 1801 / accepts 1800; 7200-config cannot permit 3601 (clamped) but still accepts 3600; extreme option values (1e15) cannot bypass via extreme lifetimes (7200s and 1e9s both rejected); invalid options (NaN, Infinity, 0, −5, "7200", null) fail safely to the default (3601 rejected, 3600 accepted).
- **Negative matrix:** 26 (M2) → 53 (M2.1) → 60 (M2.1.1) tests in `tests/production-auth-negative.test.mjs`, all deterministic-clock where temporal. Gateway deliberately unmodified across M2.1/M2.1.1.
- Full policy documentation: docs/M2-1-AUTH-HARDENING.md; M2.1.1 correction section in docs/M2-IMPLEMENTATION-NOTES.md.

## VERIFIED CI EVIDENCE (actual GitHub Actions runs)
- M1a implementation `cb7b082`: runs `41266518476` + `41266514467` — success. M1a docs `cf26383`: runs `41266590168` + `41266593471` — success.
- M1a follow-up `0bfc7bf`: run `41267350544` — success. `cf83ef7`: run `41267446891` — success. Addendum head `fcfce1d`: success (M1a final report).
- **M2 commit A `4208bd8`: run `41306359238` — success** (typecheck + all 6 M1a suites green).
- **M2 commit B `775b437`: run `41306716485` — FAILURE** at the test step (typecheck green). Root cause: one wrong test expectation — the verified-non-member child test expected the gateway's 403 WORKSPACE_FORBIDDEN, but the production provider checks membership itself (defense in depth), so the correct result is 401 UNAUTHENTICATED at the authentication gate. Fix: corrected the TEST, not the implementation.
- **M2 commit C `9d6fa59`: runs `41307014908` (push) and `41333689388` (PR #3) — SUCCESS** (8 suites incl. the 26-test production matrix and 21 delegation/approval tests).
- M2 commit D `7082478`: both runs on head — success (recorded in the M2 owner report).
- **M2.1 commit 1 `bf49aa0`: run `41337292376` (push, branch `security/m2-1-auth-hardening`) — SUCCESS** (typecheck + 8 suites incl. the 53-test production auth matrix + deployment smoke).
- **M2.1 commit 2 `52cbdff` (docs): run `41337461932` (push) — SUCCESS** — every job step verified green individually (Type-check, Run test suites, Guard, Deployment smoke; failure-artifact step skipped as expected).
- **M2.1.1 (this commit): run recorded in the M2.1.1 owner report after push** (Actions REST API `actions/runs` + per-step `jobs` evidence; typecheck, full suite incl. the 60-test matrix, failure-marker guard, deployment smoke all required green before completion is declared).
- Verification method note: historically a mix of Actions REST API (when quota allowed) and the GitHub App connector via `pull_request_read.get_check_runs` on owner-authorized draft PR #3 (when the anonymous egress IP exhausted GitHub's 60/hour limit). The authoring environment has no git and no node; all test evidence is GitHub Actions only. Per-test logs are not readable from the authoring environment (job-log endpoint requires admin-authenticated access). No success is reported from a Vercel check or a partially completed workflow — the required `test` job steps are verified individually.

## NOT VERIFIED / UNTESTED (honest limits)
- The authoring environment has NO git and NO node; all repository operations used the GitHub App API + public REST API; tests ran ONLY in GitHub Actions. Standalone per-suite invocations were not run separately — all suites ran within the CI runner aggregate (each suite retains standalone exit-non-zero capability, unverified standalone here).
- `apps/mcp-server/src/mcp-gateway.ts` itself is NOT in the tsc scope (executed via type stripping in CI; only `packages/contracts` + `auth/**` are type-checked). Extending tsc to the gateway and provider `.cjs` files is a recorded next decision.
- Token denylist and approval redemption record are per-process in-memory (short TTLs bound the revocation window; the ABSOLUTE 1-hour lifetime ceiling bounds it further); durable versions arrive with the durable store (D1, M7).
- OAuth/OIDC external identity-provider adapter (PKCE, JWKS rotation) is designed in the M2 assessment but PLANNED, not implemented — the gateway currently trusts only tokens signed by the configured control-plane key.
- Service-identity authentication path (explicit, separate from the user path) is PLANNED, not implemented — deliberately not improvised.
- Delegation and approval modules are implemented + unit-tested but NOT wired into the gateway or any execution adapter; no runtime command execution exists.
- No performance/load testing; no penetration testing beyond the negative test matrix.

## KNOWN DEFECTS & PROPOSED FIXES
1. ~~Gateway never executed at runtime~~ — fixed (M1a, verified in CI).
2. ~~Provider .js/.cjs module-format debt~~ — fixed + test-enforced (M1a).
3. ~~Test runner unconditional process.exit(0)~~ — fixed (M1a).
4. ~~Empty default membership wiring~~ — fixed (M1a).
5. ~~No production-mode enforcement~~ — fixed (M1a Finding A), then upgraded to real production authentication (M2).
6. Audit console-only — open (production: durable append-only AuditSink per packages/contracts; D1 at M7).
7. ~~No type-check step~~ — fixed (M2 P0: tsc strict in CI over contracts + auth).
8. ~~Dev principals/membership are the only fixtures~~ — fixed (M2: real token verification + durable membership).
9. ~~JWT validation gaps (future iat, NaN/Infinity exp, malformed nbf silently ignored, no exp>iat, no max lifetime, no purpose enforcement)~~ — fixed (M2.1, verified in CI run 41337292376).
10. ~~M2.1 lifetime ceiling defect (caller-supplied maxLifetimeSeconds above 3600 could RAISE the documented one-hour ceiling)~~ — **fixed (M2.1.1: absolute verifier ceiling, min(configured, 3600); regression-proofed by 7 deterministic-clock tests; CI recorded in the M2.1.1 owner report).**

## ARCHITECTURAL DECISIONS RECORDED (M2 and later)
1. ~~TS type-checking strategy~~ — decided & implemented (M2 P0): strict tsc, contracts + auth scope; extending scope is incremental.
2. Durable append-only audit storage — AuditSink contract exists; D1 at M7.
3. ~~Production authentication/membership~~ — decided & implemented (M2): Ed25519 compact JWTs, membership-file authority, fail-closed config gate. External IdP/OAuth-OIDC adapter remains planned.
4. Runtime command execution security: allowlisted named operations preferred over unrestricted command strings; approval tokens are signed, scoped, single-use, expiring (implemented as modules in M2 P4; adapter verification arrives with real execution, M3+).
5. Operator Screen event feed: typed OrchestrationEvent schema onto the shared source of truth; Operator Screen subscribes read-only; takeover is a control-plane command. Current event surface remains audit-only.
6. Browser-session ownership/user takeover (Cloud Computer): single explicit owner at a time; atomic, audited ownership transfer; owned-session state machine in the shared source of truth.
7. Shared source of truth: one durable workspace store (the StorageAdapter contract is the seam) linking identity → membership → project → task → delegation/execution session → approvals → events; RBAC/workspace isolation applies to all readers and writers.
8. (M2.1) Token policy: clock skew stays 30 seconds; interactive user auth accepts ONLY `token_use === "access"`; a service-auth path, when built, is separate and separately tested.
9. (M2.1.1) **The one-hour access-token lifetime ceiling is an ABSOLUTE verifier policy** (`effectiveMaximum = min(configured, MAX_TOKEN_LIFETIME_SECONDS)`), not a caller-overridable maximum: a configurable security limit may become stricter, never weaker than the platform's absolute security ceiling. Raising the ceiling requires a code change plus explicit owner decision.

## DECISIONS & CONVENTIONS
- Extend, do not replace, the M1a foundation. `remRADAR/RADARMatrix` is canonical; `remRADAR/RADARSite` is untouchable.
- **RADAR is the master intelligence identity — never Jarvis — in all new documentation, architecture descriptions and implementation.**
- Module format law: `.cjs` = provider implementation source of truth; `.js` = ESM re-export wrapper only; `.ts` under `"type": "module"` = ESM, erasable syntax only; type-only exports MUST use `export type`; relative TS imports keep explicit `.ts` extensions (allowImportingTsExtensions).
- Runtime-mode law: `RADARMATRIX_RUNTIME_MODE=production` + complete config = real production chain (token verification + durable membership); ANY incomplete config fails closed with empty registries. Development identities and fixtures are unreachable in production mode.
- Identity law: a decoded/unsigned token payload is NEVER an identity; roles NEVER come from token claims; workspace_id in a request is NEVER proof of membership.
- Token law (M2.1/M2.1.1): exp/iat/nbf must be finite numbers; future iat beyond 30s skew rejected; exp strictly after iat; lifetime bounded by the ABSOLUTE 1-hour verifier ceiling (tightenable in code, never loosenable by callers); malformed nbf rejected; purpose enforced exactly where required (`access` for interactive user auth).
- Membership law: explicit map only, fail closed, no wildcard/fallback; unknown roles rejected at grant time; the file-backed provider is an interim single-instance store, not transactional distributed persistence.
- Delegation law: grants are subset-enforced, single-agent, single-workspace, short-TTL, use-limited; agents never inherit full actor authority; RADAR included.
- Approval law: signed, exact-scope (action + resource list + workspace + actor), short-TTL, single-use; replay denied; adapters verify before executing.
- Test law: every suite propagates failures to exit codes; CI primary signal = exit codes (pipefail-preserved); captured log uploaded as artifact on failure.
- Status vocabulary: implemented / tested / verified-in-CI / connected / simulated / planned / blocked / unavailable.
- All agent writes approval-gated; `main` is human-merged; substantial changes land on isolated branches; PRs are opened/merged only with an explicit owner decision (draft PR #3 was explicitly authorized by the owner for CI visibility).

## DO NOT TOUCH
- The two v0.9 branches (`v0.9-production-hardening`, `v0.9-security-gate`) — no merge/delete until the owner approves the retirement strategy.
- PR #1 head/base; `phase1/discovery-and-foundation`; `chat/m1a-pr-review-followup`; `chat/m2-production-auth-v2` (M2 record; extended only by the M2.1/M2.1.1 branch); `apps/brand-studio/` until `apps/matrix-ide/` reaches parity; `apps/mcp-server/` security pipeline semantics (extend, never weaken); `remRADAR/RADARSite`; production deployments, DNS, the shared Cloudflare account.
- `packages/contracts` contract law — future adapters must satisfy it without weakening the fail-closed model.

## PENDING OWNER APPROVALS / DECISIONS
1. Review of M2.1 + M2.1.1 on `security/m2-1-auth-hardening` (docs/M2-1-AUTH-HARDENING.md) and their disposition (merge is owner-gated).
2. Disposition of `chat/m2-production-auth-v2` and draft PR #3 (review? further hardening? merge is owner-gated).
3. Stray branch `chat/m2-production-auth` (base `main`, superseded, unused) — **awaiting owner deletion** (no branch-delete tool available to the agent).
4. External identity-provider choice (OAuth/OIDC with PKCE, JWKS rotation) for staging — design exists in the M2 assessment; implementation awaits owner selection of the IdP.
5. Durable token denylist / approval redemption / audit storage (D1, M7 timing).
6. Extending tsc scope to the gateway + provider `.cjs` files.
7. Allowlisted RuntimeExecutionRequest model before any real execution (M3); read-only GitHub runtime adapter first; separate explicit service-identity authentication path before agents authenticate in production.
8. v0.9 branch retirement strategy; PR #1 merge (human-gated).

## NEXT STEPS (ordered)
1. Owner reviews M2.1.1 (`security/m2-1-auth-hardening`; docs/M2-1-AUTH-HARDENING.md, docs/M2-IMPLEMENTATION-NOTES.md M2.1.1 section) and authorizes the next phase. **M3 must not begin without that authorization.**
2. Owner reviews `chat/m2-production-auth-v2` via draft PR #3 (docs/M2-IMPLEMENTATION-NOTES.md) and disposes of the branch/PR.
3. Owner deletes the stray branch `chat/m2-production-auth`.
4. M3: `github-readonly` runtime adapter (first real execution capability), consuming the approval-token model; allowlisted operations only; explicit service-identity auth path if agents must authenticate.
5. IdP adapter selection + implementation (PKCE, JWKS) when staging identities are needed.
6. Durable store (D1 at M7): memberships, grants, approvals, redemption records, audit events.
7. M4+ (vision components, only after owner-approved specifications): Operator Screen, RADAR Chat routing, Cloud Computer, per the recorded decisions above.
