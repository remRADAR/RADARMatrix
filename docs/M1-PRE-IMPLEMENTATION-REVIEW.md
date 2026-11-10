# RADARMatrix — M1 Pre-Implementation Review

**Product:** RADARMatrix — AI Development Operating System / Agent Orchestration Platform
**Organization:** RADARCharts by REM · **Owner:** CZA OF REM
**Repository:** `remRADAR/RADARMatrix` (canonical — independent of `remRADAR/RADARSite`)
**Prepared:** 2026-11-01 · **Branch:** `phase1/discovery-and-foundation` · **PR:** #1 (draft)

> **Scope:** inspection and validation only. No merges, branch deletions, production actions, Cloudflare resources, RADARSite changes, paid services, or destructive changes. **No branch action has been performed** — every recommendation below awaits explicit owner approval.

---

## A. v0.9 Branch Comparison

### A.1 Branch topology (verified by direct commit inspection)

Common base of all branches: `57575f3` (v0.8, 2026-08-18 09:52).

| Branch | Head | Commits beyond base/parent | Forked from |
|---|---|---|---|
| `main` | `93c1dc1` (2026-10-28) | 5 hardening commits on 2026-08-18 10:20–10:32 (`fea32ae`, `9d0e2bd`, `94be71c`, `60f9a32`, `0b7f3be`) + Sep–Oct feature work | base |
| `v0.9-production-hardening` | `38f66f1` | 2 commits: `db03eff` (10:10), `38f66f1` (10:11) | base |
| `v0.9-security-gate` | `e121c11` | 1 commit: `e121c11` (10:38) | main @ `94be71c` |

### A.2 `v0.9-production-hardening` (@ `38f66f1`) — recommendation: RETIRE

**Contents (verified):**
- `db03eff` — provider abstractions: small providers (`authentication.js` 1,228 B · `authorization.js` 863 B · `membership.js` 808 B), `repositories/interfaces.ts` (+25 lines: MemoryRepository, DecisionRepository, SearchRepository, AuditSink, RateLimiter interfaces), `mcp-gateway.ts` refactor (+27/−53).
- `38f66f1` — ESM export fixes + `tests/v0.9-auth.test.mjs` (+41 lines).

**Purpose:** extract provider seams so auth/authorization/membership become swappable — the right *concept*, ahead of main.

**Security assessment — the branch REGRESSES security:**
- Its providers use **LOOSE semantics**: unknown caller → `viewer` role; membership dev-fallback accepts any authenticated user in a workspace. Its own test asserts these loose semantics.
- Main's equivalents (landed 8–20 minutes later) are **STRICT and fail-closed**: exactly 4 allowlisted principals (`admin_123`, `editor_456`, `contributor_789`, `viewer_000`), unknown callers rejected; explicit membership map with no fallback.
- Merging would silently weaken authentication and workspace isolation.

**Other conflicts:** its gateway refactor (+27/−53) conflicts with main's subsequent evolution; `repositories/interfaces.ts` is conceptually superseded by main's `runtime/` store modules; the ESM fixes are obsoleted by main's current state.

**Salvage:** the interface-abstraction *concept* (swappable providers + AuditSink) belongs in `packages/contracts/` (M1a) — as new code against main, not by cherry-picking branch files.

### A.3 `v0.9-security-gate` (@ `e121c11`) — recommendation: REWRITE then RETIRE

**Contents (verified):** single commit adding `tests/v0.9-integration-security.test.mjs` (+326 lines). The branch's `providers/` contains only `authentication.js` + `membership.js` — **no authorization.js**.

**The test is unrunnable as authored on any branch:**
1. Imports `DevelopmentAuthorizationProvider` — exists nowhere; main exports `DefaultAuthorizationProvider`.
2. Calls `isAuthorized(identity, tool)` (2-arg) — main's API is 3-arg: `isAuthorized(principal, toolRegistry, toolName)`.
3. References an authorization provider its own branch does not ship.

**Value:** its 326 lines enumerate integration-security scenarios (auth failure, privilege escalation, workspace isolation, write-gating). Treat it as a **specification**, not code: rewrite the intended coverage as a new runnable test against main's actual API in M1a, then retire the branch.

### A.4 Overlap and conflict summary

