# HANDOFF — RADARMatrix

## CURRENT STATE
- Last updated: 2026-11-04 — Mistral Vibe (M2.2 Security Correction & Verification session, branch `security/m2-2-hardening`, per the owner's M2.2 directive)
- Phase: M1a + M2 + M2.1 + M2.1.1 + **M3 (github-readonly runtime adapter, branch `runtime/m3-github-readonly` @ `d22e84d`)** implemented and CI-verified; consolidation of `security/m2-1-auth-hardening` into the M2 branch completed via PR #4 (M2 branch head now `7af32ed`). **M2.2 security corrections IMPLEMENTED and CI-verified on `security/m2-2-hardening` (docs: docs/M2-2-HARDENING.md).** Production authorization: NOT GRANTED — no production surface touched.
- Uncommitted changes: none. **No merges without owner decision.** `main`, `chat/m2-production-auth-v2`, `chat/m1a-pr-review-followup`, `phase1/discovery-and-foundation`, both v0.9 branches, PR #1, PR #3 and PR #5 untouched during M2.2. No production actions, no Cloudflare resources, no RADARSite modifications, no paid services.

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
| `4208bd88cf9605375411018997c58b223d5bc101` | M2 commit A (P0): strict `tsc --noEmit` type-check in CI + M2 contract types |
| `775b4379f53b50357a01c639bb0440d8544a12a2` | M2 commit B (P2/P3): production authentication chain. Its CI run was RED (one wrong test expectation); the implementation stood, the test was corrected in the next commit. |
| `9d6fa597cb1f94a9a731ee9c97a6246a96d4f41b` | M2 commit C: test-expectation fix + P4 delegation/approvals modules. **CI GREEN (push run 41307014908 + PR #3 run 41333689388).** |
| `70824784b25c1dc04ea8c2bdedf7ed88e8c74986` | M2 commit D (docs). **EXACT base of `security/m2-1-auth-hardening`** |
| `bf49aa02b2643cd139a001e868c168368bf0f989` | M2.1 commit 1: auth hardening (strict JWT temporal validation, token-purpose enforcement, 27 new tests). **CI run 41337292376 — SUCCESS.** |
| `52cbdff0196ecf47b7af305244a0e56a354b9f37` | M2.1 commit 2 (docs). **CI run 41337461932 — SUCCESS.** Base of the M2.1.1 correction. |
| `cfbd88cc548a065d11ee1d88f92a1052a182860b` | M2.1.1 correction: ABSOLUTE JWT lifetime ceiling (`min(configured, 3600)`), 7 regression tests (suite 60). **CI run 41607318159 — SUCCESS.** Head of `security/m2-1-auth-hardening` (record branch). |
| `7af32edd059005a922fbe457f3408a27b5eff326` | M2 branch head after consolidation (PR #4 rebase-merged `security/m2-1-auth-hardening` into `chat/m2-production-auth-v2`; GitHub rewrote the SHAs). CI runs 41882906752 + 41883033676 — SUCCESS. **EXACT base of `security/m2-2-hardening`.** |
| `d22e84da086d4c8a1280f0432f1beebab195b8ca` | M3 head on `runtime/m3-github-readonly` (github-readonly adapter, 23-test suite). CI runs 41885004102 + 41885019186 — SUCCESS. Draft PR #5 open (CI visibility). NOT touched during M2.2. |
| `1708ee2d7924ae00fdee2af514ed1786331226c9` | M2.2 commit 1 (code): tri-mode fail-closed runtime mode, trusted-actor delegation, hardened approvals, atomic membership persistence, migrated + new regression suites, 9-suite runner. CI initially RED on one over-strict env-discipline assertion (see M2.2 OUTCOME). |
| `a877d964e845af04ee0453a83b888bce79772ff3` | M2.2 diagnostic commit: CI publishes captured suite output to the job summary on failure. |
| `eaac39610a131d876549408c61d162e3cc4f33b1` | M2.2 diagnostic commit: failing test lines (or crash tail) annotated on the run page. |
| `33d4792dc695944c2be6ea761863f4bdad5c132b` | M2.2 test correction: env-discipline assertion accepts any explicitly pinned fixture mode (the brand-gateway suite legitimately pins `development` for the shared runner process). |
| `727de8145e74e8f5d5b597e1d763e09d386945d7` | **M2.2 final code head — CI GREEN (runs 41889153742 push + 41889159968 PR, all steps verified: typecheck, 9 suites, failure-marker guard, deployment smoke).** |
| (this commit) | M2.2 docs: docs/M2-2-HARDENING.md + this ledger update. CI recorded below. |

- Active branch for this session: `security/m2-2-hardening` (from exactly `7af32ed`; no reset, rebase, force-push, or history rewrite). During M2.2 only this branch was modified.
- Draft **PR #6** (owner-authorized CI-visibility convention): head `security/m2-2-hardening`, base `chat/m2-production-auth-v2` — NOT to be merged without explicit owner decision.
- Draft **PR #3** (owner-authorized, CI visibility only): head `chat/m2-production-auth-v2` @ `7af32ed`, base `main`. Draft **PR #1** (id 5103611515) unchanged. Draft PR #5 (M3 → M2 branch) unchanged.
- Stray branch `chat/m2-production-auth` (created from `main` by a mis-issued tool call, immediately superseded; NOT used, NOT deleted — **owner cleanup candidate**).

## M2.2 OUTCOME (`security/m2-2-hardening`)
- **A — Runtime mode fails closed:** tri-mode (exact `development`/`test`/`production`); anything else — unset, empty, misspelled, wrong-casing, unknown — yields `fail_closed`: EMPTY registries on BOTH the authentication and membership gates. The previous silent development fallback is gone. Verified by real-gateway child-process tests checking ACTUAL denial behavior (401 + empty membership), not merely error returns. npm test scripts pin the mode explicitly.
- **B — Delegated authority independently verified:** actor authority is DERIVED from a trusted server-side `TrustedActorContext` (verified principal + verified roles + workspace) via `deriveActorAuthority` (role hierarchy mirrored from the authorization provider). Caller-supplied `actor_tools`/`actor_can_write` are rejected OUTRIGHT. Subset rule, field validation, expiry-before-use-limits ordering retained; new sha256 `integrity_hash` seal rejects any mutated grant at validation (`grant_mutated`). Clock input validated. NOT connected to runtime execution.
- **C — Approvals hardened:** complete claims-structure validation (non-empty jti/action/workspace/actor/resource strings; FINITE INTEGER iat/exp; exp>iat; optional fields validated), non-finite verification clock rejected (`invalid_clock`), redemption is an ATOMIC check-and-set (`claim`); failed verification never consumes an approval. Exact action/resource/workspace/actor/grant/session binding preserved; 30-minute TTL ceiling unchanged.
- **D — Membership persistence boundary:** `#persist` now writes a process-unique temp file and `renameSync`s it into place (atomic on POSIX) — torn writes impossible; write failures propagate loudly. Docs updated: torn writes prevented, LOST writes (last-writer-wins) still possible; still NOT distributed persistence; StorageAdapter seam + M7 (D1) sequence unchanged. Corrupt/missing data still fails closed.
- **E — Chain review:** signature, iss/aud, purpose, expiry, identity binding, isolation, membership, role hierarchy, tool permissions, error handling, audit, production config behavior re-inspected — M2.1/M2.1.1 hardening stands; authentication/membership/authorization remain separate boundaries.
- **Honest iteration record:** commit `1708ee2` failed CI on exactly one over-strict assertion (demanding `RADARMATRIX_RUNTIME_MODE=test` in the runner process while the brand-gateway suite legitimately pins `development` for the shared environment). Two diagnostic commits added permanent CI failure-visibility (annotations + job summary); the assertion was corrected in `33d4792`. No test was weakened to pass: the fail-closed law itself is enforced by the child-process runtime tests; the corrected assertion still requires an explicitly pinned mode.
- Full documentation: docs/M2-2-HARDENING.md.

## M2.1 / M2.1.1 OUTCOME (`security/m2-1-auth-hardening` — consolidated into the M2 branch via PR #4)
- **JWT validation gaps closed (M2.1):** finite exp/iat/nbf (NaN, Infinity, `1e999` payloads rejected); future-issued tokens beyond the 30-second skew rejected; `exp > iat` strictly; malformed `nbf` rejected; token-purpose enforced (`access` only on the interactive user path).
- **M2.1.1 defect corrected:** the verifier accepted a caller-supplied `maxLifetimeSeconds` above 3,600 verbatim, letting a caller RAISE the documented one-hour ceiling. Correction: `effectiveMaximum = Math.min(configuredMaximum, MAX_TOKEN_LIFETIME_SECONDS)` — the ceiling is an ABSOLUTE verifier policy. 7 deterministic-clock regression tests (suite 60).
- Full policy documentation: docs/M2-1-AUTH-HARDENING.md; M2.1.1 correction section in docs/M2-IMPLEMENTATION-NOTES.md.

## VERIFIED CI EVIDENCE (actual GitHub Actions runs)
- M1a `cb7b082`: runs 41266518476 + 41266514467 — success. Docs `cf26383`: runs 41266590168 + 41266593471 — success. Follow-up `0bfc7bf`: 41267350544; `cf83ef7`: 41267446891; addendum `fcfce1d`: success.
- M2 commit A `4208bd8`: run 41306359238 — success. Commit B `775b437`: run 41306716485 — FAILURE (one wrong test expectation; test corrected, implementation stood). Commit C `9d6fa59`: runs 41307014908 + 41333689388 — SUCCESS. Commit D `7082478`: success (M2 owner report).
- M2.1 `bf49aa0`: run 41337292376 — SUCCESS. `52cbdff`: run 41337461932 — SUCCESS. M2.1.1 `cfbd88c`: run 41607318159 — SUCCESS.
- Consolidation: M2 branch head `7af32ed` — runs 41882906752 + 41883033676 — SUCCESS.
- M3 `d22e84d`: runs 41885004102 + 41885019186 — SUCCESS.
- **M2.2 `1708ee2`: runs 41888237510 + 41888260452 — FAILURE** (single over-strict env-discipline assertion; no security-logic defect). Diagnostic `a877d96`/`eaac396`: runs 41888653589/41888662970 and 41888809574/41888818369 — same failure, now with the failing test annotated on the run page. `33d4792`: runs 41889153742 + 41889159968 — SUCCESS. **Final code head `727de81`: runs 41889153742 (push) + 41889159968 (PR #6) — SUCCESS, every step individually verified (typecheck, 9-suite run incl. the 60-test production matrix + 30-test delegation/approval suite + 18-test M2.2 regression suite, failure-marker guard, deployment smoke).**
- Verification method: GitHub App connector `pull_request_read.get_check_runs` on owner-authorized draft PRs; anonymous Actions REST API (jobs/steps) when quota allowed; run-page annotations (added in M2.2) for failing-test visibility. Per-test logs remain unreadable from the authoring environment (job-log endpoint requires authenticated access). No success is reported from a Vercel check or a partially completed workflow — the required `test` job steps are verified individually.

## NOT VERIFIED / UNTESTED (honest limits)
- The authoring environment has NO git and NO node; all repository operations used the GitHub App API + public REST API; tests ran ONLY in GitHub Actions. Standalone per-suite invocations were not run separately — all suites ran within the CI runner aggregate (each suite retains standalone exit-non-zero capability, unverified standalone here).
- `apps/mcp-server/src/mcp-gateway.ts` itself is NOT in the tsc scope (executed via type stripping in CI; only `packages/contracts` + `auth/**` are type-checked). Extending tsc to the gateway and provider `.cjs` files is a recorded next decision.
- Token denylist and approval redemption record are per-process in-memory (short TTLs bound the revocation window; the ABSOLUTE 1-hour lifetime ceiling bounds it further). The atomic in-process `claim()` prevents double-redemption within a process; CROSS-PROCESS single-use requires the durable store (D1, M7).
- OAuth/OIDC external identity-provider adapter (PKCE, JWKS rotation) is designed in the M2 assessment but PLANNED, not implemented — the gateway currently trusts only tokens signed by the configured control-plane key.
- Service-identity authentication path (explicit, separate from the user path) is PLANNED, not implemented — deliberately not improvised.
- Delegation and approval modules are implemented + unit-tested but NOT wired into the gateway for execution; no runtime command execution exists through them. The M3 github-readonly adapter lives on its own branch, unmerged.
- FileMembershipProvider: atomic rename prevents TORN writes, not LOST writes (last-writer-wins across instances remains).
- No performance/load testing; no penetration testing beyond the negative test matrix.

## KNOWN DEFECTS & PROPOSED FIXES
1. ~~Gateway never executed at runtime~~ — fixed (M1a, verified in CI).
2. ~~Provider .js/.cjs module-format debt~~ — fixed + test-enforced (M1a).
3. ~~Test runner unconditional process.exit(0)~~ — fixed (M1a).
4. ~~Empty default membership wiring~~ — fixed (M1a).
5. ~~No production-mode enforcement~~ — fixed (M1a Finding A), upgraded (M2), hardened (M2.2 fail_closed default).
6. Audit console-only — open (production: durable append-only AuditSink per packages/contracts; D1 at M7).
7. ~~No type-check step~~ — fixed (M2 P0: tsc strict in CI over contracts + auth).
8. ~~Dev principals/membership are the only fixtures~~ — fixed (M2: real token verification + durable membership).
9. ~~JWT validation gaps~~ — fixed (M2.1).
10. ~~M2.1 lifetime ceiling defect~~ — fixed (M2.1.1: absolute verifier ceiling).
11. ~~Unset/misspelled runtime mode silently activated development identities~~ — **fixed (M2.2: tri-mode fail-closed runtime; fail_closed = empty registries both gates; child-process regression matrix).**
12. ~~Delegation trusted caller-supplied actor authority~~ — **fixed (M2.2: trusted-actor context + deriveActorAuthority; caller-supplied authority rejected outright; sha256 integrity seal rejects mutated grants).**
13. ~~Approval validation lacked claims-structure/non-finite-clock checks; redemption was check-then-mark~~ — **fixed (M2.2: full claims validation, invalid_clock, atomic check-and-set claim).**
14. ~~Membership persistence could tear the live file mid-write~~ — **fixed (M2.2: temp-file + atomic rename; failures propagate).**

## ARCHITECTURAL DECISIONS RECORDED (M2 and later)
1. ~~TS type-checking strategy~~ — decided & implemented (M2 P0): strict tsc, contracts + auth scope; extending scope is incremental.
2. Durable append-only audit storage — AuditSink contract exists; D1 at M7.
3. ~~Production authentication/membership~~ — decided & implemented (M2): Ed25519 compact JWTs, membership-file authority, fail-closed config gate. External IdP/OAuth-OIDC adapter remains planned.
4. Runtime command execution security: allowlisted named operations preferred over unrestricted command strings; approval tokens are signed, scoped, single-use, expiring (implemented M2 P4; hardened M2.2; M3 github-readonly adapter on its own branch).
5. Operator Screen event feed: typed OrchestrationEvent schema onto the shared source of truth; Operator Screen subscribes read-only; takeover is a control-plane command. Current event surface remains audit-only.
6. Browser-session ownership/user takeover (Cloud Computer): single explicit owner at a time; atomic, audited ownership transfer; owned-session state machine in the shared source of truth.
7. Shared source of truth: one durable workspace store (the StorageAdapter contract is the seam) linking identity → membership → project → task → delegation/execution session → approvals → events; RBAC/workspace isolation applies to all readers and writers.
8. (M2.1) Token policy: clock skew stays 30 seconds; interactive user auth accepts ONLY `token_use === "access"`; a service-auth path, when built, is separate and separately tested.
9. (M2.1.1) The one-hour access-token lifetime ceiling is an ABSOLUTE verifier policy (`min(configured, 3600)`) — tightenable in code, never loosenable by callers.
10. (M2.2) **The runtime mode is tri-mode and fail-closed**: exact `development`/`test`/`production`; every other value (including unset) means `fail_closed` — empty registries on both gates. There is no permissive runtime-mode default anywhere in the gateway. Test environments must pin their mode explicitly.
11. (M2.2) **Delegated authority is derived, never asserted**: a delegating actor's tools/write capability are DERIVED server-side from the authenticated principal's verified roles; grants carry a hash seal over all security-relevant fields, and a mutated grant never validates.

## DECISIONS & CONVENTIONS
- Extend, do not replace, the M1a foundation. `remRADAR/RADARMatrix` is canonical; `remRADAR/RADARSite` is untouchable.
- **RADAR is the master intelligence identity — never Jarvis — in all new documentation, architecture descriptions and implementation.**
- Module format law: `.cjs` = provider implementation source of truth; `.js` = ESM re-export wrapper only; `.ts` under `"type": "module"` = ESM, erasable syntax only; type-only exports MUST use `export type`; relative TS imports keep explicit `.ts` extensions (allowImportingTsExtensions).
- Runtime-mode law (M2.2): exact `production` + complete config = real production chain; exact `development`/`test` = deterministic fixtures; ANYTHING ELSE = `fail_closed` with empty registries. Development identities are unreachable except in explicitly requested fixture modes, and never in any production state.
- Identity law: a decoded/unsigned token payload is NEVER an identity; roles NEVER come from token claims; workspace_id in a request is NEVER proof of membership.
- Token law (M2.1/M2.1.1): exp/iat/nbf must be finite numbers; future iat beyond 30s skew rejected; exp strictly after iat; lifetime bounded by the ABSOLUTE 1-hour verifier ceiling; malformed nbf rejected; purpose enforced exactly where required.
- Membership law: explicit map only, fail closed, no wildcard/fallback; unknown roles rejected at grant time; the file-backed provider is an interim single-instance store (atomic single-file persistence since M2.2), not transactional distributed persistence.
- Delegation law (M2.2): actor authority is DERIVED from the trusted authenticated context, never caller-supplied; grants are subset-enforced, single-agent, single-workspace, short-TTL, use-limited, hash-sealed against mutation; agents never inherit full actor authority; RADAR included.
- Approval law (M2.2): signed, exact-scope, short-TTL, single-use with ATOMIC redemption; complete claims-structure validation; non-finite clocks rejected; failed verification never consumes an approval; adapters verify before executing.
- Test law: every suite propagates failures to exit codes; CI primary signal = exit codes (pipefail-preserved); captured log uploaded as artifact + published to the job summary + annotated on failure (M2.2); tests must verify ACTUAL denial behavior.
- Status vocabulary: implemented / tested / verified-in-CI / connected / simulated / planned / blocked / unavailable.
- All agent writes approval-gated; `main` is human-merged; substantial changes land on isolated branches; PRs are opened/merged only with an explicit owner decision (draft PRs for CI visibility follow the established owner authorization).

## DO NOT TOUCH
- The two v0.9 branches (`v0.9-production-hardening`, `v0.9-security-gate`) — no merge/delete until the owner approves the retirement strategy.
- PR #1 head/base; `phase1/discovery-and-foundation`; `chat/m1a-pr-review-followup`; `chat/m2-production-auth-v2` (M2 record; extended only by owner-approved merges); `runtime/m3-github-readonly` and PR #5 (M3 record — paused per the M2.2 directive, resume only after M2.2 disposition); `apps/brand-studio/` until `apps/matrix-ide/` reaches parity; `apps/mcp-server/` security pipeline semantics (extend, never weaken); `remRADAR/RADARSite`; production deployments, DNS, the shared Cloudflare account.
- `packages/contracts` contract law — future adapters must satisfy it without weakening the fail-closed model.

## PENDING OWNER APPROVALS / DECISIONS
1. Review of M2.2 (`security/m2-2-hardening`; docs/M2-2-HARDENING.md) and its disposition (merge into the M2 branch via draft PR #6 is owner-gated; PR #3 is not ready for another review until then).
2. Review of M2.1/M2.1.1 (now consolidated in the M2 branch) and disposition of `chat/m2-production-auth-v2` + draft PR #3.
3. Stray branch `chat/m2-production-auth` (base `main`, superseded, unused) — **awaiting owner deletion** (no branch-delete tool available to the agent).
4. External identity-provider choice (OAuth/OIDC with PKCE, JWKS rotation) for staging — design exists in the M2 assessment; implementation awaits owner selection of the IdP.
5. Durable token denylist / approval redemption / audit storage (D1, M7 timing).
6. Extending tsc scope to the gateway + provider `.cjs` files.
7. M3 resumption (`runtime/m3-github-readonly` @ `d22e84d` is complete and CI-green on its own branch) and the separate explicit service-identity authentication path before agents authenticate in production.
8. v0.9 branch retirement strategy; PR #1 merge (human-gated).

## NEXT STEPS (ordered)
1. Owner reviews M2.2 (docs/M2-2-HARDENING.md) and decides its disposition (merge PR #6 → M2 branch, which advances PR #3; then PR #3 re-review).
2. Owner reviews `chat/m2-production-auth-v2` via draft PR #3 and disposes of the branch/PR.
3. Owner deletes the stray branch `chat/m2-production-auth`.
4. M3 resumption: the github-readonly adapter is implemented on `runtime/m3-github-readonly` (paused intact per the M2.2 directive); resume the roadmap only after the owner authorizes it.
5. IdP adapter selection + implementation (PKCE, JWKS) when staging identities are needed.
6. Durable store (D1 at M7): memberships, grants, approvals, redemption records, audit events.
7. M4+ (vision components, only after owner-approved specifications): Operator Screen, RADAR Chat routing, Cloud Computer, per the recorded decisions above.
