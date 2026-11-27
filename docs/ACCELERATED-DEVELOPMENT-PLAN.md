# RADARMatrix — Accelerated Development Plan (M2.2.2, Phase 2 + 3 directive)

Owner directive: **M2.2.2**, Phases 2–3. This plan PRESERVES the existing M1–M8 roadmap and the original scope (docs/PHASE1-BUILD-PLAN.md). It does not move any milestone forward, declare anything complete, or authorize production. Milestone states use the exact vocabulary: **implemented / unit-tested / CI-verified / integrated / staging-verified / production-deployed** — a branch being implemented means NONE of the later states.

## 1. Roadmap preserved (no scope change)

| Milestone | Scope (unchanged) | Current state |
|---|---|---|
| M1/M1a | Discovery, foundation gateway, contract tests | CI-verified, consolidated |
| M2/M2.1/M2.1.1 | Production auth chain (Ed25519 JWTs, membership, hardening) | CI-verified on `chat/m2-production-auth-v2` |
| M2.2/M2.2.1/M2.2.2 | Security hardening + corrections | CI-verified on `security/m2-2-hardening` + `security/m2-2-2-provenance`; PR #6/#7 owner-gated |
| M3 | github-readonly runtime adapter | Implemented + CI-verified on `runtime/m3-github-readonly` @ `d22e84d`; PAUSED |
| M4+ | Remaining roadmap per docs/PHASE1-BUILD-PLAN.md | Not started; contracts-first before parallel work |

## 2. Workstreams (parallel-capable, per the directive)

| # | Workstream | Owns (indicative) | Depends on |
|---|---|---|---|
| W1 | Runtime & execution adapters | `apps/mcp-server/src/runtime/**`, adapter contracts in `packages/contracts` | M2.2.x security pipeline (merged), M3 pattern |
| W2 | Interface & IDE | `apps/matrix-ide/**`, `apps/brand-studio/**` (frozen until parity decision) | Contract events/schemas from W4 |
| W3 | Intelligence & orchestration | RADAR orchestration contracts, routing, agent network logic | Delegation/approval contracts (W5 gate), task/event schemas |
| W4 | Memory & persistence | StorageAdapter seam, durable memberships/grants/reservations/approvals/audit (D1) | Contract definitions; owner store decision (free tier) |
| W5 | Security & QA | CI, test law, regression suites, threat reviews, security corrections | Reviews every workstream's PR |

All five workstreams share the M1–M8 sequence; none may skip the security pipeline.

## 3. Genuine blockers vs parallelizable work

