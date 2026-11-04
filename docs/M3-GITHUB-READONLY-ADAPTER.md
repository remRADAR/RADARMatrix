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
  `github-readonly` runtime adapter (IMPLEMENTED, TESTED,
  VERIFIED-IN-CI on this branch).
- `tests/github-readonly.test.mjs` — the M3 test suite
  (deterministic; injected transport and clock; no network access in
  tests).
- `tsconfig.json` — the tsc strict type-check scope now covers
  `apps/mcp-server/src/runtime/**/*.ts` in addition to contracts and
  auth (the M2 scope decision, extended).
- `tests/test-runner.mjs` — 9th suite registered.

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
2. **Read-only only.** Every declared operation is an HTTP GET. The
   adapter has no code path that can issue a write to GitHub.
3. **Delegated authority is mandatory on every execution.** A request
   must present `authority` (agent identity + workspace +
   `DelegatedGrant`) and the grant must pass `validateGrantUse` for
   THIS operation name and workspace with action `"read"`. Missing,
   mismatched, expired, over-use-limit, or out-of-scope grants deny
   (fail closed). A successful execution consumes one grant use.
   Agents never inherit their actor's full authority — the M2
   delegation subset rule applies unchanged; a runtime grant's
   "tools" are the allowlisted operation names.
4. **Approval-token model consumed.** Operations flagged
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
5. **Honest status.** Without a configured GitHub token (or transport)
   the adapter reports `status: "unavailable"` and refuses every
   execution. Nothing is simulated — the M1a/M2 contract law
   ("adapters report honest status, never simulate capabilities")
   is enforced by tests.
6. **Fail-closed result mapping.** Unknown operation, malformed/
   unknown/empty arguments, missing authority, grant denial, approval
   denial, HTTP 401/403/404/422 → `denied`. Transport failures,
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

## Test coverage (tests/github-readonly.test.mjs)

All deterministic (injected transport + injected clock; no network,
no sleeps): unconfigured adapter denies/honest status; unknown and
injection-style commands denied; GET-only enforcement; argument
validation (missing/blank/unknown); adapter-built URL with encoding
(traversal encoded away); mandatory authority (missing/malformed);
agent/workspace mismatch denial; out-of-scope grant denial
(`tool_not_allowed`); expired grant and use-limit denial; grant use
consumption across executions; credential non-leakage; HTTP
401/403/404/422/5xx mapping; transport failure and timeout →
`unavailable` (never `executed`); response truncation; approval-gated
operation without verifier / without token / valid single-use with
replay denial / wrong-scope denial without grant-use consumption;
honest `describe()` capability listing.

## CI evidence

M3 reached green through five verified commits (all evidence in
HANDOFF.md): `32d4297` (typecheck failure, 2 defects), `cf89c06`
(typecheck fix; test failures), `9eae883` (docs), `23d03e2` (test
harness fix), `630a071` (adapter approval-actor fix — the one real
M3 implementation defect: the approval check omitted `actor_id`),
`2698192` (final, validation-order test fix). **Final head `2698192`:
runs 41884831543 (push) + 41884842532 (PR #5 synchronize) — SUCCESS**,
every job step green. The authoring environment has no git and no
node; all test evidence is GitHub Actions only.

## Remaining production limitations (honest)

- The adapter is not reachable by any real request path yet (gateway
  wiring pending).
- Real GitHub execution requires a repository-scoped, least-privilege
  token supplied via configuration; no token exists in any
  environment today (none created — owner-gated).
- Approval redemption records and grant state are per-process
  in-memory (the durable D1 store remains M7).
- No rate-limit handling beyond HTTP status mapping; no retry logic.