- Both branches create overlapping `providers/` files that conflict with each other and with main's (which landed minutes later and has since evolved further).
- Nothing in either branch is missing from main except: the loose providers (inferior — do not merge), the `interfaces.ts` concept (salvage into contracts), the ESM export fixes (obsoleted), and the security-test spec (rewrite).
- **No code from either branch should be merged or cherry-picked.** Recommendations in §E.

---

## B. Security and Architecture Findings (main @ `93c1dc1`)

**Strengths (verified):**
- 8-stage gateway pipeline (validate → authenticate → membership → authorize → execute → audit → validate response) with defensive error handling that never leaks internal exception messages, and a workspace-mismatch check between context and params.
- Strict fail-closed providers: 4-principal allowlist, explicit membership map, role hierarchy (viewer=1 → admin=4).
- `brand-studio/server.mjs`: production fails closed (503 `AUTH_CONFIGURATION_REQUIRED` / `STORAGE_CONFIGURATION_REQUIRED`), safePath traversal guard, 256 KB payload cap, nosniff, `mutations_paused` flag, emergency-stop route.
- `agent-routing.cjs`: registry validation, bounded plan-only routing (≤2 specialists, ≤4,000 chars), path-escape guard on skill loading.

**Weaknesses and defects (new findings of this review):**
1. **Module-format debt:** `providers/*.js` use `module.exports` (CJS semantics) while `package.json` declares `"type": "module"` — the `.js` copies break under ESM import; `.cjs` duplicates exist. The gateway's own `require()` calls also cannot run under ESM. Consequence: the gateway has never been exercised at runtime.
2. **The security pipeline itself is untested at runtime.** `tests/v0.7-gateway.test.mjs` re-implements the expected logic inline instead of importing and exercising `mcp-gateway.ts`. The suites pass, but they do not execute the code they claim to test. (Same self-referential pattern in parts of the contract suite.) This is the review's most important quality finding.
3. **The test runner cannot fail:** suites catch assertion errors and print `✗`; `tests/test-runner.mjs` calls `process.exit(0)` unconditionally. Green CI ≠ passing tests. Mitigated meanwhile by the strict CI grep (§C); permanent fix in M1a.
4. **Audit is console-only** (write ops to stdout). Production requires append-only durable audit storage (the `AuditSink` concept belongs in contracts).
5. No `engines` field declared; the `.ts` sources are never type-checked or compiled in any automated step (no TS toolchain in CI) — acceptable at zero budget for now; revisit at M2.
6. Dev principals are hardcoded fixtures — fine for dev, must never reach production; the provider seam is where production auth (OAuth/OIDC) plugs in.

---

## C. Test Execution Results

**Local execution: BLOCKED.** The authoring environment has no Node.js or npm (`node: command not found`, rc 127). Required environment: Node.js ≥ 22 LTS. Note: the `npm test` chain imports only `.mjs` / `.cjs` / `.json` — no TypeScript loader is needed for the current suites.

**Real execution — GitHub Actions CI (free for public repositories):** added `.github/workflows/ci.yml` on this branch (commits `07b4c4c`, then strict version `2fec44d`). The workflow runs `npm test` and `npm run test:deployment` on ubuntu-latest / Node 22 and **fails if any `✗` failure line appears** — this is necessary because the legacy runner exits 0 unconditionally (finding B.3).

**Results (head `2fec44d`, runs `41266101789` [push event] and `41266105344` [PR event], completed 2026-11-01 02:39 UTC):**

| Suite | Status |
|---|---|
| v0.7 gateway suite (`npm test`) | **Executed — zero `✗` failures** |
| v0.8 ChatGPT contract suite (`npm test`) | **Executed — zero `✗` failures** |
| agent-routing suite (`npm test`) | **Executed — zero `✗` failures** |
| brand-gateway-routing suite (`npm test`) | **Executed — zero `✗` failures** |
| deployment smoke (`npm run test:deployment`) | **Executed — zero `✗` failures** |

Check-run conclusions: **success** on both runs (a success genuinely means no `✗` lines were present, by construction of the workflow).

**Honest caveats:** (1) "Passing" means the suites as authored pass — the v0.7 gateway suite does not exercise the actual `mcp-gateway.ts` (finding B.2), so the security pipeline remains runtime-unverified. (2) The "18 gateway / 38 contract" test counts remain the suites' own claims; CI verified zero failures, not per-test enumeration. (3) The strict-grep is a workaround until the runner is made fail-fast in M1a.

