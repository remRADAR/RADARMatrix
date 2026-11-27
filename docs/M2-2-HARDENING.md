# M2.2 — Security Correction & Verification

Owner directive (CRITICAL priority, 2026-11-04): a controlled interruption of the
M3–M7 sequence to correct four security findings before development continues.
Branch: `security/m2-2-hardening`, created from exactly `7af32ed`
(head of `chat/m2-production-auth-v2`). No M3–M7 work was modified, deleted, or
merged. No production surface, DNS, credentials, or repository permissions were
touched.

## Baseline (verified against actual source at `7af32ed`)

- `main` @ `93c1dc1` (untouched); `chat/m2-production-auth-v2` @ `7af32ed`
  (base of this branch); `runtime/m3-github-readonly` @ `d22e84d` (M3 record,
  untouched); `security/m2-1-auth-hardening` @ `cfbd88c` (M2.1/M2.1.1 record).
- Draft PR #3 (M2→main) head advanced to `7af32ed`; PRs #1, #2, #5 untouched.
- Every finding below was re-verified against the current source before
  implementation — none were assumed from earlier reviews.

## Findings confirmed and corrected

### A. Runtime mode must fail closed — `apps/mcp-server/src/mcp-gateway.ts`

**Confirmed defect:** `runtimeMode = env.RADARMATRIX_RUNTIME_MODE === "production" ? "production" : "development"`
— an unset, empty, misspelled, or unknown value silently activated the
deterministic development fixtures. A misconfigured environment could serve
development administrator identities.

**Correction (tri-mode + fail-closed):**
- `"development"` (exact) → deterministic development fixtures.
- `"test"` (exact) → the same documented deterministic test fixtures.
- `"production"` (exact) → production chain only when the COMPLETE production
  auth configuration is present; otherwise EMPTY registries (unchanged M1a/M2 law).
- Anything else — unset, empty, misspelled, unknown, wrong casing — →
  `"fail_closed"`: EMPTY registries on BOTH gates. No request can
  authenticate; no principal is a member of any workspace.

The npm test scripts now pin the mode explicitly
(`RADARMATRIX_RUNTIME_MODE=test`), and the brand-gateway suite pins
`development` explicitly for the shared in-process runner environment —
no test relies on a mode default.

### B. Delegated agent authority must be independently verified — `apps/mcp-server/src/auth/delegation.ts`

**Confirmed defect:** `createDelegatedGrant` trusted caller-supplied
`actor_tools` / `actor_can_write` as the actor's authority.

**Correction:**
- New required `TrustedActorContext` input `{ actor_id, actor_roles, workspace_id }`,
  built by the server from the AUTHENTICATED principal and its verified
  membership roles — never from request parameters.
- `deriveActorAuthority(actor, registry)` derives the actor's tool authority and
  write capability from the role hierarchy (viewer<contributor<editor<admin,
  mirroring the authorization provider) and the tool registry.
- Inputs still carrying `actor_tools` or `actor_can_write` are rejected
  OUTRIGHT (fail closed loudly; legacy callers cannot silently pass).
- Strict subset rule retained: every allowed tool must exist in the registry AND
  be within the DERIVED authority; `write` requires derived write capability.
- New `integrity_hash` (sha256 over the canonical grant fields) sealed at
  creation; `validateGrantUse` recomputes it — any mutation of ids, tools,
  actions, expiry, or use limit is rejected as `grant_mutated`.
- Clock input validated (`invalid_clock` on NaN/Infinity); all grant fields
  validated before use; expiry checked before use limits (order preserved).
- NOT connected to any runtime execution. No unrestricted agent execution.

### C. Approval token validation hardened — `apps/mcp-server/src/auth/approvals.ts`

**Confirmed defect:** expiry validation did not reject non-finite clock input,
and claims structure was not validated (a signed token with `exp: 1e999`
→ `Infinity`, or fractional timestamps, could reach the expiry comparison).

**Correction:**
- `hasValidClaimStructure`: jti/action/workspace_id/actor_id non-empty strings;
  resource_ids a non-empty array of non-empty strings; iat/exp FINITE INTEGERS;
  `exp > iat`; optional grant_id/session_id validated when present.
