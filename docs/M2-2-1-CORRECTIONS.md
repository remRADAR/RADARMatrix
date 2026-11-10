# M2.2.1 — Security Correction Directive (Independent-Review Follow-Up)

Owner directive (CRITICAL priority, 2026-11-04): correct the five weaknesses
identified during independent review of M2.2 — on the EXISTING branch
`security/m2-2-hardening`, without redesigning RADARMatrix, without touching
the paused M3–M7 work, and without merging anything. This document records
the verified baseline, the confirmed defects, the chosen implementations and
their trade-offs, the tests, and the honest state vocabulary.

**State of this work: IMPLEMENTED, LOCALLY AUTHORED, CI-VERIFIED (see run
evidence in HANDOFF.md). NOT merged. NOT deployed. PR #6 remains a draft,
open, unmerged.**

## Baseline (verified against actual source before editing)

- Branch `security/m2-2-hardening` HEAD before M2.2.1: `c7fff50` (docs head;
  code head `727de81`) — exactly as previously reported. No material change
  since the prior review; no reconciliation was required.
- PR #6 (id 5159537693): draft/open, base `chat/m2-production-auth-v2`, head
  `security/m2-2-hardening` @ `c7fff50`, 6 commits, not merged.
- Reviewed against live source: `auth/delegation.ts`, `auth/approvals.ts`,
  `mcp-gateway.ts`, `providers/authorization.cjs`,
  `providers/membership-file.cjs`, `runtime/github-readonly.ts` (M3 branch,
  read-only), both auth test suites, the CI workflow, and the HANDOFF ledger.
- M3 (`runtime/m3-github-readonly` @ `d22e84d`) untouched; M3–M7 remain paused.

## Confirmed defects (all five present in source)

- **A — Grant integrity:** the M2.2 seal was an UNKEYED sha256 over the
  canonical grant fields. Anyone able to modify the grant could recompute the
  hash (it is not a MAC). The current-use counter was excluded from the seal.
- **B — Grant-use enforcement:** `recordGrantUse` ran AFTER the external
  request; the M3 adapter validated → dispatched → recorded. Concurrent
  requests could both pass validation against one remaining use.
- **C — Trusted actor provenance:** `TrustedActorContext` was a plain
  TypeScript interface; any caller could construct
  `{ actor_id, actor_roles: ["admin"], workspace_id }` and mint a grant.
- **D — Approval ordering:** the M3 adapter redeemed the approval BEFORE
  validating the delegated grant — an invalid grant consumed a valid
  single-use approval without executing anything.
- **E — Membership file:** the M2.2 atomic persist used a PREDICTABLE
  temporary name (`path + ".tmp." + pid + "." + Date.now()`) with default
  (not restrictive) file permissions and non-exclusive creation.

## Corrections and rationale

### A. Keyed grant integrity — `auth/delegation.ts`

- The seal is now an **HMAC-SHA-256** computed by a server-held
  `GrantIntegrityService` (`createGrantIntegrityService(secret)`). The secret
  lives only in the server process (closure); it never appears in grant
  objects, request data, tool results, errors, logs, or API responses.
- The seal binds EVERY security-relevant field: grant id, actor id, agent id,
  workspace id, permitted tools, permitted actions, expiry, maximum uses,
  **and the current use count** — so a use-counter rollback/reset attack
  invalidates the seal.
- Deterministic canonical serialization (fixed field order, sorted arrays,
  JSON over an array). Seal comparison is constant-time (`timingSafeEqual`).
- Fail closed on all sides: a missing/invalid service yields
  `integrity_unavailable` in `validateGrantUse`/`reserveGrantUse` and `null`
  from `createDelegatedGrant`; a weak secret (< 32 chars) cannot construct a
  service at all; there is NO unkeyed fallback. A recomputed plain sha256
  fails the keyed comparison (`grant_mutated`).
- **Trade-off considered:** an immutable server-side grant record (no
  client-visible mutable object at all) would be strictly safer against a
  fully-compromised server process, but it requires durable grant storage —
  the M7/D1 dependency — and would replace the existing in-memory grant
  contract mid-milestone. Chosen instead: keep the existing `DelegatedGrant`
  contract, upgrade the seal to a keyed one, and record the immutable-record
  design as the recommended durable-store shape at M7. The HMAC already closes
  the reviewed defect (an actor who can mutate the grant cannot forge the seal
  without the server secret).

### B. Atomic grant-use enforcement — `reserveGrantUse` + compatibility adapter

- New `reserveGrantUse(grant, integrity, now)`: verifies the seal and expiry,
  then ATOMICALLY checks remaining capacity, increments `uses`, and RE-SEALS
  the grant — a synchronous check-and-consume, atomic within the process.
- The reservation happens BEFORE the external dispatch. Two concurrent
  executions against one remaining use: exactly one reserves; the loser fails
  the capacity check before any transport is touched.