---

## D. Reusable Modules and Implementation Dependencies

| Module | Path | Supports | M1 dependency |
|---|---|---|---|
| Gateway pipeline | `apps/mcp-server/src/mcp-gateway.ts` | Matrix Core request spine | Make runtime-executable (B.1); add real integration tests (B.2) |
| Strict providers | `apps/mcp-server/src/providers/*.cjs` | Auth/RBAC seams | Consolidate `.cjs` as source of truth; add ESM wrappers |
| Tool contracts | `apps/mcp-server/src/chatgpt-app-contract.ts` | Matrix tool registry (9 tools) | Type-check target for M2 |
| Agent registry + router | `apps/agent-skills/registry.json`, `agent-routing.cjs` | Matrix Agents (Layer C) seed: 9 agent profiles (1 coordinator + 8 specialists), 11 skills, 8 routes, plan-only bounds | Extend with agent profiles; keep plan-only limits |
| WorkspaceStore / BrandGateway | `apps/mcp-server/src/runtime/*.mjs` | StorageAdapter pattern (JSON dev store, Supabase adapter reference) | Mirror interface in `packages/contracts/` |
| Brand Studio server | `apps/brand-studio/server.mjs` | Control-plane HTTP reference (fail-closed patterns) | Reuse patterns in `apps/control-plane/` |
| Test harness | `tests/*.mjs` | CI baseline | Make fail-fast; add gateway integration suite |

**Dependency order for M1:** contracts → provider module-format fix → fail-fast runner + real gateway integration test → only then is M2 safe to build on a verified spine.

---

## E. Recommended Branch Strategy (awaiting owner approval — nothing executed)

1. `v0.9-production-hardening` → **RETIRE.** Its loose-provider semantics are a security regression vs main; its gateway refactor conflicts with main's evolution; its interfaces concept is salvaged into `packages/contracts/` as new code. No merge, no cherry-pick.
2. `v0.9-security-gate` → **REWRITE then RETIRE.** Port its test intent into a new runnable integration-security test against main's actual API (M1a), then retire the branch.
3. "Retire" means branch deletion only after explicit owner approval, with the decision recorded in `HANDOFF.md`. Until then, both branches stay untouched.

---

## F. M1 Implementation Readiness

**READY**, contingent on the owner approvals in §G. Verified foundation: strict security pipeline (needs runtime wiring, B.1–B.2), deterministic plan-only router, JSON workspace store, zero-dependency test culture, and now a real, honest CI signal. Blocking gaps before M2: the gateway is not runtime-exercised, the test runner cannot fail, and the provider module-format defect. All three are addressed by the smallest coding milestone (§H).

---

## G. Outstanding Owner Decisions

1. **Approve the branch-retirement strategy** (§E) — nothing will be merged or deleted until approved.
2. **Confirm `remRADAR/RADARMatrix` as the canonical repository** (identity corrected in all Phase 1 docs; no other identity errors found).
3. **Approve keeping the CI workflow** (and its strict `✗` behavior) permanently.
4. **Authorize the first coding milestone** (§H).
5. Later (M3): creation of a server-side, fine-grained, read-only GitHub token.
6. Later (M7): creation of the Cloudflare D1 database.

---

## H. Smallest Safe Coding Milestone to Begin Next

**M1a — Foundation consolidation** (no product features, no infrastructure, all on this branch behind PR #1 review):

1. `packages/contracts/`: `RuntimeAdapter`, `StorageAdapter`, `AgentAdapter` type contracts + honest `unavailable` stubs.
2. Fix the provider module-format debt (`.cjs` source of truth / ESM wrappers) so the gateway becomes runtime-executable.
3. Fail-fast test runner: propagate assertion failures to the exit code; remove the unconditional `process.exit(0)`; keep the strict CI.
4. New `tests/v0.9-integration-security.test.mjs` written against main's real API — porting the intent of the security-gate branch (its 326-line spec) as runnable code.

**Acceptance criteria:** CI green including the new suite; the gateway executed at runtime by tests for the first time; zero regressions in existing suites; every change reviewable in PR #1; no merges to `main` without owner approval.

---

*Statuses in this report follow the implemented / connected / simulated / planned / unavailable classification. Test results were machine-executed via GitHub Actions and reported honestly, including their caveats. Nothing here claims a capability that was not verified.*