- Verification clock must be a finite number (`invalid_clock` otherwise).
- Redemption is now an ATOMIC check-and-set (`RedemptionRecord.claim(jti)`):
  first claim wins, every later claim loses. A FAILED verification at any step
  never consumes the approval. Exact action/resource/workspace/actor/grant/
  session binding preserved (exact-match, no wildcards). TTL ceiling unchanged
  (30 minutes max, positive only).

### D. Membership persistence boundary — `apps/mcp-server/src/providers/membership-file.cjs`

**Confirmed (partial):** boundary docs were already extensive (M2.1), but
persistence used a plain `fs.writeFileSync` (a crash mid-write could truncate
the live file).

**Correction:**
- `#persist` now writes to a process-unique temporary file and moves it into
  place with `fs.renameSync` (atomic on POSIX, same filesystem): a crash can no
  longer produce a torn live membership file. Write/rename failures clean up the
  temp file and PROPAGATE (loud, never swallowed).
- Boundary documentation updated: atomic rename prevents TORN writes; it does
  NOT prevent LOST writes — last-writer-wins across instances remains, no
  locking/merge/versioning. Still NOT production-grade distributed persistence.
- Corrupt/missing data still fails closed (empty registry). The StorageAdapter
  seam and the approved M7 (D1) storage sequence are unchanged.

### E. Full chain review (no code change required)

Token signature verification, issuer/audience, token purpose, expiry,
identity binding, workspace isolation, membership lookup, role hierarchy,
tool-level permissions, error handling, audit logging, and production
configuration behavior were re-inspected across
`production-authentication.ts`, `token-service.ts`, `authorization.cjs`, and the
gateway. The M2.1/M2.1.1 hardening (finite timestamps, future-iat rejection,
exp>iat, absolute 3600s lifetime ceiling, `token_use === "access"` only,
identity from verified token subject only, roles from membership only) stands
verified. Authentication, membership, and authorization remain separate
security boundaries.

## Test evidence

- `tests/delegation-approval.test.mjs` migrated to the trusted-actor API and
  extended (deriveActorAuthority matrix, caller-supplied-authority rejection,
  integrity-seal mutation matrix, invalid clock). Suite: 30 tests.
- New `tests/m2-2-security-regressions.test.mjs` (9th runner suite):
  runtime modes via real-gateway child processes (unset / empty /
  misspelled / unknown / wrong-casing → `fail_closed` with verified DENIAL
  behavior: 401 + empty membership; explicit development/test fixture modes;
  production with no configuration → fails closed) + signed
  malformed-claims approval matrix (1e999 exp/iat, fractional timestamps,
  exp<=iat, missing scope fields, empty/non-array resources, NaN/Infinity/
  non-number clocks, failed verification never consuming a jti). Suite: 18 tests.
- Runner total: 9 suites. Full suite + strict typecheck + failure-marker guard +
  deployment smoke all green in CI on the final head (runs 41889153742 push and
  41889159968 PR, both SUCCESS).
- Iteration evidence (honest record): the first code commit `1708ee2` failed CI
  on a single over-strict test (an environment-discipline assertion that
  demanded `test` while the brand-gateway suite legitimately pins
  `development` for the shared runner process). Two diagnostic commits
  (`a877d96`, `eaac396`) added CI failure annotations (failing test lines are
  now visible on the run page without log access) — a permanent diagnostic
  improvement. The assertion was corrected in `33d4792` (accept any explicitly
  pinned fixture mode; the fail-closed law itself is enforced by the
  child-process tests). Final code head `727de81` green.

## Files changed

