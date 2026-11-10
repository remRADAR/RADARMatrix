# M2.1 Authentication Security Hardening

Branch: `security/m2-1-auth-hardening` (base: `70824784b25c1dc04ea8c2bdedf7ed88e8c74986`, the exact M2 head on `chat/m2-production-auth-v2`)
Owner: CZA OF REM — RADARCharts by REM. Master intelligence: RADAR.
Scope: narrowly scoped security hardening of the M2 authentication and membership boundary. No redesign, no production infrastructure, no merges. Production authorization: NOT GRANTED.
M2.1.1 correction (2026-11-01): the one-hour maximum token lifetime is an ABSOLUTE verifier policy, not a caller-overridable maximum — see the M2.1.1 section below.

Status vocabulary: implemented / tested / verified-in-CI / connected / simulated / planned / blocked / unavailable.

## Changes made (commit `bf49aa0`)

| File | Change |
|---|---|
| `apps/mcp-server/src/auth/token-service.ts` | Strict JWT temporal validation, finite-number defense, documented maximum token lifetime, token-purpose verification option |
| `apps/mcp-server/src/auth/production-authentication.ts` | Interactive user authentication now enforces `token_use === "access"` exactly; service/missing/arbitrary purposes fail closed |
| `apps/mcp-server/src/providers/membership-file.cjs` | Operational-boundary documentation (semantics unchanged) |
| `tests/production-auth-negative.test.mjs` | 26 existing tests retained unchanged in behavior + 27 new tests (temporal matrix, purpose matrix, membership file failures) |

The gateway (`mcp-gateway.ts`) was deliberately NOT modified: the hardening lives in the token verifier and the provider the gateway already wires, so dev-mode fixtures, M1a production fail-closed behavior, M2 config gating, and all integration semantics are preserved.

## JWT claim validation policy

Required claims, all enforced exactly: `sub` (non-empty string), `iss` (exact configured issuer), `aud` (exact configured audience), `iat` (finite number), `exp` (finite number), `jti` (non-empty string). Optional claims are never silently accepted when malformed: `nbf`, when PRESENT, must be a finite number or the token is rejected.

Temporal validation (deterministic-clock tested):

1. **Expired tokens** are rejected: `now >= exp + CLOCK_SKEW_SECONDS`.
2. **Future-issued tokens beyond the documented clock-skew allowance** are rejected: `iat > now + CLOCK_SKEW_SECONDS`.
3. **`nbf` in the future beyond the allowance** is rejected: `now + CLOCK_SKEW_SECONDS < nbf`.
4. **`exp` must be strictly later than `iat`** — `exp == iat` is rejected.
5. **Lifetime bound**: `exp - iat` must not exceed the maximum (below). Overflow defense: extreme values (e.g. `exp: 1e999`, `iat: -1e999`) overflow the subtraction to `Infinity`, which exceeds any finite bound — rejected.
6. **Non-finite values rejected**: `Number.isFinite` gates `exp`, `iat`, and `nbf`. JSON.stringify serializes `NaN`/`Infinity` to `null` (rejected as non-numeric), but a hand-crafted payload can carry the literal `1e999`, which `JSON.parse` evaluates to `Infinity` — the verifier rejects it (proven by a hand-signed-token test).

## Maximum token lifetime — ABSOLUTE verifier ceiling (M2.1.1)

`MAX_TOKEN_LIFETIME_SECONDS = 3600` (1 hour), documented in `token-service.ts` and enforced BY THE VERIFIER, not delegated to callers. The policy:

- The one-hour ceiling is an **absolute verifier policy — it is NOT a caller-overridable maximum.**
- Callers may TIGHTEN the limit via `VerifyTokenOptions.maxLifetimeSeconds` (e.g. 1,800s).
- Callers can NEVER loosen it: the verifier computes `effectiveMaximum = min(configured, 3600)`. A value above 3,600 is silently clamped DOWN to 3,600 and can never increase the bound.
- Invalid, non-finite, zero, negative, or otherwise unusable option values fail safely to the documented 3,600-second default — they cannot loosen the default ceiling, and they do not accidentally tighten below it either.
- **Defect corrected (M2.1.1):** the initial M2.1 implementation accepted a caller-supplied `maxLifetimeSeconds` above 3,600 verbatim, allowing a caller to raise the ceiling — violating the documented policy ("callers may tighten, never loosen"). The correction replaces the pass-through with `Math.min(configuredMaximum, MAX_TOKEN_LIFETIME_SECONDS)`; behavior is otherwise identical. Change: `bf49aa0` → M2.1.1 commit (see CI evidence).
- This bounds the revocation window alongside the existing per-process denylist.

