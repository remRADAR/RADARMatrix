# Durable Transaction Runtime (local implementation)

RADARMatrix now contains a Cloudflare D1 schema and a server-side runtime for the T0–T4 transaction lifecycle. The implementation is local and uncommitted. It does not provision a database, deploy a Worker, connect the existing Vercel/Node gateway to D1, or authorize consequential execution.

## Components

- `apps/mcp-server/migrations/0001_durable_execution.sql` creates execution, grant, reservation, approval-claim, dispatch-intent, provider-outcome, audit, and transaction-assertion tables. Audit rows reject update/delete. Conditional-write assertions run inside the same D1 batch so a lost compare-and-set or audit constraint failure rolls back preceding writes.
- `apps/mcp-server/src/runtime/durable-execution/d1-runtime.ts` implements scoped idempotent creation/replay, HMAC-sealed grant persistence and reservation, durable approval JTI claims, dispatch-intent persistence, provider outcomes, unresolved-execution reads, audit reads, and reconciliation. Authorization-sensitive and commit-resolution reads use D1's `first-primary` session.
- `apps/mcp-server/src/runtime/durable-execution/worker-entry.ts` is a separate Worker entrypoint. It has a health-only route; all other paths return 404. It does not port or bypass the existing gateway authentication, membership, or authorization pipeline. `createRuntimeFromWorkerEnv` is a trusted composition seam and returns no runtime unless the exact enable flag and a valid server-held integrity secret are present. Provider policies default to none.
- `apps/mcp-server/wrangler.toml` declares the `EXECUTION_DB` binding, local placeholder database id, migration directory, and `DURABLE_EXECUTION_ENABLED = "false"`.
- `apps/mcp-server/src/runtime/durable-execution/test-worker.ts` and `wrangler.test.toml` are local integration-test infrastructure, not an application API. The test endpoint requires an ephemeral bearer token and never calls a provider.

## Lifecycle and fail-closed behavior

T0 uses a unique workspace/actor/idempotency-key insert, audits only the winning insert, and reads the result from primary to distinguish creation, replay, and request conflict. T1 verifies the HMAC-sealed grant from primary, then atomically increments its use count, inserts a durable reservation, advances execution state, and appends the audit event. A reservation is never refunded by this implementation.

T2 verifies the Ed25519 approval's exact scope and expiry, then stores its JTI with the execution transition and audit event in one batch. T3 only persists a dispatch intent. It refuses to do so unless trusted server composition supplies a provider policy asserting verified idempotency-key and operation-lookup support, with idempotency retention covering the configured recovery window. The `provider_request_id` value is the stable key that a future adapter must use verbatim. This runtime itself has no provider adapter and never sends a request.

T4 binds provider outcomes to the stored provider intent. An `UNCERTAIN` outcome remains unresolved until reconciliation evidence is recorded. `STILL_PENDING`, `UNKNOWN`, `UNSUPPORTED`, and `RECONCILIATION_CONFLICT` remain uncertain; only explicit `CONFIRMED_SUCCEEDED` or `CONFIRMED_FAILED` evidence moves the execution to a terminal state. Reconciliation never dispatches. Repeating the same outcome ID and exact evidence returns the already-committed result; reusing an ID with different content is a conflict.

A D1 batch exception is conservatively returned as `COMMIT_UNKNOWN`. The caller must not dispatch or blindly retry on that result. Only an explicit committed T3 result is a prerequisite for any future adapter invocation, and such invocation remains prohibited until all acceptance gates pass.

## Local verification

Run:

```sh
npm install --no-save --no-package-lock --ignore-scripts
npm run typecheck
npm test
npm run test:d1-local
```

The D1 integration command uses Wrangler/workerd with a temporary local persistence directory, applies the versioned migration, exercises real local D1 statements, then terminates the Worker and removes the temporary database. Its checks cover T0 create/replay/conflict, concurrent T1 last-use reservation, rollback coupling when an audit constraint fails, T2 duplicate approval claims, T3 provider policy gating and intent persistence, T4 provider binding and reconciliation, zero provider calls, and audit sequence continuity.

A passing local Wrangler run is not evidence of multi-Worker behavior against an actual Cloudflare database. The following remain outstanding: real binding acceptance in an authorized staging account; multi-Worker race tests; crash/timeout/ambiguous-commit tests with authoritative recovery; provider-specific idempotency and lookup verification; full gateway-authenticated composition; security review; and separate approval before enabling or deploying consequential execution.

## Cloudflare references

- [1] D1 database Worker API and batch operations: https://developers.cloudflare.com/d1/worker-api/d1-database/
- [2] D1 read replication and primary sessions: https://developers.cloudflare.com/d1/best-practices/read-replication/
- [3] D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- [4] Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