**Blocking dependencies (the critical chain):**
- Owner disposition of PR #6 → then PR #3 → then `main` — everything integration-level waits on this.
- M2.2.2 provenance branch disposition (PR #7) before any delegated-execution wiring.
- Durable store decision (D1, M7 timing) blocks: cross-process single-use, distributed membership, durable audit.
- Contract definitions (typed schemas) block every consumer workstream — contracts land FIRST.

**Parallelizable immediately after contracts + owner merge decisions:**
- W1 (runtime adapters) ∥ W2 (Interface/IDE) ∥ W3 (orchestration logic) ∥ W4 (persistence adapters) — each on isolated branches against agreed contracts.
- W5 runs continuously (review + CI stewardship), no milestone dependency.

## 4. Contract-first rule

Before parallel implementation of any feature: the typed contract (schema/module boundary in `packages/contracts` or the relevant `docs/` design note) is authored, reviewed and merged. Implementations import the contract; contract changes require a proposal (Rule 9). Contracts are typed, fail-closed by default, and never widened to unblock a workstream.

## 5. Branch ownership & integration rules

1. One authoritative task owner per branch (Rule 2). The owner is named in the branch's first commit/PR description.
2. Branch naming: `<workstream>/<milestone>-<topic>` (existing convention). Security corrections keep `security/…`, runtime keep `runtime/…`.
3. Explicit file ownership for parallel tasks (Rule 3): shared files (see §7) are single-owner; other files belong to the workstream branch.
4. No cross-branch merges without owner approval (Rule 8). Draft PRs for CI visibility follow the established owner-authorized convention.
5. **Single integration owner: CZA OF REM.** Only the owner merges, deploys, and approves integration order.
6. Milestones are declared complete only at the owner's explicit acceptance of the CI-verified + integrated evidence — never by the implementing branch's state.

## 6. Testing & CI acceptance gates

A work is accepted for owner review only when, on its FINAL commit:
1. Strict `tsc --noEmit` (current scope; scope extension is a recorded decision) passes.
2. The full test-runner aggregate (currently 11 suites) passes with zero failures.
3. New features carry regression tests proving ACTUAL denial/fail-closed behavior (test law).
4. The failure-marker guard and deployment smoke checks pass.
5. No test was weakened/deleted to obtain green (reviewed by W5).
6. The final diff contains no unintended changes, secrets, or architecture drift.

Red runs are diagnosed honestly, fixed at the cause, and re-verified on a NEW head; no green is reported from an earlier commit.

## 7. Shared-file collision risks (single-owner: W5 + owner)

| File | Risk | Rule |
|---|---|---|
| `HANDOFF.md` | Every session edits it | One writer per session; append sections, never rewrite history |
| `tests/test-runner.mjs` | Every new suite edits it | Suite additions only; coordinate through W5 |
| `package.json` / `ci.yml` | Dependency/script/workflow drift | Owner approval for changes; zero paid dependencies |
| `packages/contracts/**` | Widening contracts to unblock work | Proposal required (Rule 9) |
| `apps/mcp-server/src/chatgpt-app-contract.ts` (TOOL_REGISTRY) | Registry is a security surface | Server-owned; changes go through W5 + proposal |
| `apps/mcp-server/src/auth/delegation.ts` | Security core | Security workstream owns; others file proposals |

## 8. Critical path & acceleration opportunities

**Critical path (unchanged, per roadmap):** owner disposition of the M2.2.x security chain → M3 resumption (compatibility adapter already carries the corrections) → M4 contracts → M4 ∥ M5 (per PHASE1-BUILD-PLAN) → M6 → M7 (D1 durable store) → M8.

**Accelerations that do NOT change scope:**
- Author M4 contracts NOW (contracts-first) while the owner reviews the security chain — removes the serial wait before parallel work.
- Pre-build the D1 StorageAdapter implementation against the existing seam (W4) so M7's durable guarantees arrive early for reservations/redemptions/audit.
- Parallelize W1/W2/W3 on isolated branches once contracts merge.
- W5 pre-authors the review checklist + regression patterns so each workstream's PR review is fast.
- NOT accelerations: skipping the security pipeline, merging without owner approval, or declaring milestones complete from branch state. These are prohibited.

## 9. Mandatory development operating rules (Phase 3 — all sessions)

1. **Read-only baseline before every assignment** — verify actual branch HEADs, PR heads and source before editing; report discrepancies instead of proceeding.
2. **One authoritative task owner per branch.**
3. **Explicit file ownership for parallel tasks** (§7 table).
4. **Contract-first implementation** (§4).
5. **Small, independently testable changes** — one concern per commit set; each commit leaves the tests meaningful.
6. **Automated regression tests** for every security-relevant change.
7. **CI verification against the final commit** — green on the final code AND documentation commits; red runs are fixed at the cause and re-verified on a new head.
8. **No unapproved cross-branch merges.**
9. **No architecture changes without a proposal** (recorded, owner-approved).
10. **No production, DNS, environment, secret, database or permission modifications without owner approval.**

Zero-budget law: no paid services or dependencies; prefer existing dependencies and free-tier-compatible solutions. All agent writes approval-gated; `main` is human-merged; substantial changes land on isolated branches with owner-gated draft PRs.

## 10. Status vocabulary (enforced in every report)

implemented / unit-tested / CI-verified / integrated / staging-verified / production-deployed — six different states, reported explicitly. A milestone is NEVER declared complete because its branch is implemented.