- Reservation state cannot be reset by caller-controlled mutation: `uses` is
  sealed; decrementing it without the secret invalidates the grant.
- Documented reservation policy: **no refund** on transport failure, timeout,
  cancellation, or unsuccessful HTTP responses — the outcome may be uncertain
  and refunding would enable over-use. A failed external operation consumes
  its reserved use.
- **Honest limitation (stated, not hidden):** this is per-process atomicity on
  the single-threaded event loop. It is NOT distributed atomicity and does not
  pretend to be — cross-process capacity enforcement requires the durable
  transactional store (D1, M7), which remains the approved roadmap dependency.
- **M3 adapter compatibility:** the original adapter lives on the paused,
  untouched M3 branch. The corrected, minimal-change version
  (`validateGrantUse` + `reserveGrantUse` before dispatch, approval moved
  after reservation, `recordGrantUse` removed) is carried on THIS branch at
  `apps/mcp-server/src/runtime/github-readonly.ts` per the directive's
  compatibility clause. Read-only GET allowlist, argument validation, honest
  status, and every other M3 behavior are IDENTICAL. The original M3 branch
  adopts these changes at merge time by owner decision.

### C. Trusted actor provenance — runtime brand, not a type

- `TrustedActorContext` is now a RUNTIME-BRANDED, frozen object minted ONLY
  by `createTrustedActorContext(principal, membership)`:
  - verifies the principal identifiers,
  - verifies WORKSPACE MEMBERSHIP through the trusted membership source,
  - derives the role FROM the membership record (never from request data),
  - fails closed on unknown roles, non-membership, or a malformed source.
- The brand is a module-private `Symbol`; a caller cannot construct it via
  JSON, request payloads, or object literals. `deriveActorAuthority` and
  `createDelegatedGrant` enforce the brand AT RUNTIME — the compile-time type
  is never the security boundary.
