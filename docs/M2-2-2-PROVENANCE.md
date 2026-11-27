# M2.2.2 — Server-Authority Provenance Corrections (security/m2-2-2-provenance)

Owner directive: **M2.2.2 SECURITY CORRECTION & ACCELERATED DEVELOPMENT DIRECTIVE** (2026-11-04).
Branch: `security/m2-2-2-provenance` (isolated), based on the verified M2.2.1 head.
Status vocabulary reminder: **implemented**, **unit-tested** (in-repo suites), **CI-verified**, integrated, staging-verified, production-deployed are DIFFERENT states. This work is implemented + CI-verified; it is NOT integrated (the gateway is unwired), NOT staging-verified and NOT deployed.

## 1. Verified baseline (Phase 0 — actual sources, not summaries)

| Item | Verified value |
|---|---|
| `main` | `93c1dc18f04faae015c0afdd196c854278f5bee1` (untouched) |
| M2 `chat/m2-production-auth-v2` | `7af32edd059005a922fbe457f3408a27b5eff326` (untouched) |
| M2.2.1 `security/m2-2-hardening` | `0bbf8ae3eb4eb7e99f2c0045ca744b6d5607da57` (= the reported M2.2.1 head — NO discrepancy) |
| M3 `runtime/m3-github-readonly` | `d22e84da086d4c8a1280f0432f1beebab195b8ca` (paused, read-only, untouched) |
| PR #6 | draft/open, head `0bbf8ae`, base `chat/m2-production-auth-v2`, unmerged |
| PR #3 | draft/open @ `7af32ed`, unmerged |

The M2.2.1 defects (A–E) remain fixed on that head. The two M2.2.2 findings below were confirmed in the live M2.2.1 source before editing.

## 2. Finding A — membership provider provenance

**Concern.** `createTrustedActorContext(principal, membership)` accepted a membership provider as an argument. A caller able to supply a fabricated provider object (`isMember() => true`, `getRole() => "admin"`) could mint a valid runtime-branded ADMIN context. The M2.2.1 runtime brand proved provenance of the CONTEXT but not of the PROVIDER that fed it.

**Correction.**
- The trusted membership provider and the canonical tool registry are bound **once per process** at the trusted server composition boundary: `initializeServerAuthority({ membershipProvider, toolRegistry })`. The binding is module-scoped, set-once (a second call returns `false` and changes nothing) and frozen. `isServerAuthorityInitialized()` is exported for composition/startup code.
- `createTrustedActorContext(principal)` now takes **no** provider argument: any second argument is rejected (rest-parameter guard) and mints nothing.
- Membership is checked against the **requested workspace** using the bound provider; the role is retrieved from that provider's authoritative data. Unknown, missing or invalid membership fails closed.
- An uninitialized server authority fails closed everywhere: no trusted context can be minted and no grant can be created.
- Dependency injection at the composition boundary — NO global mutable state, NO caller-replaceable provider. The `MembershipProvider` abstraction is unchanged, so the D1/M7 durable store drops in behind the same seam.

**Design note (recorded honestly).** The binding is per-Node-process and set-once within a process. A request handler can never swap it mid-flight. In production the composition owner (gateway startup) performs the single binding at boot; only a fresh process (i.e., a deploy) can bind again. This is the correct scope for a single-instance gateway and is the same boundary M7/D1 will formalize.

## 3. Finding B — tool registry provenance

**Concern.** `createDelegatedGrant()` accepted a `registry` through its input. A caller-controlled registry could redefine which tools exist or which roles they require, elevating a viewer to writer.

**Correction.**
- The `registry` field is **removed** from `CreateGrantInput`. An input still carrying `registry` is rejected loudly (same pattern as `actor_tools`/`actor_can_write` rejection) so legacy callers fail visibly instead of silently relying on a caller registry.
- Permission checks (role hierarchy + subset rule) use ONLY the server-bound canonical registry.
- Unknown tools fail closed. Write permissions remain stricter than read (`is_write_operation`/`required_role` semantics unchanged). The existing tool contract and the `deriveActorAuthority(actor, registry)` pure-function export are unchanged.

## 4. Finding C — security regression tests (nothing weakened)

New suite `tests/m2-2-2-provenance.test.mjs` (13 tests):
1. Fabricated membership provider (returns true/admin) rejected as an argument.
2. Fabricated admin role object cannot derive authority.
3. Caller-controlled tool registry cannot elevate permissions (attacker registry, benign legacy registry field, unregistered tool, write action — all rejected).
4. Unauthenticated principals cannot mint trusted contexts.
5. Invalid membership (unknown role "superuser", missing role) fails closed.
6. Cross-workspace access remains rejected.
7. Valid contributors receive only the permitted (read-only) authority.
8. Valid admins receive only policy-authorized authority (unregistered tools and the TTL ceiling still bind admins).
9. Self-delegation cannot exceed the actor's own authority (self-delegation refused; viewer cannot delegate editor-only tools).
10. The server authority binds exactly once — a mid-flight rebind attempt with a malicious provider returns `false` and leaves the ORIGINAL provider serving.
11. M2.2.1 HMAC protections intact: mutated grant id rejected; recomputed unkeyed hash rejected; reservation rollback tamper rejected.
12. M2.2.1 atomic reservation intact: one remaining use permits exactly one reservation; integrity unavailable fails closed.
13. (Coverage spread across the above; counts verified by CI.)

