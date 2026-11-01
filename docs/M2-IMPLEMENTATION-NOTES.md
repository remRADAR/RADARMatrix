# M2 Implementation Notes — Production Authentication & Workspace Membership

Branch: `chat/m2-production-auth-v2` (base: `fcfce1d478360cf0a957cde2658f0a4d01f65006`, the M1a follow-up final head)
Owner: CZA OF REM — RADARCharts by REM. Master intelligence: RADAR.
Authorization: the owner reviewed the M2 architecture assessment and approved it ("Approved. Proceed"). This document reports what was implemented under that approval, with the honest status vocabulary (implemented / tested / verified-in-CI / connected / simulated / planned / blocked / unavailable).
M2.1 addendum: see the final section of this file and docs/M2-1-AUTH-HARDENING.md.

## Scope actually implemented (vs. the full M2 assessment)

| Phase | Item | Status |
|---|---|---|
| P0 | Strict `tsc --noEmit` type-check in CI; M2 contract types + branded type ladder | implemented, verified-in-CI (commit `4208bd8`) |
| P2 | Ed25519 control-plane token service (`auth/token-service.ts`) | implemented, verified-in-CI (commit `775b437`, tests green at `9d6fa59`; hardened in M2.1) |
| P2 | ProductionAuthenticationProvider (`auth/production-authentication.ts`) | implemented, verified-in-CI (commit `775b437`, tests green at `9d6fa59`; hardened in M2.1) |
| P3 | Durable membership record (`providers/membership-file.cjs` + ESM wrapper) | implemented, verified-in-CI (commit `775b437`, tests green at `9d6fa59`) |
| P3 | Gateway wiring behind a fail-closed configuration gate | implemented, verified-in-CI (commit `775b437`, tests green at `9d6fa59`) |
| P2/P3 | 26-test production authentication negative matrix + gateway integration tests | implemented, verified-in-CI (green at `9d6fa59`; extended to 53 tests in M2.1) |
| P4 | Delegated authority (`auth/delegation.ts`) — subset-enforced grants | implemented, tested, verified-in-CI (commit `9d6fa59`) |
| P4 | Approval tokens (`auth/approvals.ts`) — signed, scoped, single-use | implemented, tested, verified-in-CI (commit `9d6fa59`) |
| P4 | Delegation/approval unit suite (`tests/delegation-approval.test.mjs`, 21 tests) | implemented, verified-in-CI (commit `9d6fa59`) |
| — | Wiring delegation/approvals into the gateway or any execution adapter | planned (M3+) — deliberately NOT done |
| — | External IdP / OAuth2 / OIDC / PKCE / JWKS adapter | planned — gateway trusts only the configured control-plane key |
| — | Durable denylist / redemption / audit storage (D1) | planned (M7) — current records are per-process, TTL-bounded |

## What the production chain does

1. `RADARMATRIX_RUNTIME_MODE=production` + ALL FOUR env vars (`RADARMATRIX_AUTH_PUBLIC_KEY`, `RADARMATRIX_TOKEN_ISSUER`, `RADARMATRIX_AUDIENCE`, `RADARMATRIX_MEMBERSHIP_FILE`) arms the production chain:
   - `ProductionAuthenticationProvider` verifies an Ed25519 (EdDSA) compact JWT from `context.token`: signature (alg must be EdDSA), exact `iss`, exact `aud`, `exp`, `nbf` (30s bounded skew), `jti`, denylist hook.
   - The verified token subject must equal the request `context.caller_id` — a token for someone else never authenticates the caller.
   - Roles come ONLY from the membership record. Role-like token claims are ignored by construction.
   - `FileMembershipProvider` is the membership authority: an explicit, file-backed map; corrupt/missing file ⇒ empty (fail closed); unknown roles are rejected at grant time; `grant`/`revoke` persist to the file; multi-workspace membership is explicit rows, never wildcards.
   - Defense in depth: membership is verified in the provider (a verified non-member fails AUTHENTICATION with 401) AND again at the gateway's isolation gate (403 for any path where the provider-level check is absent or bypassed — unreachable in this wiring, which is the point).
