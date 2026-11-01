# RADARMatrix — Phase 1 Build Plan

Companion to `docs/PHASE0-DISCOVERY-REPORT.md`. Scope: turn the audited v0.8 foundation into the five-layer RADARMatrix development operating system under the strict zero-budget constraint. GitHub is the source of truth; every milestone ships with tests and honest status reporting.

## Working rules (binding for all agents)

1. Audit before implementing; reuse before rewriting; no duplicate repositories.
2. Every consequential request passes the existing pipeline: authenticate → authorize (RBAC) → workspace isolation → audit → execute.
3. Never simulate execution success. Panels and APIs report `implemented / connected / simulated / planned / unavailable`.
4. Secrets stay server-side. No credentials in code, logs, client responses, or commits.
5. Substantial changes land on isolated branches with draft PRs; `main` is human-merged.
6. Update `HANDOFF.md` at every checkpoint; never end a session without updating it.
7. Zero paid dependencies. Any new external service must have its current free-tier limits verified and documented before use.

## Milestones and acceptance criteria

### M1 — Foundation consolidation
- Review and merge or explicitly retire branches `v0.9-production-hardening` and `v0.9-security-gate`.
- Add `packages/contracts/`: `RuntimeAdapter` interface (workspace init, repository access, file ops, command exec, build exec, test exec, status, logs, result retrieval, error reporting), `StorageAdapter` interface (mirrors current `BrandGateway`), shared API types.
- Acceptance: interfaces type-check; existing test suites still pass on `main`; adapter stubs report `unavailable` honestly; decision on v0.9 branches recorded in `HANDOFF.md`.

### M2 — Matrix Core control plane
- `apps/control-plane/`: projects, agents, tasks, executions, approvals, activity APIs over the existing JSON `WorkspaceStore` and pipeline.
- Acceptance: every route enforces RBAC + workspace isolation; write routes emit audit events; data persists across restarts; tests cover auth failure, isolation breach, and happy paths.

### M3 — GitHub read-only adapter
- `packages/adapters/github-readonly/`: list repos/branches/commits/files, PR and checks status via REST with a server-side fine-grained token.
- Acceptance: live remRADAR data served through the Core; token never reaches the browser; paging respects rate limits; missing token → honest `unavailable` state, not an error storm.

### M4 — Matrix IDE v1
- `apps/matrix-ide/`: dark desktop-first shell — file explorer, CodeMirror 6 editor, repo/branch selector, Git status, PR list, agent activity panel, tasks panel, preview panel (reuse the existing sandboxed iframe pattern).
- Acceptance: browsing + opening + editing a real repo file end-to-end through the Core API; terminal panel renders `unavailable — no runtime adapter connected` until M6; no panel shows fabricated data.

### M5 — Agent orchestration v1
- Task creation → deterministic routing (existing planner) → operator-approved assignment → execution records → review. First agent: deterministic Repo Inspector (read-only GitHub adapter; structured repo reports).
- Acceptance: one task end-to-end produces a real report from live GitHub data; all writes approval-gated; full audit trail; no direct agent-to-agent channel exists.

### M6 — Runtime v1 (real execution)
- `packages/adapters/codespaces/`: terminal sessions, command execution, test runs, log capture via the operator's personal-account Codespaces quota (120 hrs/month).
- Acceptance: a command typed in the IDE terminal executes in a real codespace; logs stream back and persist to `execution_logs`; session start/stop explicit; quota exhaustion reported honestly.

### M7 — D1 storage adapter
- `db/d1/` migrations mirroring the Phase 0 schema; `StorageAdapter` implementation for Cloudflare D1 (Workers Free: 5M reads/day, 100k writes/day, 5 GB).
- Acceptance: the M2 test suite passes against D1; JSON↔D1 parity verified; batched writes documented against the 100k/day limit.

### M8 — Matrix Deploy (read-only)
- GitHub + Cloudflare deployment/build status views; rollback preparation data only.
- Acceptance: live status visible; zero write/deploy actions; any future deploy action requires explicit human approval and is a separate milestone.

## Sequencing notes

- M1 → M2 → M3 are the critical path; M4 can start once M2 routes exist (parallel-safe behind interfaces).
- Hosting portability is preserved throughout: nothing in M1–M6 requires Cloudflare; the D1 move (M7) is the deliberate hosting decision point.
- Manus or any other authorized agent joins at any milestone through this repo and `HANDOFF.md`, never through private session context.
