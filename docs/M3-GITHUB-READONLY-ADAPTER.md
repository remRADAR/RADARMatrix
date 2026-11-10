# M3 — GitHub Read-Only Runtime Adapter

**Status vocabulary (binding):** this document distinguishes
`implemented` / `tested` / `verified-in-CI` / `connected` / `planned` /
`unavailable`. Nothing here is production-deployed; production
authorization remains NOT GRANTED.

## What M3 delivers

The **first real execution capability** in RADARMatrix. Before M3,
runtime execution was plan-only everywhere (M1a/M2 law: no runtime
command execution existed). M3 adds:

- `apps/mcp-server/src/runtime/github-readonly.ts` — the
  `github-readonly` runtime adapter, using the M2.2.1 HMAC-integrity
  and atomic-reservation corrections carried on the security branch.
- `tests/github-readonly.test.mjs` — 26 deterministic M3 assertions,
  ported to the server-bound authority API and registered in the
  local M3 continuation branch's test runner (no network access).
- `tsconfig.json` — the tsc strict type-check scope now covers
  `apps/mcp-server/src/runtime/**/*.ts` in addition to contracts and
  auth (the M2 scope decision, extended).
- `tests/test-runner.mjs` — M3 suite registered as suite 14 after the
  M2.2.4 security-boundary suite.

The continuation branch `runtime/m3-github-readonly-resumed` is based on
the PR #9 merge commit `0246fe0` in
`security/m2-2-3-authority-hardening`. It is separate from the original
M3 branch and PR #5, and is not merged into `main`.

## Security model (binding)

1. **Allowlist only.** The adapter executes exactly the named
   read-only GitHub REST GET operations declared in its operation
   registry (`GITHUB_READONLY_OPERATIONS`): `github.read.file`,
   `github.read.directory`, `github.read.branches`,
   `github.read.branch`, `github.read.pull_request`,
   `github.read.commit`. There is no arbitrary command string, no
   shell, and no caller-controlled URL: the caller picks an operation
   name plus validated path parameters; the adapter builds the URL
   itself (each path segment `encodeURIComponent`-encoded; the caller
   cannot inject query strings, hosts, or traversal).

   **Callers MUST pass raw, unencoded path values** (e.g. `docs/a b.md`,
   `release/v2`), never pre-encoded ones. The adapter performs the
   encoding itself; a value that arrives already percent-encoded is
   treated as literal text and its `%` sequences are encoded again
   (`a%2fb` becomes the filename `a%2fb`, not a path separator). This is
   not a traversal risk — the repeated-decode validation rejects real
   dot segments first — but it silently changes the requested resource.
2. **Read-only only.** Every declared operation is an HTTP GET. The
   adapter has no code path that can issue a write to GitHub.
3. **Delegated authority is mandatory on every execution.** A request
   must present `authority` (agent identity + workspace +
   `DelegatedGrant`). Grant validation uses the server-held
   `GrantIntegrityService` (HMAC-SHA-256); missing integrity service,
   invalid seal, identity/workspace mismatch, expiry, exhausted use
   limit, or out-of-scope operation fails closed. The actor and
   canonical registry come from the one-time trusted server
   composition, not the request. Agents never inherit their actor's
   full authority — the M2 delegation subset rule applies unchanged;
   a runtime grant's tools are allowlisted operation names.
4. **Atomic reservation precedes approval and dispatch.** The adapter
   calls `reserveGrantUse` before any approval verification or
   external request. The HMAC seal is rechecked and the use count is
   atomically consumed before transport, so concurrent calls cannot
   exceed `max_uses`. Reservations are not refunded after transport
   failure, timeout, HTTP failure, cancellation, or approval denial
   because remote outcomes can be uncertain. An approval denial
   dispatches no request and does not redeem the approval, but the
   earlier grant reservation remains consumed.
5. **Approval-token model consumed.** Operations flagged
   `requiresApproval` additionally demand a valid single-use approval
   token verified by an injected verifier (the M2 approvals module:
   Ed25519-signed, exact action + exact resource id + workspace +
   actor, TTL ≤ 30 min, jti single-use redemption). The adapter
   presents the DELEGATING HUMAN ACTOR from the grant
   (`grant.actor_id`) — never the agent — so approvals stay
   actor-bound per the M2 approval law. No verifier configured ⇒
   approval-gated operations are denied. The DEFAULT M3 registry
   contains no approval-gated operations (repo reads are not
   consequential writes); the hook is proven by tests with a
   synthetic registry entry so future operation sets cannot bypass
   it.
6. **Honest status.** Without a configured GitHub token (or transport)
   the adapter reports `status: "unavailable"` and refuses every
   execution. Nothing is simulated — the M1a/M2 contract law
   ("adapters report honest status, never simulate capabilities")
   is enforced by tests.
7. **Fail-closed result mapping.** Unknown operation, malformed/
   unknown/empty arguments, missing authority, missing integrity
   service, grant denial, approval denial, HTTP 401/403/404/422 →
   `denied`. Transport failures,
   timeouts, and 5xx → `unavailable`. Only a 2xx GET response is
   `executed`. Credentials (the `Authorization` header) never appear
   in any result field (test-enforced). Response bodies are capped
   (default 1 MiB) with an honest `response_truncated` note.