2. ANY incomplete production configuration ⇒ the gateway fails closed exactly as in M1a: empty authentication registry + empty membership map. Nothing authenticates. This is proven by a dedicated test (a fully valid token cannot authenticate when one env var is missing).
3. Development mode is unchanged (M1a fixtures, M1a test suite still green — 16 integration tests).

## Security invariants and their tests

Token matrix (26-test suite, in-process): valid-token claims; tampered payload; expired; not-yet-valid; wrong issuer; wrong audience; forged signature (attacker key); unsigned `alg:none` (a decoded payload is never an identity); malformed tokens; denylist jti replay.

Config gate: complete config arms; each single missing var disarms.

Provider paths: forged token; identity mismatch (context ≠ subject); verified subject that is not a workspace member; roles resolved from membership only; revocation effective on the very next authenticate.

Membership record: unknown role throws at grant; corrupt file ⇒ empty fail-closed registry; explicit multi-workspace rows; grant/revoke persistence observed by a fresh provider instance.

Gateway integration (child processes, real `handleRequest` only): production mode end-to-end — editor read succeeds; viewer read succeeds; viewer write FORBIDDEN 403 (role from membership, not claims); verified non-member UNAUTHENTICATED 401 (defense-in-depth provider-level membership check); expired and forged tokens UNAUTHENTICATED 401; incomplete config ⇒ UNAUTHENTICATED even with a valid token.

Delegation & approvals (21-test suite): subset rule (agent never exceeds actor authority); unknown tool / write-without-capability / unknown-action / TTL-limit / self-delegation rejections; agent/workspace/tool/action/expiry/use-limit enforcement; malformed grants fail closed; approval issue/verify/redeem-once; forged key; expiry; action/resource/workspace/actor/grant mismatches; tampered payload; invalid issue inputs; malformed tokens; failed redemptions do not consume the jti.

## CI evidence (actual GitHub Actions runs, conclusions read via API/connector)