New shared helper `tests/server-authority.helper.mjs`: the ONE-TIME test composition. `tests/test-runner.mjs` imports every suite into a single process, so all delegation-touching suites share this single binding — the helper plays the trusted server composition boundary exactly as gateway startup will in production, and exposes a **state-replacing** membership fixture (`setMembershipState`) so each test points the bound provider at its own server-side data. Request payloads still cannot supply any of it.

Migrations (all prior denial assertions preserved, none weakened):
- `tests/delegation-approval.test.mjs` — 38 tests (36 prior + new caller-supplied provider/registry rejection tests; the fabricated-provider fixture is retained ONLY to prove rejection).
- `tests/m2-2-1-security-corrections.test.mjs` — 44 tests, migrated to state-based minting.
- Runner: **11 suites** (was 10).

## 5. Finding D — integration boundary (documented, NOT wired)

Intended production flow (per directive; the gateway is NOT wired in this assignment):

```
Authenticated token → Verified principal → Server-controlled workspace membership
→ Authoritative role → Server-controlled tool registry → Delegated grant
→ Integrity validation → Atomic reservation → Approval validation
→ Bounded execution → Audit record
```

Remaining integration requirements (owner-gated):
1. Gateway startup calls `initializeServerAuthority` with the real membership provider + canonical `TOOL_REGISTRY` (the single trusted composition point).
2. Provision the HMAC integrity secret from a secret store (fail-closed until wired).
3. Route delegated-execution requests through the corrected compatibility adapter ordering (grant validation → reservation → approval redemption → dispatch).
4. Durable store (D1/M7) for cross-process reservation/redemption/audit guarantees.
5. Service-identity authentication path before agents authenticate in production.

## 6. Files changed (code commit)

| File | Change |
|---|---|
| `apps/mcp-server/src/auth/delegation.ts` | `initializeServerAuthority`/`isServerAuthorityInitialized`; provider argument removed from `createTrustedActorContext` (rest-param guard); `registry` removed from grant input (loud rejection); all grants/contexts derive from the bound server authority; unbound = fail-closed. Erasable TS syntax only. |
| `tests/server-authority.helper.mjs` | NEW — shared one-time test composition (bound TEST_REGISTRY = TOOL_REGISTRY + read-only github adapter tools; state-replacing membership fixture). |
| `tests/m2-2-2-provenance.test.mjs` | NEW — 13-test provenance suite (Finding C). |
| `tests/delegation-approval.test.mjs` | Migrated + 2 new rejection tests (38 total). |
| `tests/m2-2-1-security-corrections.test.mjs` | Migrated to state-based minting (44 tests preserved). |
| `tests/test-runner.mjs` | 11 suites (adds the provenance suite). |

Unchanged: `approvals.ts`, `mcp-gateway.ts`, `authorization.cjs`, `membership-file.cjs`, the compatibility adapter `apps/mcp-server/src/runtime/github-readonly.ts` (consumes `validateGrantUse`/`reserveGrantUse` with a configured integrity service; never calls the changed factories), `ci.yml`, `package.json`, `tsconfig.json` (strict scope: contracts + auth — `delegation.ts` IS type-checked and must pass strict tsc).

## 7. Verification & honest limits

- Strict TypeScript checks, 11 test suites, failure-marker guard and deployment smoke run in CI on this branch.
- **Honest CI record:** the first code commit (`6b70a10`) ran RED on both events (push 41901903850 + PR #7 run 41901939126) on exactly TWO failing assertions, both inside the NEW provenance suite and both wrong EXPECTATIONS, not security defects: (1) "contributors cannot write" contradicted the actual contract — `radar.remember` is a contributor-level write tool, so a contributor legitimately derives it; the correct boundary (kept, with a stronger denial assertion added) is that a contributor never derives or delegates the editor-only write `radar.record_decision`; (2) the rebind test read a nonexistent `actor_roles` field on the derived authority — replaced with real boundary assertions. Fixed in `260ce1e` (final code head): **push run 41902415960 + PR #7 run 41902430031 — SUCCESS.** No assertion was weakened or deleted; the other 10 suites plus the remainder of the provenance suite were already green on the first commit.
- The final documentation commit's CI runs are verified separately after its push (IDs in the owner report and HANDOFF.md).
- No existing test was weakened, renamed to pass, or replaced by mocks that skip the boundary; the suites continue to verify ACTUAL denial behavior.
- Limits: binding is per-process (set-once within a process; rebinding only by a fresh process's composition owner); grant reservations/approval redemptions remain in-memory (single-instance; D1/M7 dependency); delegated execution is NOT wired to the gateway; HMAC secret production provisioning remains pending.