- Authentication / membership / authorization remain separate boundaries;
  caller-supplied `actor_tools`/`actor_can_write` remain rejected outright;
  the subset rule (an agent can never exceed its actor's derived authority)
  is unchanged; self-delegation remains impossible.

### D. Approval ordering and replay — compat adapter

- Corrected order: grant validation (integrity, agent, workspace, scope,
  expiry, capacity) → ATOMIC reservation → approval redemption
  IMMEDIATELY BEFORE dispatch.
- A failed grant check never consumes an approval. A failed approval check
  never dispatches the external operation (the reserved use stays consumed
  per the no-refund policy — capacity is spent to preserve the stronger
  invariant; documented trade-off).
- Single-use semantics preserved: `verifyApproval` + `RedemptionRecord.claim`
  remain the atomic redemption; concurrent redemptions of one jti yield
  exactly one winner (per-process runtime; cross-process single-use remains
  a D1/M7 dependency, unchanged and documented).

### E. Membership file hardening — `providers/membership-file.cjs`

- EXCLUSIVE temporary creation: `fs.openSync(tmp, "wx", 0o600)` — refuses any
  pre-existing path (file or symlink), defeating predictable-name hijack.
- Unpredictable temp name: random 64-bit suffix (test-only injectable seam
  `_tmpNameFn`; production never passes it).
- RESTRICTIVE permissions: created 0o600; the atomic rename carries the mode
  to the live file (POSIX; mode is a no-op on Windows — CI is POSIX).
- SAME directory (same filesystem) → rename stays atomic; `fsync` before
  rename so the renamed file never holds unflushed data.
- SAFE CLEANUP on any failure (temp closed and removed) with the error still
  PROPAGATING; the previous valid file always survives a failed write.
- Fail-closed corrupt/missing behavior unchanged (empty registry; never
  development fixtures). Storage abstraction preserved for M7/D1.
- **Not overclaimed:** atomic rename prevents TORN writes, NOT lost writes —
  last-writer-wins across instances remains; the provider stays documented
  single-instance/non-distributed. A small test asserts the limitation text
  stays in the provider source.

## Files changed

| File | Change |
|---|---|
| `apps/mcp-server/src/auth/delegation.ts` | HMAC integrity service (+seal over uses), runtime-branded trusted actor contexts, atomic `reserveGrantUse`, `recordGrantUse` removed, `integrity_unavailable` fail-closed path |
| `apps/mcp-server/src/providers/membership-file.cjs` | Exclusive `"wx"` temp creation, 0o600 mode, random tmp suffix, fsync, safe cleanup, test seam `_tmpNameFn`, updated boundary docs |
| `apps/mcp-server/src/runtime/github-readonly.ts` | NEW on this branch: M2.2.1 compatibility copy of the M3 adapter — reserve-before-dispatch, approval-after-reservation, `grantIntegrity` required, no-refund policy documented (original M3 branch untouched) |
| `tests/delegation-approval.test.mjs` | Migrated to the corrected APIs; all prior denial assertions kept; new M2.2.1 cases (unbranded-context rejection, unkeyed-hash bypass, wrong-secret, integrity-unavailable, reservation lifecycle) |
| `tests/m2-2-1-security-corrections.test.mjs` | NEW 44-test suite: corrections A–E matrices from the directive |
| `tests/test-runner.mjs` | 10th suite registered (async-aware) |

Unchanged: `mcp-gateway.ts` (no correction touched it), `approvals.ts`
(the M2.2 verification order already failed closed correctly; the ordering
defect was in the adapter), `authorization.cjs`, `package.json`,
`.github/workflows/ci.yml`, and every other repository file.

## Tests added and preserved

- NO test was deleted to obtain a green build; no assertion was weakened;
  every prior M2.2 denial behavior is still asserted (the delegation suite
  was migrated to the corrected APIs the same way M2.2 migrated M2's suite —
  assertions preserved, inputs updated).
- New suite `tests/m2-2-1-security-corrections.test.mjs` (registered as the
  runner's 10th suite) implements the directive's required matrices:
  - **A (12):** every field mutation rejected (actor, agent, workspace,
    tools/actions, expiry, max uses, current uses, grant id), missing/
    malformed seal, unkeyed-hash bypass, wrong/missing secret, weak-secret
    construction, valid unmodified grant still works.
  - **B (8):** two simultaneous requests vs one remaining use → exactly one
    reaches the transport; exhausted/expired/mutated/no-integrity-service →
    zero external requests; timeout follows the documented no-refund policy;
    5 concurrent vs max_uses=2 → exactly 2 dispatch; deterministic adapter
    behavior preserved.
  - **C (8):** fabricated admin role rejected at runtime; caller-supplied
    tool authority rejected; unauthenticated actor rejected; invalid
    membership rejected; cross-workspace delegation rejected; contributor
    limited to derived authority; admin still policy-bounded; self-delegation
    cannot exceed own permissions.
  - **D (8):** invalid grant / wrong actor / wrong workspace / wrong
    action/resource / expired approval never consume the approval; two
    concurrent redemptions → exactly one; successful approval cannot
    replay; no external operation after failed approval verification.
  - **E (8):** exclusive temp creation (pre-created temp path refused);
    0o600 permissions; atomic replacement; failed write leaves the previous
    file intact; temp cleanup after success and failure; corrupt and missing
    files fail closed; concurrency limitation stays documented in source.
- Runner total: 10 suites. Verification performed in CI on the final head:
  strict `tsc --noEmit`, the full 10-suite run (exit-code enforced +
  failure-marker guard), the runtime-mode fail-closed child-process matrix,
  delegation integrity tests, grant concurrency tests, approval
  ordering/replay tests, membership persistence tests, and the deployment
  smoke test. Actual run IDs and conclusions are recorded in HANDOFF.md —
  no green claim is made from any earlier commit.

## Remaining limitations (honest)

- Reservation and approval-redemption atomicity are PER-PROCESS (in-memory).
  Cross-process single-use/capacity requires the durable store (D1, M7).
- The no-refund reservation policy means a failed/timeout external operation
  consumes a use — deliberate, documented, safer than refunding.
- `mcp-gateway.ts` and `runtime/github-readonly.ts` remain outside the tsc
  scope (type-stripped); extending tsc is the recorded pending decision.
- The integrity secret is server-held configuration; production secret
  management (rotation, KMS) is an owner decision at deployment time.
- The original M3 branch still carries the pre-correction adapter and will
  need the documented compatibility changes at merge time (owner-gated).

## Compatibility with the existing M3 adapter

The compatibility adapter on this branch changes ONLY what the directive
required: reserve-before-dispatch (Correction B), approval-after-reservation
(Correction D), a required `grantIntegrity` service (fail closed without it),
and removal of the post-hoc `recordGrantUse`. The operation allowlist,
read-only GET law, URL construction, argument validation, approval hook
shape, timeout/caps, and honest-status semantics are byte-for-byte the M3
behavior. Merging this branch into the M3 lineage will be a small, explicit
adapter migration — no architecture change.

## PR #6 readiness

PR #6 remains OPEN and UNMERGED (draft, CI visibility only). With M2.2.1
complete and CI-verified on the same branch, PR #6 is **ready for the
owner's independent review** of the combined M2.2 + M2.2.1 correction set.
The merge decision (PR #6 → M2 branch, which advances PR #3) remains
exclusively the owner's. Nothing was merged, deployed, or promoted.

## Status vocabulary (explicit)

- **Implemented:** corrections A–E, compatibility adapter, 44-test suite.
- **Locally tested:** n/a — the authoring environment has no Node; all test
  execution happened in CI (GitHub Actions), as in every prior milestone.
- **CI verified:** yes — final code and documentation commits (run IDs in
  HANDOFF.md).
- **Merged:** NO.
- **Production deployed:** NO.