## Explicitly NOT in M3

- **Gateway wiring.** The adapter is a standalone, unit-tested
  execution surface. It is NOT wired into `mcp-gateway.ts`; the
  gateway's tool pipeline does not invoke it. That wiring is a later,
  owner-gated step (and will require the RuntimeExecutionRequest/
  approval contract from `packages/contracts`).
- **Service-identity authentication path.** Not needed for M3:
  executing agents act under delegated grants, not service tokens.
  The explicit service-auth path remains PLANNED (M2.1 decision).
- **Write operations.** None exist in the registry and none can be
  added by callers — the registry is code/config-owned, and any
  approval-gated write would additionally require the approval
  verifier.
- **Production deployment, credentials, Cloudflare, DNS, databases.**
  Untouched. Zero runtime npm dependencies (dev-only typescript +
  @types/node). Erasable-syntax TypeScript only.

## Trusted-origin policy (Phase 4.1.1)

The adapter pins the API origin. `baseUrl` is validated (HTTPS only, no
embedded credentials, no query/fragment, no backslash, segment-whitelisted
path prefix) **and** its origin must appear in `trustedOrigins`.

- **Default:** `trustedOrigins` is `["https://api.github.com"]` — the public
  API origin **only**.
- **A configured `baseUrl` is NEVER auto-trusted.** Setting
  `baseUrl: "https://ghe.example.com/api/v3"` without also listing
  `"https://ghe.example.com"` in `trustedOrigins` yields
  `status: "unavailable"` and every execution returns
  `notes: "invalid_api_base_url"` — no transport call, no grant use.
- **GitHub Enterprise** deployments must declare their host deliberately:
  `trustedOrigins: ["https://api.github.com", "https://ghe.example.com"]`.
- An empty `trustedOrigins: []` is treated as "not supplied" and falls back
  to the public origin only — it never widens trust.

This closes the case where a mis-set or injected `baseUrl` would silently
widen the allowlist and send the `Authorization: Bearer <token>` header to
an attacker-controlled host.

## Test coverage (tests/github-readonly.test.mjs)

All deterministic (injected transport + injected clock; no network,
no sleeps): server-bound read-only tool registry; missing HMAC service
denied before transport; unconfigured adapter denies/honest status;
unknown and injection-style commands denied; GET-only enforcement;
argument validation (missing/blank/unknown); adapter-built URL with
encoding (traversal encoded away); mandatory authority
(missing/malformed); agent/workspace mismatch denial; out-of-scope
grant denial; expired and exhausted grants; one-use consumption and
concurrent reservation before dispatch; credential non-leakage; HTTP
401/403/404/422/5xx mapping; transport failure and timeout →
`unavailable` (never `executed`); response truncation;
approval-gated operation without verifier / without token / valid
single-use with replay denial / wrong actor and wrong resource denial
after reservation; honest `describe()` capability listing.

## CI evidence

M3 reached green through five verified commits (all evidence in
HANDOFF.md): `32d4297` (typecheck failure, 2 defects), `cf89c06`
(typecheck fix; test failures), `9eae883` (docs), `23d03e2` (test
harness fix), `630a071` (adapter approval-actor fix — the one real
M3 implementation defect: the approval check omitted `actor_id`),
`2698192` (final, validation-order test fix). **Final head `2698192`:
runs 41884831543 (push) + 41884842532 (PR #5 synchronize) — SUCCESS**,
every job step green. The authoring environment has no git and no
node; that is historical CI evidence for the original M3 branch. Local
verification on the continuation branch passed 14 suites (including
all 26 M3 tests), TypeScript typecheck, authority-boundary check,
deployment smoke, and failure-marker guard. Local results are not
GitHub CI evidence; check the continuation PR's status checks before
calling this branch CI-verified.

## Remaining production limitations (honest)

- The adapter is not reachable by any real request path yet (gateway
  wiring pending).
- Real GitHub execution requires a repository-scoped, least-privilege
  token supplied via configuration; no token exists in any
  environment today (none created — owner-gated).
- Approval redemption records and grant state are per-process
  in-memory (the durable D1 store remains M7).
- Production provisioning and rotation of the HMAC integrity secret
  remain owner-gated; the adapter fails closed without it.
- No rate-limit handling beyond HTTP status mapping; no retry logic.

## Attestation correction (Phase 4.1.1)

An earlier attestation for this branch stated "no PR created". That is
**incorrect**: **PR #27** exists (`security/phase4-github-readonly-path-boundary`
→ `main`), was opened 2026-11-10T13:24:04Z, and **remains open and unmerged**.
It was never merged, retargeted, or closed. Its base is still `main@91d9517`
while `main` has since advanced, so the PR base is stale and must be
re-evaluated before any merge decision.

The branch was also force-reset to `cf77f64` to discard commit `8e7a3d4`,
which had replaced five files with 9-byte binary blobs and failed CI
(runs #165/#166 at type-check). This document and the accompanying code
are the clean re-application on top of `cf77f64`.
