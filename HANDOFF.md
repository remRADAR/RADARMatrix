# HANDOFF — RADARMatrix

## CURRENT STATE
- Last updated: 2026-11-04 — Mistral Vibe (M3 session; owner authorized: consolidation merge of the security branch into the M2 branch, housekeeping/cleanup, and a full M3→M7 roadmap pass)
- Phase: M2.1/M2.1.1 CONSOLIDATED into `chat/m2-production-auth-v2` (owner-authorized rebase merge via PR #4); M3 `github-readonly` runtime adapter IMPLEMENTED and CI-verified on `runtime/m3-github-readonly`. Production authorization: NOT GRANTED — no production surface touched.
- Uncommitted changes: none. `main`, `chat/m1a-pr-review-followup`, `phase1/discovery-and-foundation`, both v0.9 branches, PR #1 and draft PR #3 structurally untouched (PR #3's head advanced only because the owner-authorized merge updated its head branch `chat/m2-production-auth-v2`). No production actions, no Cloudflare resources, no RADARSite modifications, no paid services.

## GOVERNING ARCHITECTURAL CONTEXT (recorded — not implemented)
- **RADAR is the master intelligence identity of RADARMatrix.** Do not use "Jarvis" (or any other name) as the master intelligence in new documentation, architecture descriptions or implementation. RADAR is also NOT an unrestricted superuser: its orchestration grants are subject to the same delegated-authority subset rules as any human actor (see the M2 delegation module).
- Long-term product components (seven, to operate as one coordinated system): RADAR Intelligence, RADAR Agent Network, RADAR Chat, RADAR Operator Screen, RADAR Cloud Computer, RADAR IDE, RADAR Halo OS.
- Product references (architectural inspiration only): Manus (task progress, cloud-browser preview, live execution visibility, user takeover), Sesori (chat experience, intelligent routing, unified UI), Teamily (agent-system UI/UX, specialist agents, shared source of truth).
- RADAR stays provider-neutral. Current dev workflow (Codespaces, Mistral Vibe as coding environment, Sesori bridge, Manus for browser tasks, OpenCode and Ollama-class local model adapters) = tools and adapters, not the identity or intelligence layer.

## EXACT COMMIT LINEAGE (verified)
| Commit | Meaning |
|---|---|
| `93c1dc1` | `main` head (untouched throughout) |
| `cf26383` | M1a docs/PR-update commit — head of PR #1, base of `chat/m1a-pr-review-followup` (untouched; PR #1 head/base unchanged) |
| `fcfce1d` | M1a follow-up final head — base of `chat/m2-production-auth-v2` |
| `4208bd8` | M2 commit A (P0): strict tsc in CI + M2 contract types. CI run 41306359238 success |
| `775b437` | M2 commit B: production auth chain; its CI run red (one wrong test expectation, fixed in C) |
| `9d6fa59` | M2 commit C: test fix + delegation/approvals modules. CI runs 41307014908 + 41333689388 success |
| `7082478` | M2 commit D (docs). CI green. Original base of `security/m2-1-auth-hardening` |
| `bf49aa0` (security branch) | M2.1 auth hardening (27 new tests; suite 53). CI run 41337292376 success |
| `52cbdff` (security branch) | M2.1 docs. CI run 41337461932 success |
| `cfbd88c` (security branch) | M2.1.1 ABSOLUTE JWT lifetime ceiling (`min(configured, 3600)`; 7 regression tests; suite 60). CI run 41607318159 success — every step verified |
| `7af32ed` | **Owner-authorized consolidation (2026-11-04)**: `security/m2-1-auth-hardening` merged into `chat/m2-production-auth-v2` via PR #4 (merge method rebase — GitHub rewrote the three commit SHAs; tree content identical to `cfbd88c`). CI on this head: run `41882906752` (push) + run `41883033676` (PR #3) — both SUCCESS. Base of `runtime/m3-github-readonly` |
| `32d4297` | M3 commit 1: `github-readonly` runtime adapter (first real execution capability) + `tests/github-readonly.test.mjs` (deterministic, injected transport/clock) + tsc scope extended to `apps/mcp-server/src/runtime/**/*.ts` + test-runner 9th suite. CI run 41883501673 **FAILURE at the typecheck step** (2 author defects: `isNonEmptyString` not a type predicate — `baseUrl` narrowed as `string \| undefined`; non-2xx branches used shorthand `stderr` with no binding). Diagnosed from the job annotations; fixed in the next commit |
| `cf89c06` | M3 fix 1: type predicate `v is string` + explicit `stderr: body` on non-2xx branches. Typecheck green from here on. CI runs 41883883862/41884183862-era **FAILURE at the test step** — three test-harness defects diagnosed |
| `9eae883` | M3 docs: docs/M3-GITHUB-READONLY-ADAPTER.md + ledger. Runs 41884183862 (push) + 41884197434 (PR #5) FAILURE — test step |
| `23d03e2` | M3 fix 2 (test harness): actor_tools derived from the grant's registry keyset; no-transport test simulates a fetch-less environment via globalThis.fetch; empty command split into its own missing_command case. Runs 41884708385 (push) + 41884719592-era **FAILURE** — root cause: the ADAPTER's approval check omitted `actor_id`, so every approval-gated execution failed verifyApproval's exact actor match |
| `630a071` | M3 fix 3 (adapter): ApprovalVerifyFn check now carries `actor_id`; the adapter passes `grant.actor_id` (the delegating human actor — approvals are actor-bound by the M2 law). New regression test: an approval minted for a different actor is denied. Runs 41884831543-era FAILURE — final defect: the use-limit test ran against an expired adapter clock (validateGrantUse checks expiry BEFORE use limits) |
| `2698192` | M3 fix 4 (test): use-limit half of the expired/use-limit test moved to a second, in-window adapter. **CI runs 41884831543 (push) + 41884842532 (PR #5 synchronize) — SUCCESS. Final verified M3 implementation head** |
| (docs commit) | M3 docs finalize: this ledger update |

- Active branch for this session: `runtime/m3-github-readonly` (created from exactly `7af32ed`; verified).
- The security branch `security/m2-1-auth-hardening` is retained as the M2.1/M2.1.1 record (now fully contained in the M2 branch; owner may delete or keep).
- Stray branch `chat/m2-production-auth` (created from `main` by a mis-issued tool call, superseded, unused — **owner cleanup candidate**; no branch-delete tool available to the agent).
- Draft **PR #3** (owner-authorized, CI visibility): head `chat/m2-production-auth-v2`, base `main` — its head commit advanced to `7af32ed` by the owner-authorized consolidation merge. Draft **PR #5** (owner-authorized, CI visibility): head `runtime/m3-github-readonly`, base `chat/m2-production-auth-v2`. Closed PR #4: the consolidation merge record. Draft PR #1 (id 5103611515) unchanged: head `cf26383`, base `main`, open. Draft PR #2 (pre-existing junk-audit cleanup) untouched.

## M2.1 / M2.1.1 OUTCOME (consolidated 2026-11-04)
- **JWT validation gaps closed (M2.1):** finite exp/iat/nbf (NaN, Infinity, `1e999` rejected); future-iat rejection beyond the unchanged 30-second clock skew; `exp > iat` strictly; malformed nbf rejected; integer-overflow defense via the finite bound.
- **Token-purpose policy enforced (M2.1):** interactive user auth accepts ONLY `token_use === "access"`; service/missing/arbitrary purposes fail closed; service privileges never inferred from `sub`.
- **Membership operational boundary documented in source** (`membership-file.cjs`): file-backed, NOT transactional distributed storage; concurrent writers race; scaled deployments require a stronger StorageAdapter (D1, M7); revocation effective for subsequent decisions; corrupt/missing data fails closed.
- **M2.1.1 defect corrected:** `effectiveMaximum = min(configuredMaximum, 3600)` — the one-hour access-token lifetime ceiling is an ABSOLUTE verifier policy; callers may tighten, never loosen; invalid options fail safely to the 3,600 s default. 7 deterministic-clock regression tests (suite 60).
- Full policy documentation: docs/M2-1-AUTH-HARDENING.md; M2.1.1 section in docs/M2-IMPLEMENTATION-NOTES.md.

## M3 OUTCOME (`runtime/m3-github-readonly`)
- **First real execution capability:** `apps/mcp-server/src/runtime/github-readonly.ts` — the `github-readonly` runtime adapter. Allowlist-only named read-only GitHub REST GET operations (`github.read.file`, `.directory`, `.branches`, `.branch`, `.pull_request`, `.commit`); no command strings, no shell, no caller-controlled URLs (adapter builds and segment-encodes every URL itself).
- **Delegated authority mandatory on every execution:** request must present authority (agent + workspace + DelegatedGrant) validated by `validateGrantUse` for THIS operation and workspace, action `"read"`; mismatch/expiry/use-limit/scope fail closed; a successful execution consumes one grant use. Agents never inherit the actor's full authority.
- **Approval-token model consumed:** operations flagged `requiresApproval` demand a single-use, exact-scope approval token verified by an injected verifier (the M2 approvals module); no verifier configured ⇒ denied; replay denied; failed approvals do not consume grant uses. The default registry contains NO approval-gated operations; the hook is proven by tests with a synthetic registry entry.
- **Honest status + fail-closed mapping:** no token/transport ⇒ adapter `unavailable`, every execution refused (nothing simulated); HTTP 401/403/404/422 ⇒ denied; transport failure/timeout/5xx ⇒ unavailable; only 2xx ⇒ executed. Credentials never appear in any result field (test-enforced). Response bodies capped (1 MiB default, honest `response_truncated` note).
- **NOT in M3 (deliberate):** gateway wiring (the adapter is a standalone, unit-tested surface — gateway invocation is a later owner-gated step); service-identity authentication path (agents act under delegated grants; explicit service-auth remains PLANNED); write operations; production credentials; deployment.
- **Test suite:** `tests/github-readonly.test.mjs` — deterministic (injected transport + injected clock; no network, no sleeps); registered as the 9th suite in tests/test-runner.mjs. Coverage: allowlist and injection denial, GET-only enforcement, strict argument contract, URL encoding, mandatory authority, agent/workspace/scope/expiry/use-limit denial, grant-use consumption, credential non-leakage, HTTP mapping, timeout/transport failure, truncation, approval gate (no verifier / no token / single-use with replay denial / wrong scope), honest describe().
- **tsc scope decision (extended):** strict type-check now covers `packages/contracts`, `apps/mcp-server/src/auth/**`, AND `apps/mcp-server/src/runtime/**/*.ts`.

## VERIFIED CI EVIDENCE (actual GitHub Actions runs)
- M1a/M2/M2.1/M2.1.1 run history: see docs/M2-1-AUTH-HARDENING.md and docs/M2-IMPLEMENTATION-NOTES.md (all heads green, including M2.1.1 `cfbd88c` → run 41607318159, every step verified individually).
- **Consolidation head `7af32ed`: runs `41882906752` (push) and `41883033676` (PR #3) — both SUCCESS** (the rebase merge rewrote SHAs only; tree identical to the verified `cfbd88c`).
- **M3 commit `32d4297`: run 41883501673 — FAILURE at the type-check step** (exit 2; two author defects, corrected in `cf89c06`).
- **M3 intermediate heads (`cf89c06`, `9eae883`, `23d03e2`, `630a071`): test-step failures, diagnosed without job logs** (anonymous API quota exhausted) from run-page annotations + code review — four sequential defects: typecheck errors (`cf89c06` fix), three test-harness assumptions (`23d03e2` fix), a real adapter defect (approval check missing `actor_id` — `630a071` fix; the M2 approvals law is actor-bound and the adapter must present the delegating actor from the grant), and a validation-order test bug (expiry checked before use limits — `2698192` fix).
- **M3 FINAL head `2698192`: runs 41884831543 (push) + 41884842532 (PR #5 synchronize) — SUCCESS** (test-job success ⇒ every step green: tsc --noEmit over the extended scope, all 9 test suites incl. the github-readonly suite, failure-marker guard, deployment smoke; run page shows no error annotations).
- Verification method note: the authoring environment has no git and no node; all test evidence is GitHub Actions only, read via the GitHub App connector (`pull_request_read.get_check_runs` on owner-authorized draft PRs #3/#5). Per-test logs are not readable from the authoring environment. No success is reported from a Vercel check or a partially completed workflow.

## NOT VERIFIED / UNTESTED (honest limits)
- The authoring environment has NO git and NO node; tests ran ONLY in GitHub Actions (CI runner aggregate; per-suite standalone invocation unverified here).
- `apps/mcp-server/src/mcp-gateway.ts` and the provider `.cjs` files remain OUTSIDE the tsc scope (runtime type-stripping only); extending tsc to them is still a recorded next decision. The new `runtime/github-readonly.ts` IS in scope.
- Token denylist, approval redemption and grant state are per-process in-memory (short TTLs + the absolute 1-hour ceiling bound the windows); durable versions arrive with D1 (M7).
- OAuth/OIDC external identity-provider adapter (PKCE, JWKS rotation): PLANNED.
- Service-identity authentication path: PLANNED (deliberately not improvised).
- The github-readonly adapter is NOT wired into the gateway or any request path; no real GitHub token exists in any environment (none created — owner-gated).
- No performance/load testing; no penetration testing beyond the negative test matrices.

## KNOWN DEFECTS & PROPOSED FIXES
1. ~~Gateway never executed at runtime~~ — fixed (M1a, verified in CI).
2. ~~Provider .js/.cjs module-format debt~~ — fixed + test-enforced (M1a).
3. ~~Test runner unconditional process.exit(0)~~ — fixed (M1a).
4. ~~Empty default membership wiring~~ — fixed (M1a).
5. ~~No production-mode enforcement~~ — fixed (M1a), upgraded to real production authentication (M2).
6. Audit console-only — open (production: durable append-only AuditSink; D1 at M7).
7. ~~No type-check step~~ — fixed (M2 P0; scope extended to runtime adapters in M3).
8. ~~Dev principals/membership are the only fixtures~~ — fixed (M2).
9. ~~JWT validation gaps~~ — fixed (M2.1, CI run 41337292376).
10. ~~M2.1 lifetime ceiling defect~~ — fixed (M2.1.1, CI run 41607318159).
11. ~~No runtime execution capability anywhere~~ — fixed (M3: allowlisted, delegated-authority-gated, read-only GitHub adapter; standalone, not gateway-wired by design).

## ARCHITECTURAL DECISIONS RECORDED (M2 and later)
1. ~~TS type-checking strategy~~ — decided & implemented; scope extended incrementally (contracts + auth + runtime adapters as of M3).
2. Durable append-only audit storage — AuditSink contract exists; D1 at M7.
3. ~~Production authentication/membership~~ — decided & implemented (M2). External IdP/OAuth-OIDC adapter remains planned.
4. Runtime command execution security: allowlisted named operations over unrestricted command strings (implemented M3 as read-only GitHub GETs); approval tokens are signed, scoped, single-use, expiring (M2 modules; consumed by the M3 adapter hook).
5. Operator Screen event feed: typed OrchestrationEvent schema onto the shared source of truth; Operator Screen subscribes read-only; takeover is a control-plane command. Current event surface remains audit-only.
6. Browser-session ownership/user takeover (Cloud Computer): single explicit owner at a time; atomic, audited ownership transfer; owned-session state machine in the shared source of truth.
7. Shared source of truth: one durable workspace store (StorageAdapter contract is the seam) linking identity → membership → project → task → delegation/execution session → approvals → events; RBAC/workspace isolation applies to all readers and writers.
8. (M2.1) Token policy: clock skew stays 30 seconds; interactive user auth accepts ONLY `token_use === "access"`; a service-auth path, when built, is separate and separately tested.
9. (M2.1.1) The one-hour access-token lifetime ceiling is an ABSOLUTE verifier policy (`min(configured, 3600)`); raising it requires a code change plus explicit owner decision.
10. (2026-11-04, owner decision) **Consolidation:** the M2.1/M2.1.1 security branch was merged into `chat/m2-production-auth-v2` (PR #4, rebase merge) and the owner authorized the full M3→M7 roadmap pass. `main` remains human-merged.
11. (M3) Runtime adapters execute ONLY allowlisted named operations under mandatory delegated authority; read-only first; writes (when ever introduced) require the approval-token gate and an explicit owner decision.

## DECISIONS & CONVENTIONS
- Extend, do not replace, the M1a/M2 foundation. `remRADAR/RADARMatrix` is canonical; `remRADAR/RADARSite` is untouchable.
- **RADAR is the master intelligence identity — never Jarvis — in all new documentation, architecture descriptions and implementation.**
- Module format law: `.cjs` = provider implementation source of truth; `.js` = ESM re-export wrapper only; `.ts` under `"type": "module"` = ESM, erasable syntax only; type-only exports MUST use `export type`; relative TS imports keep explicit `.ts` extensions (allowImportingTsExtensions).
- Runtime-mode law: `RADARMATRIX_RUNTIME_MODE=production` + complete config = real production chain; ANY incomplete config fails closed with empty registries. Development fixtures are unreachable in production mode.
- Identity law: a decoded/unsigned token payload is NEVER an identity; roles NEVER come from token claims; workspace_id in a request is NEVER proof of membership.
- Token law (M2.1/M2.1.1): finite exp/iat/nbf; future iat beyond 30 s skew rejected; exp strictly after iat; ABSOLUTE 1-hour ceiling (tightenable, never loosenable); malformed nbf rejected; purpose enforced exactly where required.
- Membership law: explicit map only, fail closed, no wildcard/fallback; unknown roles rejected at grant time; file-backed provider is interim single-instance storage.
- Delegation law: grants are subset-enforced, single-agent, single-workspace, short-TTL (≤ 4 h), use-limited; agents never inherit full actor authority; RADAR included.
- Approval law: signed, exact-scope, short-TTL (≤ 30 min), single-use; replay denied; adapters verify before executing.
- Runtime law (M3): allowlisted named operations only; delegated authority mandatory on every execution; read-only first; honest `unavailable` when unconfigured — never simulated.
- Test law: every suite propagates failures to exit codes; CI primary signal = exit codes (pipefail-preserved); captured log uploaded as artifact on failure; deterministic clocks/transports — no sleeps.
- Status vocabulary: implemented / tested / verified-in-CI / connected / simulated / planned / blocked / unavailable.
- All agent writes approval-gated; `main` is human-merged; substantial changes land on isolated branches; PRs are opened/merged only with an explicit owner decision (PR #3 and PR #5 were authorized for CI visibility; PR #4's merge was an explicit owner decision).

## DO NOT TOUCH
- The two v0.9 branches (`v0.9-production-hardening`, `v0.9-security-gate`) — no merge/delete until the owner approves the retirement strategy.
- PR #1 head/base; `phase1/discovery-and-foundation`; `chat/m1a-pr-review-followup`; `security/m2-1-auth-hardening` (M2.1/M2.1.1 record — now consolidated; deletion is owner-gated); `apps/brand-studio/` until `apps/matrix-ide/` reaches parity; `apps/mcp-server/` security pipeline semantics (extend, never weaken); `remRADAR/RADARSite`; production deployments, DNS, the shared Cloudflare account.
- `packages/contracts` contract law — future adapters must satisfy it without weakening the fail-closed model.

## PENDING OWNER APPROVALS / DECISIONS
1. ~~Disposition of M2.1/M2.1.1~~ — RESOLVED (2026-11-04): consolidated into the M2 branch (PR #4).
2. Disposition of `chat/m2-production-auth-v2` and draft PR #3 (merge to `main` remains owner-gated).
3. Stray branch `chat/m2-production-auth` deletion — **owner-only** (no branch-delete tool available to the agent). Also now pending: whether to keep or delete `security/m2-1-auth-hardening` and PR #5 after review.
4. External identity-provider choice (OAuth/OIDC with PKCE, JWKS rotation) for staging.
5. Durable token denylist / approval redemption / audit storage (D1, M7 timing).
6. Extending tsc scope to the gateway + provider `.cjs` files.
7. Gateway wiring of the github-readonly runtime adapter (M4 candidate) — owner-gated before any request path can invoke execution.
8. A least-privilege GitHub token for real adapter operation (none created — owner-gated; repository-scope read-only when granted).
9. v0.9 branch retirement strategy; PR #1 merge (human-gated); PR #2 (junk-audit) disposition.

## NEXT STEPS (ordered)
1. ~~M2.1.1 owner review~~ — done; consolidation + roadmap pass authorized (2026-11-04).
2. ~~M3 github-readonly runtime adapter~~ — implemented and CI-verified on `runtime/m3-github-readonly` (this session).
3. M4 (owner-gated): wire the runtime adapter into the gateway behind a RuntimeExecutionRequest contract + approval enforcement for any consequential operation; explicit service-identity authentication path when agents authenticate in production.
4. IdP adapter selection + implementation (PKCE, JWKS) when staging identities are needed.
5. Durable store (D1 at M7): memberships, grants, approvals, redemption records, audit events.
6. M5+ (vision components, only after owner-approved specifications): Operator Screen, RADAR Chat routing, Cloud Computer, per the recorded decisions above.
7. Owner housekeeping: delete stray branch `chat/m2-production-auth`; decide PR #3/#5 disposition; v0.9 retirement.