| Commit | Run | Conclusion |
|---|---|---|
| A `4208bd8` | `41306359238` (push) | success — typecheck + 6 M1a suites green |
| B `775b437` | `41306716485` (push) | **failure** — typecheck green; test step red. Diagnosed: one wrong test expectation (the verified-non-member child test expected the gateway's 403 WORKSPACE_FORBIDDEN, but the production provider checks membership itself — defense in depth — so the correct result is 401 UNAUTHENTICATED at the authentication gate). Fixed by correcting the test expectation, not the implementation. |
| C `9d6fa59` (B-fix + P4) | `41307014908` (push) + `41333689388` (PR #3 check) | **success** — 8 suites green, incl. the 26-test production matrix and the 21 delegation/approval tests |
| D (docs) | push runs on `chat/m2-production-auth-v2` head `7082478` | success (both test runs green; recorded in the M2 owner report) |

Verification method: GitHub REST API `actions/runs?head_sha=…` while quota allowed; after the anonymous egress IP exhausted GitHub's 60/hour limit, CI conclusions were read through the GitHub App connector via `pull_request_read.get_check_runs` on draft PR #3 — which CZA OF REM explicitly authorized opening for CI visibility (not for merge). The authoring environment has no git and no node; all tests ran in Actions only. No test was executed locally.

## Engineering constraints honored

- Zero runtime npm dependencies (`typescript` + `@types/node` are devDependencies only; runtime uses node:crypto only).
- No paid services; CI is GitHub Actions on a public repo (free tier).
- No Cloudflare resources; no production deployment; PR #1, `main`, `phase1/discovery-and-foundation`, `chat/m1a-pr-review-followup`, both v0.9 branches untouched. Draft PR #3 was opened from `chat/m2-production-auth-v2` solely for CI check-run visibility, with the owner's explicit authorization, and is NOT to be merged without an owner decision.
- Module-format law kept: new provider `.cjs` + ESM `.js` wrapper; new TS modules use erasable syntax only (type stripping compatible, Node 24).
- Fail-closed law kept and extended: every new enforcement point (token verify, config gate, membership, delegation, approvals) denies by default.

## Remaining risks and limitations (honest)

1. Key management is manual: the operator supplies the Ed25519 public key via env. Secret management, rotation, and a control-plane token-issuing service are future work (the issuing helper `mintGatewayToken` exists and is tested, but there is no production issuer deployment).
2. Denylist and approval redemption records are per-process; short TTLs (gateway tokens ≤ minutes recommended, approvals ≤ 30 min, grants ≤ 4 h) bound the revocation window.
3. The gateway itself is not yet in the tsc scope (type stripping executes it in CI; contracts + auth modules are strict-checked).
4. No external IdP: issuer/audience validation is against configured constants; JWKS rotation, PKCE, and session/refresh lifecycle are planned, not implemented.
5. Tool execution remains deterministic dev stubs (unchanged from M1a); the security pipeline is real, persistence is not.
6. No load/performance testing; the negative matrix is not a substitute for a professional penetration test before any real deployment.
7. Per-test pass counts inside suite logs were not individually readable from the authoring environment; the green conclusions are exit-code-enforced (runner exits 1 on any failure; pipefail preserves it through tee).

## Owner decisions requested

1. Disposition of `chat/m2-production-auth-v2` and draft PR #3 (review? further hardening? merge is owner-gated).
2. Delete the stray branch `chat/m2-production-auth` (created from `main` by a mis-issued tool call, unused; no delete permission available to the agent).
3. Choose the external IdP strategy (OAuth2/OIDC + PKCE + JWKS) when staging identities are needed.
4. Approve the allowlisted RuntimeExecutionRequest model before M3 real execution (github-readonly adapter first).
5. Timing for durable storage (D1) of memberships, grants, approvals, redemption records, and audit events.

---

# M2.1 Addendum — Authentication Security Hardening (branch `security/m2-1-auth-hardening`)

Owner assignment dated 2026-11-01: harden the M2 JWT validation gaps, enforce token purpose, extend the negative matrix, and document the membership provider's operational boundary. Base verified exactly: `70824784b25c1dc04ea8c2bdedf7ed88e8c74986` (the M2 head). Production authorization NOT granted — no production changes made.

**Commit `bf49aa0`** (CI run `41337292376`, push, **success** — typecheck + 8 suites + deployment smoke):

- `token-service.ts` — `exp`/`iat` must be finite numbers (NaN, Infinity, and the JSON `1e999` trick are all rejected; `JSON.parse("1e999")` yields `Infinity`, so the verifier gates on `Number.isFinite`); future `iat` beyond the documented 30-second clock skew is rejected (skew policy itself unchanged); `exp` must be strictly later than `iat`; token lifetime (`exp - iat`) is bounded by the documented 1-hour maximum (`MAX_TOKEN_LIFETIME_SECONDS = 3600`, tightenable via option, loosenable only by owner decision); a present-but-malformed `nbf` is rejected — never silently accepted; `requiredTokenUse` option enforces exact token-purpose matching.
- `production-authentication.ts` — interactive user authentication accepts ONLY `token_use === "access"`. Service-purpose, missing-purpose, and arbitrary-purpose tokens fail closed. Service identities require a separate explicit authentication path — PLANNED, deliberately not improvised in M2.1; service privileges are never inferred from `sub`.
- `membership-file.cjs` — operational boundary documented in source: file-backed, non-transactional, single-instance interim; concurrent writers race (last-writer-wins); multi-process/scaled deployments require a stronger StorageAdapter (D1, M7); revocation IS effective for subsequent decisions; corrupt/missing data fails closed. Semantics unchanged; no database introduced.
- `tests/production-auth-negative.test.mjs` — 26 existing tests retained; 27 new tests with a deterministic clock (fixed `NOW`, `now` override; no sleeps): the full temporal matrix (future iat, skew boundaries, exp≤iat, excessive lifetime, expiry, future/malformed nbf, non-finite values incl. hand-signed `1e999` payloads), the purpose matrix (wrong/arbitrary/missing purpose, provider-level service-token rejection), and membership file failures (missing file, valid-JSON wrong shape). Suite total: 53 tests.
- Gateway NOT modified: hardening lives in the verifier and provider the gateway already wires, so dev fixtures, M1a fail-closed behavior, and all integration semantics are preserved by construction (proven by the unchanged child-process gateway tests in the same run).

Full policy documentation: docs/M2-1-AUTH-HARDENING.md. Historical records above are unchanged.
