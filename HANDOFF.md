# HANDOFF — RADARMatrix

## CURRENT STATE
- Last updated: 2026-11-01 — Mistral Vibe (Lead Architect session, operating under the RADARMatrix master directive)
- Phase: Phase 0 complete (discovery + architecture); **M1 pre-implementation review complete** (`docs/M1-PRE-IMPLEMENTATION-REVIEW.md`)
- Branch: `phase1/discovery-and-foundation` (cut from `main` @ `93c1dc1`; adds docs, HANDOFF, CI workflow). Draft **PR #1**.
- Uncommitted changes: none. No merges, branch deletions, production actions, Cloudflare resource changes, or RADARSite modifications have been performed.

## M1 REVIEW OUTCOME (2026-11-01)
- **`v0.9-production-hardening` (@ `38f66f1`)** → recommend **RETIRE**: loose-provider semantics (unknown caller → viewer; membership dev-fallback) are a security regression vs main's strict fail-closed providers; gateway refactor conflicts with main's evolution. Salvage the interface-abstraction concept into `packages/contracts/` as new code. **Awaiting owner approval — no action taken.**
- **`v0.9-security-gate` (@ `e121c11`)** → recommend **REWRITE then RETIRE**: its 326-line integration test is unrunnable as authored (imports nonexistent `DevelopmentAuthorizationProvider`, 2-arg `isAuthorized` vs main's 3-arg, branch lacks `authorization.js`). Treat as spec; rewrite against main's real API in M1a. **Awaiting owner approval — no action taken.**
- **Tests executed for real** via GitHub Actions CI (public-repo free tier): `npm test` (all 4 suites) + `npm run test:deployment` on Node 22 — **zero `✗` failures**, check-run conclusion success (runs `41266101789`, `41266105344` @ `2fec44d`). Local Node execution impossible in the authoring sandbox (no node/npm).
- **CI workflow added** (`.github/workflows/ci.yml`): Node 22, `npm test` + deployment smoke, **fails on any `✗` line** — required because the legacy runner calls `process.exit(0)` unconditionally.

## VERIFIED FACTS
- `remRADAR/RADARMatrix` `main` @ `93c1dc1` (2026-10-28): MCP gateway pipeline (auth → RBAC → workspace isolation → audit → execute), 9 JSON-schema-validated MCP tool contracts, agent registry + deterministic plan-only router, Brand Studio (vanilla HTML/JS/CSS + Node `server.mjs`), sandboxed live-preview iframe, JSON WorkspaceStore, Supabase migration (project retired/deleted; local JSON store is the dev runtime), Vercel config. Zero npm runtime dependencies.
- `apps/agent-skills/registry.json`: **9 agent profiles** (`radar_orchestrator` coordinator + 8 specialists), **11 skills**, 8 routes; plan-only limits (≤2 specialists, ≤4,000 chars). (Earlier docs said "13 specialists" — corrected in this branch.)
- Branch topology: common base `57575f3` (v0.8, 2026-08-18 09:52); main hardening commits `fea32ae`/`9d0e2bd`/`94be71c`/`60f9a32`/`0b7f3be` (10:20–10:32); prod-hardening forked from base (10:10–10:11); security-gate forked from main @ `94be71c` (10:38).
- Main's providers are **strict/fail-closed** (4 allowlisted principals: `admin_123`, `editor_456`, `contributor_789`, `viewer_000`; explicit membership map). Prod-hardening's are **loose** (fail-open).
- Cloudflare D1 Workers Free (verified 2026-10-30): 5M rows read/day, 100k rows written/day, 5 GB storage, 10 databases. Workers Free: 100k requests/day, 10 ms CPU/invocation; static assets free.
- GitHub Codespaces free quota is personal-account only: 120 hrs compute/month + 15 GB-month storage; organizations get NO free quota; usage is blocked (not billed) without a payment method.
- GitHub Actions: free for public repositories (used for CI — no cost introduced).

## M1 DEFECTS DISCOVERED (details in docs/M1-PRE-IMPLEMENTATION-REVIEW.md §B)
1. Provider module-format debt: `providers/*.js` use `module.exports` while `package.json` is `"type": "module"` — `.js` copies break under ESM import (`.cjs` duplicates exist). The gateway has never been exercised at runtime.
2. `tests/v0.7-gateway.test.mjs` re-implements gateway logic inline instead of importing `mcp-gateway.ts` — the security pipeline is untested at runtime.
3. `tests/test-runner.mjs` calls `process.exit(0)` unconditionally; suites swallow assertion errors as `✗` log lines — green CI alone did not prove passing tests (CI now fails on `✗` as a workaround; permanent fix in M1a).
4. Audit logging is console-only (production needs a durable append-only sink).
5. No `engines` field; no TS type-check step anywhere (acceptable for now; revisit at M2).

## DECISIONS & CONVENTIONS
- Extend, do not replace, the v0.8 foundation. No duplicate repositories; RADARMatrix evolves in place in `remRADAR/RADARMatrix`.
- `remRADAR/RADARSite` is untouchable. `remRADAR/remradar` is a separate product, not Matrix code.
- Execution/terminal capabilities must come from real runtime adapters (`github-readonly` → `codespaces` → `local-bridge`). Never simulate command execution.
- Hosting stays portable; the Cloudflare D1 adapter lands at milestone M7. Vercel config remains valid until then.
- First agent is a deterministic Repo Inspector over the read-only GitHub adapter. LLM-backed agents deferred until a verified free model provider is authorized by the owner.
- Status vocabulary everywhere: implemented / connected / simulated / planned / unavailable.
- All agent writes are approval-gated; `main` is human-merged; substantial changes land on isolated branches with draft PRs.
- CI is the test-execution environment of record; a green check must mean "no `✗` lines" until the runner is fail-fast.

## DO NOT TOUCH
- `apps/brand-studio/` — keep working until `apps/matrix-ide/` reaches parity, then retire via reviewed PR.
- `apps/mcp-server/` security pipeline semantics — extend, never weaken.
- `remRADAR/RADARSite`, all production deployments, DNS, and the shared Cloudflare account's existing projects.
- The two v0.9 branches — no merge/delete until the owner approves the §E strategy.

## PENDING OWNER APPROVALS
1. Branch-retirement strategy (M1 review §E): retire `v0.9-production-hardening`; rewrite-then-retire `v0.9-security-gate`.
2. Confirmation that `remRADAR/RADARMatrix` is the canonical repo.
3. Permanent retention of the CI workflow (and its strict `✗` behavior).
4. Authorization to begin M1a (see NEXT STEPS).
5. Later (M3): fine-grained read-only GitHub token, stored server-side.
6. Later (M7): Cloudflare D1 database creation.

## NEXT STEPS (ordered)
1. Owner approves the branch strategy → retire both v0.9 branches; record the action here.
2. **M1a — Foundation consolidation** (smallest safe coding milestone, on this branch): `packages/contracts/` (RuntimeAdapter / StorageAdapter / AgentAdapter + honest `unavailable` stubs); fix provider module-format debt so the gateway is runtime-executable; fail-fast test runner; new `tests/v0.9-integration-security.test.mjs` against main's real API (porting the security-gate branch's intent).
3. Then M2 control plane (`apps/control-plane/`) per `docs/PHASE1-BUILD-PLAN.md`.
4. Then M3 `github-readonly` adapter; M4 IDE shell — every panel backed by a real API or an explicit honest empty state.
