# HANDOFF — RADARMatrix

## CURRENT STATE
- Last updated: 2026-11-01 — Mistral Vibe (Lead Architect session, operating under the RADARMatrix master directive and the owner's M1a implementation authorization)
- Phase: Phase 0 complete; M1 pre-implementation review complete; **M1a foundation consolidation IMPLEMENTED and CI-verified** (see docs/M1A-IMPLEMENTATION-NOTES.md)
- Branch: `phase1/discovery-and-foundation` (head `cb7b082` = M1a implementation). Draft **PR #1** (updated with the M1a summary).
- Uncommitted changes: none. **No merges, no branch deletions, no production actions, no Cloudflare resources, no RADARSite modifications, no paid services.** The owner's M1a directive explicitly forbade deleting/retiring the v0.9 branches — both remain untouched.

## M1a OUTCOME (2026-11-01)
- **Gateway is now runtime-executable and executed by tests.** Converted `mcp-gateway.ts` from `require`/`module.exports` (broken under `"type": "module"`) to ESM; providers keep `.cjs` as the single source of truth; the `.js` provider files are now ESM re-export wrappers; `chatgpt-app-contract.ts` type-only exports moved to `export type` (Node type stripping requirement).
- **Latent defect found & fixed:** the gateway wired the membership provider with NO members — with the (correct) fail-closed model, EVERY request would have been WORKSPACE_FORBIDDEN. Fixed with `defaultDevelopmentMembership()` — an explicit fail-closed dev fixture (4 principals → w_dev only). No permissive fallback added.
- **Fail-fast testing:** v0.7/v0.8 suites now count failures (8 + 9 sites instrumented) and return `{ failed }`; runner (rewritten) aggregates 5 suites and exits 1 on any failure; standalone suite runs exit non-zero; CI primary signal = exit codes, secondary guard rejects swallowed ✗ lines.
- **Real security integration suite:** `tests/gateway-integration-security.test.mjs` — 15 tests importing the REAL gateway: authorized read/write, role enforcement (viewer/contributor/editor), unknown principal rejection, workspace mismatch rejection, fail-closed membership, invalid tool/missing field/missing context rejection, audit SUCCESS and FAILED(FORBIDDEN) event generation, plan-only routing invariants, defensive response validation with internal-leak detection.
- **Contracts package:** `packages/contracts/` — type-only interfaces (AuthenticationProvider, MembershipProvider, AuthorizationProvider, AuditSink, StorageAdapter, RuntimeAdapter, AgentAdapter, RateLimiter) + binding contract law + honest status table.
- **package.json:** version 0.9.0; `engines.node >= 22.18`; `test:security` script.

## VERIFIED FACTS (all machine-verified unless noted)
- CI on M1a commit `cb7b082`: runs `41266518476` (push) + `41266514467` (PR), ubuntu-latest / Node 24 — **conclusion: success** (2026-11-01 02:46 UTC). Mechanically: all 5 suites reported zero failures and none threw; deployment smoke passed (503 fail-closed); zero swallowed ✗ lines.
- The real gateway executed in CI for the first time: ESM load via Node type stripping, CJS named-import interop for `.cjs` providers (cjs-module-lexer), full 8-stage pipeline per request.
- Registry: 9 agent profiles (`radar_orchestrator` + 8 specialists), 11 skills, 8 routes; plan-only limits (≤2 specialists, ≤4,000 chars) — verified through the real gateway (test 12: executionMode=plan_only, execution.started=false, providerConfigured=false).
- Prior verified facts (branch topology, provider semantics, free-tier quotas) remain as recorded in docs/M1-PRE-IMPLEMENTATION-REVIEW.md and docs/PHASE0-DISCOVERY-REPORT.md.

## NOT VERIFIED / UNTESTED
- Per-test pass counts inside suite logs were not individually readable from the authoring environment; the CI success is exit-code-enforced (runner exits 1 on any failure). Logs viewable at the Actions run URLs.
- `.ts` sources are NOT type-checked in CI (executed via type stripping only). No `tsc` step exists yet.
- Tool execution remains deterministic dev stubs (no persistence). The security pipeline is real; storage is not.

## KNOWN DEFECTS & PROPOSED FIXES
1. ~~Gateway never executed at runtime~~ — **fixed (verified in CI)**.
2. ~~Provider .js/.cjs module-format debt~~ — **fixed** (.cjs source of truth + ESM wrappers; verified via import in CI).
3. ~~Test runner unconditional process.exit(0)~~ — **fixed** (exit-code-enforced, CI green).
4. ~~Empty default membership wiring (all requests would be WORKSPACE_FORBIDDEN)~~ — **fixed** with explicit dev fixture.
5. Audit console-only — open (production: durable append-only AuditSink per packages/contracts).
6. No type-check step — open (M2 decision).
7. Dev principals/membership are fixtures — open (production providers per contracts; M2+).

## DECISIONS & CONVENTIONS
- Extend, do not replace, the v0.8 foundation. `remRADAR/RADARMatrix` is canonical; `remRADAR/RADARSite` is untouchable.
- Module format law: `.cjs` = provider implementation source of truth; `.js` = ESM re-export wrapper only; `.ts` under `"type": "module"` = ESM, erasable syntax only (no enums/namespaces/parameter properties) until a TS toolchain exists; type-only exports MUST use `export type`.
- Membership law: explicit map only, fail closed, no wildcard/fallback. New workspaces/callers require explicit fixture/config entries.
- Test law: every suite must propagate failures to exit codes. CI green must mean "no failures", enforced by exit codes first, output guard second.
- Execution/terminal capabilities only via real runtime adapters (`github-readonly` → `codespaces` → `local-bridge`). Never simulate command execution.
- Status vocabulary: implemented / connected / simulated / planned / unavailable.
- All agent writes approval-gated; `main` is human-merged; substantial changes land on isolated branches with draft PRs.

## DO NOT TOUCH
- The two v0.9 branches (`v0.9-production-hardening`, `v0.9-security-gate`) — no merge/delete until the owner approves the M1 review §E strategy (M1a directive explicitly deferred this).
- `apps/brand-studio/` until `apps/matrix-ide/` reaches parity; `apps/mcp-server/` security pipeline semantics (extend, never weaken); `remRADAR/RADARSite`; production deployments, DNS, the shared Cloudflare account.
- `packages/contracts` contract law — future adapters must satisfy it without weakening the fail-closed model.

## PENDING OWNER APPROVALS
1. v0.9 branch retirement strategy (M1 review §E) — deferred by the M1a directive, still awaiting decision.
2. PR #1 merge (human-gated owner review of Phase 0 docs + M1 review + M1a implementation).
3. Production auth/membership provider work (M2); runtime adapter + read-only GitHub token (M3); D1 database (M7).

## NEXT STEPS (ordered)
1. Owner reviews PR #1 (Phase 0 docs + M1 review + M1a implementation, CI green).
2. Owner decides the v0.9 branch strategy; then retire branches per approved strategy (record here).
3. M2: control plane (`apps/control-plane/`) + production auth/membership provider design against `packages/contracts`; add TS type-check toolchain decision.
4. M3: `github-readonly` runtime adapter (first real execution capability).
