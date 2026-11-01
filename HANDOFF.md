# HANDOFF — RADARMatrix

## CURRENT STATE
- Last updated: 2026-11-01 — Mistral Vibe (Lead Architect session, operating under the RADARMatrix master directive)
- Phase: Phase 0 complete (discovery + architecture); Phase 1 documentation groundwork started
- Uncommitted changes: none on `main`; this branch (`phase1/discovery-and-foundation`, cut from `main` @ `93c1dc1`) adds `HANDOFF.md`, `docs/PHASE0-DISCOVERY-REPORT.md`, `docs/PHASE1-BUILD-PLAN.md`
- Branch: `phase1/discovery-and-foundation`

## VERIFIED FACTS
- `remRADAR/RADARMatrix` `main` @ `93c1dc1` (2026-10-28, "feat: add RADAR agent routing and preview panels") contains: MCP gateway pipeline (auth → RBAC → workspace isolation → audit → execute), 9 JSON-schema-validated MCP tool contracts, agent registry + deterministic plan-only router, Brand Studio (vanilla HTML/JS/CSS + Node `server.mjs`), sandboxed live-preview iframe, JSON WorkspaceStore, Supabase migration `supabase/migrations/001_radarmatrix_workspace.sql`, Vercel config, test suites (18 gateway + 38 contract + agent-routing + brand-gateway-routing + deployment-smoke). Zero npm runtime dependencies.
- Branches `v0.9-production-hardening` @ `38f66f1` and `v0.9-security-gate` @ `e121c11` exist with unmerged provider-abstraction work (dev-auth/authorization/membership providers, ESM exports, dated 2026-08-18 10:10–10:11, not present in `main`'s history).
- Cloudflare D1 Workers Free (docs, 2026-10-30): 5M rows read/day, 100k rows written/day, 5 GB storage, 10 databases.
- Cloudflare Workers Free: 100k requests/day, 10 ms CPU per invocation; static assets free.
- GitHub Codespaces free quota is personal-account only: 120 hrs compute/month + 15 GB-month storage; organization/enterprise plans include NO free quota; usage is blocked (not billed) when quota is exhausted without a payment method.
- The Supabase project referenced by `docs/DEPLOYMENT.md` is retired/deleted; the local atomic JSON `WorkspaceStore` is the default dev runtime.

## IN PROGRESS
- Phase 1 documentation foundation (this branch only). No application code modified.

## NOT VERIFIED / UNTESTED
- `npm test` suites were NOT executed in the authoring session (no Node runtime available there). The 18/38 test counts are repo claims — re-run before building on them.
- The v0.9 branches were not diffed line-by-line against `main`; their provider-abstraction work must be reviewed before merge or retirement.

## KNOWN DEFECTS & PROPOSED FIXES
- None newly discovered in v0.8 code.
- Directive inconsistency (documented, resolved): the master directive §2 lists the repository as `remRADAR/RADARSite`, while §3 mandates RADARMatrix/RADARSite separation. Resolved by treating the existing `remRADAR/RADARMatrix` as canonical (§3 forbids assuming it should be replaced). Status: resolved by interpretation; confirm with owner.

## DECISIONS & CONVENTIONS
- Extend, do not replace, the v0.8 foundation. No duplicate repositories; RADARMatrix evolves in place.
- `remRADAR/RADARSite` is untouchable. `remRADAR/remradar` is a separate product, not Matrix code.
- Execution/terminal capabilities must come from real runtime adapters (`github-readonly` → `codespaces` → `local-bridge`). Never simulate command execution.
- Hosting stays portable; the Cloudflare D1 adapter lands at milestone M7, not before. Vercel config remains valid until then.
- First agent is a deterministic Repo Inspector over the read-only GitHub adapter. LLM-backed agents deferred until a verified free model provider is authorized by the owner.
- Status vocabulary everywhere: implemented / connected / simulated / planned / unavailable.
- All writes by agents are approval-gated; `main` stays human-merged; substantial changes land on isolated branches with draft PRs.

## DO NOT TOUCH
- `apps/brand-studio/` — keep working until `apps/matrix-ide/` reaches parity, then retire via reviewed PR.
- `apps/mcp-server/` security pipeline semantics — extend, never weaken.
- `remRADAR/RADARSite`, all production deployments, DNS, and the shared Cloudflare account's existing projects.

## USER AWAITING / PENDING APPROVALS
- Review + merge or explicit retirement of the two v0.9 branches (milestone M1).
- Creation of a fine-grained, read-only GitHub token stored server-side for the `github-readonly` adapter (M3).
- Creation of the Cloudflare D1 database on the RADARCharts account (M7).
- Confirmation that `remRADAR/RADARMatrix` is the canonical repo per the directive-resolution above.

## NEXT STEPS (ordered)
1. Review/merge `v0.9-production-hardening` + `v0.9-security-gate` into `main`, or retire them explicitly.
2. Run `npm test` on `main` to establish a green baseline; record exact results here.
3. Build `packages/contracts/` (runtime adapter + storage adapter + API types) with honest `unavailable` stubs.
4. M2 control plane (`apps/control-plane/`) + M3 `github-readonly` adapter per `docs/PHASE1-BUILD-PLAN.md`.
5. Then M4 IDE shell; keep every panel backed by a real API or an explicit honest empty state.