## Clock-skew behavior

`CLOCK_SKEW_SECONDS = 30` — the M2 policy, **unchanged**: not weakened, not broadened. It applies symmetrically to `exp` (grace past expiry), `nbf` (grace before validity), and — since M2.1 — future `iat` (a token dated more than 30 seconds in the future is rejected). Boundary behavior is test-proven: `iat = now + 10` verifies; `iat = now + 3600` does not. Tests use a deterministic clock override (`now` option), never sleeps or wall-clock dependence.

## Token-purpose policy

- The claims interface distinguishes `token_use: "access" | "service"`.
- **Interactive user authentication (ProductionAuthenticationProvider) accepts ONLY `token_use === "access"`** — passed as `requiredTokenUse: "access"` into the verifier. A service-purpose token, a missing purpose, or an arbitrary purpose string fails closed as an invalid token.
- **Service identities require a separate, explicit authentication path** with its own purpose enforcement and tests. That path is PLANNED, not implemented — deliberately not improvised. No service-authentication implementation exists.
- **Service privileges are never inferred from the token subject**: `sub` carries identity only; roles/workspace access come exclusively from the membership authority.
- **Arbitrary purpose strings are not accepted**: the required value must match exactly; `"admin"`, `"root"`, or any other string is rejected.
- **Documented compatibility**: `verifyGatewayToken` without `requiredTokenUse` (a standalone caller, e.g. a future service-auth path) still accepts purpose-less tokens — the policy is applied by the caller that requires it. The interactive path always requires the access purpose.

## Membership-provider operational boundary (documented in source)

`FileMembershipProvider` is an INTERIM, SINGLE-INSTANCE, FILE-BACKED implementation:

- It is file-backed — **not a transactional distributed membership store**.
- Writes are plain `fs.writeFileSync` — **not an atomic database transaction**; a crash mid-write can truncate the file, which then loads as an EMPTY registry (fail closed — access is lost, never wrongly granted).
- **Concurrent writers race** (last-writer-wins): no locking, merge, or versioning.
- **Multi-process / horizontally scaled production deployments require a stronger StorageAdapter** (durable store, D1 at M7 per the owner roadmap). This provider must not be used as if it were such a store. It is NOT production-grade distributed persistence.
- **Revocation IS effective for subsequent authorization decisions**: `revoke()` updates the in-memory map immediately (next `isMember`/`getRole` reflects it) and persists for future instances (test-proven both ways).
- **Corrupt or missing membership data fails CLOSED** (empty registry) — availability is sacrificed before security, by design. Tested for: corrupt JSON, missing file, and valid-JSON-wrong-shape files.
- No database introduced (explicitly out of scope).

## Negative test matrix (27 new M2.1 tests + 7 new M2.1.1 regression tests; all prove rejection, not just code-path execution)

Deterministic clock (`now` override, fixed `NOW = 2_000_000_000`) unless noted:

| # | Scenario | Result |
|---|---|---|
| 1 | Valid deterministic access token (baseline) | accepted (sanity) |
| 2 | Future `iat` far beyond skew | rejected |
| 3 | `iat` within the 30s skew allowance | accepted (skew policy unchanged — proven, not assumed) |
| 4 | `exp` earlier than `iat` | rejected |
| 5 | `exp` equal to `iat` | rejected |
| 6 | Lifetime beyond the 1-hour documented maximum | rejected |
| 7 | Lifetime at exactly the documented maximum | accepted (boundary) |
| 8 | Expired token (`exp > iat`, in the past) | rejected |
| 9 | Future `nbf` beyond skew | rejected |
| 10 | `nbf` within the 30s skew allowance | accepted |
| 11 | Malformed `nbf` (string) | rejected — never silently accepted |
| 12 | Malformed `nbf` (null) | rejected |
| 13 | Non-finite `exp` (hand-signed `1e999` payload) | rejected |
| 14 | Non-finite `iat` (hand-signed `1e999` payload) | rejected |
| 15 | Minting with `expiresAt: Infinity` (serializes to `null`) | rejected |
| 16 | Missing `jti` | rejected |
| 17 | Empty `sub` | rejected |
| 18 | Wrong signing algorithm (`HS256` header) | rejected before signature handling |
| 19 | Wrong token purpose (`service` where `access` required) | rejected |
| 20 | Arbitrary token purpose string (`admin`) | rejected |
| 21 | Missing token purpose where required | rejected |
| 22 | Standalone verify without a required purpose (documented compat) | accepted (policy is caller-applied) |
| 23 | Provider accepts a valid access-purpose token end-to-end | accepted (sanity) |
| 24 | Provider rejects a service-purpose token on the user path | rejected |
| 25 | Provider rejects a purpose-less token (fail closed) | rejected |
| 26 | Missing membership file | empty fail-closed registry |
| 27 | Valid JSON, wrong shape (unknown role / non-array entries) | empty fail-closed registry |

M2.1.1 absolute-ceiling regression tests (added):

| # | Scenario | Result |
|---|---|---|
| 28 | Default maximum remains 3,600s (3600 accepted, 3601 rejected, no option) | proven |
| 29 | Configured 1,800s rejects a 1,801s lifetime | rejected |
| 30 | Configured 1,800s accepts exactly 1,800s | accepted |
| 31 | Configured 7,200s CANNOT permit a 3,601s lifetime | rejected (clamped to 3600) |
| 32 | Configured 7,200s still accepts a 3,600s lifetime | accepted |
| 33 | Extreme option values (1e15) cannot bypass the ceiling via extreme numeric lifetimes (7,200s and 1e9-second lifetimes) | rejected |
| 34 | Invalid option values (NaN, Infinity, 0, −5, "7200", null) fail safely to the default ceiling: 3,601s rejected, 3,600s accepted | proven |

The pre-existing M2 matrix (26 tests) is retained: revocation (denylist), identity mismatch between verified subject and request context, workspace membership failure, wrong issuer, wrong audience, forged signature, `alg: none`, malformed tokens, config-gate failures, gateway child-process integration. Together the suite covers all 20 scenarios required by the M2.1 directive. Suite total: 60 tests.

## CI evidence

| Commit | Content | Run | Conclusion |
|---|---|---|---|
| `bf49aa0` | Hardening (code + tests) | `41337292376` (push) | **success** — typecheck + 8 suites + deployment smoke |
| `52cbdff` | M2.1 docs | `41337461932` (push) | **success** — every step green (typecheck, suites, guard, smoke) |
| (M2.1.1 commit) | Ceiling correction + regression tests + docs | recorded in HANDOFF.md / the owner report after push | see M2.1.1 owner report |

CI steps verified per run: `tsc --noEmit` (strict), `npm test` (exit-code-enforced, pipefail + failure-marker guard), deployment smoke (`npm run test:deployment`). The authoring environment has no git and no node — no local execution claims are made; all test evidence is GitHub Actions only.

## Remaining production limitations (honest)

1. No external IdP / OAuth2 / OIDC / PKCE / JWKS adapter — planned, not implemented (owner-gated IdP choice).
2. Denylist, approval redemption records, and audit sink are per-process in-memory; durable versions arrive with the durable store (D1, M7). The absolute 1-hour lifetime ceiling bounds the revocation window further.
3. Token issuance remains a control-plane/test-harness seam (`mintGatewayToken`); no production issuer deployment exists.
4. FileMembershipProvider is single-instance and non-transactional (see operational boundary above).
5. Delegation and approval modules remain unwired to gateway tool execution (M3+), per assignment.
6. No load/performance testing; the negative matrix is not a professional penetration test.
7. NOT production-ready: no production deployment exists and production authorization has NOT been granted.

## Change-control confirmations

No merge of any PR; `main`, `chat/m2-production-auth-v2`, `chat/m1a-pr-review-followup`, `phase1/discovery-and-foundation`, both v0.9 branches, PR #1, PR #3, and RADARSite untouched. No Cloudflare, DNS, production env, credentials/secrets, external IdP, OAuth/OIDC, database, shell execution, browser automation, or paid services. Production authorization was not requested or exercised.