| File | Change |
|---|---|
| `apps/mcp-server/src/mcp-gateway.ts` | Tri-mode fail-closed runtime mode; fail_closed wiring (empty registries both gates) |
| `apps/mcp-server/src/auth/delegation.ts` | TrustedActorContext, deriveActorAuthority, caller-supplied authority rejection, sha256 integrity seal, clock validation |
| `apps/mcp-server/src/auth/approvals.ts` | Claims-structure validation, finite clock validation, atomic claim() redemption |
| `apps/mcp-server/src/providers/membership-file.cjs` | Atomic temp-file+rename persistence; updated boundary docs |
| `package.json` | Test scripts pin RADARMATRIX_RUNTIME_MODE=test explicitly |
| `tests/delegation-approval.test.mjs` | Migrated to trusted-actor API + new M2.2 regressions |
| `tests/m2-2-security-regressions.test.mjs` | New 18-test regression suite |
| `tests/test-runner.mjs` | 9th suite registered |
| `.github/workflows/ci.yml` | Failure annotations + job-summary publication of suite output |

## Remaining known limitations

- Approval redemption records and token denylists remain per-process in-memory
  (bounded by short TTLs); durable versions arrive with the durable store (D1, M7).
  Atomic `claim()` prevents double-redemption within a process; cross-process
  single-use requires the durable store.
- FileMembershipProvider: atomic rename prevents torn writes, NOT lost writes
  (last-writer-wins across instances remains). Single-instance boundary stands.
- The delegation/approval modules remain unwired to gateway execution (by
  design; M3+ adapter work consumes them).
- `mcp-gateway.ts` remains outside the tsc scope (type-stripped in CI) — a
  recorded pending decision.
- CI annotations render at most 10 failing lines; the artifact and step summary
  carry the full output.

## Recommendation on PR #3

PR #3 (M2 branch → main) currently points at `7af32ed`. M2.2 is complete and
CI-green on `security/m2-2-hardening` (draft PR #6, CI visibility only). The M2
chain — including this hardening — is stronger than at the last review, but the
M2.2 branch has NOT been merged into `chat/m2-production-auth-v2`. **PR #3 is
NOT ready for another review until the owner decides the M2.2 disposition**
(review the branch, then merge `security/m2-2-hardening` → M2 branch via PR #6,
advancing PR #3 automatically). No merge is performed without that explicit
owner decision.

## M2.2.1 correction cross-reference (post-review addendum)

An independent review of M2.2 identified five security weaknesses, corrected on
this same branch in the M2.2.1 session (full report: docs/M2-2-1-CORRECTIONS.md).
Where this document is superseded, the correction document is stricter:

- The M2.2 integrity seal described in Finding B was an UNKEYED sha256 —
  recomputable by anyone able to mutate both grant and hash, and it did not bind
  the use count. M2.2.1 replaces it with a server-held **HMAC-SHA-256** seal
  binding every authority-bearing field INCLUDING `uses`, failing closed
  (`integrity_unavailable`) whenever the integrity secret is missing or short.
  There is no unkeyed fallback.
- Grant use was recorded AFTER the external request (non-atomic against
  concurrent validation). M2.2.1 introduces the atomic **`reserveGrantUse`**
  reservation (check-and-consume + re-seal) executed BEFORE dispatch, with a
  documented no-refund policy; `recordGrantUse` is removed. Per-process
  atomicity only — cross-process capacity remains a durable-store (D1, M7)
  dependency.
- The `TrustedActorContext` in Finding B was a plain TypeScript interface —
  constructible by any caller with fabricated roles. M2.2.1 makes it a
  **runtime-branded** context minted ONLY by `createTrustedActorContext` from
  verified membership; the compile-time type is never the boundary.
- The M3 flow redeemed approvals BEFORE validating the delegated grant
  (adapter composition defect — approvals.ts itself was already correct).
  The M2.2.1 compatibility adapter on this branch enforces: grant validation →
  reservation → approval redemption → dispatch.
- Membership temp files (Finding D) were predictable with default permissions.
  M2.2.1 upgrades persistence to exclusive `wx` creation with 0600
  permissions, a random same-directory temp name, fsync, atomic rename, and
  safe cleanup on failure.

The original M3 branch (`runtime/m3-github-readonly` @ `d22e84d`) is untouched;
a compatibility adapter carrying only the sanctioned changes lives at
`apps/mcp-server/src/runtime/github-readonly.ts` on this branch.
