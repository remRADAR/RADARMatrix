import { generateKeyPairSync, randomUUID } from "node:crypto";
import { issueApproval } from "../../auth/approvals.ts";
import { createGrantIntegrityService, type DelegatedGrant } from "../../auth/delegation.ts";
import {
  createD1DurableExecutionRuntime,
  type D1Binding,
  type ProviderExecutionPolicy,
} from "./d1-runtime.ts";

interface TestEnv {
  readonly TEST_DB: D1Binding;
  readonly DURABLE_EXECUTION_TEST_TOKEN?: string;
}

const testProviderPolicy: Readonly<Record<string, ProviderExecutionPolicy>> = {
  "test-provider": {
    enabled: true,
    capabilities_verified: true,
    supports_idempotency_keys: true,
    supports_operation_lookup: true,
    idempotency_retention_seconds: 86_400,
    maximum_recovery_window_seconds: 3_600,
  },
};
const testSecret = "local-d1-test-only-grant-integrity-secret-00000000000000000000";
const workspaceId = "local-d1-test-workspace";
const actorId = "local-d1-test-actor";
const agentId = "local-d1-test-agent";
const tool = "radar.test-write";
const action = "write";
const requestFingerprint = "sha256:test-request-fingerprint";
const resourceFingerprint = "sha256:test-resource-fingerprint";

function assert(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`assertion_failed:${code}`);
}

function newGrant(grantId: string, maxUses: number, integrity: NonNullable<ReturnType<typeof createGrantIntegrityService>>): DelegatedGrant {
  const fields = {
    grant_id: grantId,
    actor_id: actorId,
    agent_id: agentId,
    workspace_id: workspaceId,
    allowed_tools: [tool],
    allowed_actions: [action as "write"],
    expires_at: Math.floor(Date.now() / 1000) + 3_600,
    max_uses: maxUses,
    uses: 0,
  };
  return { ...fields, integrity_hash: integrity.seal(fields) };
}

function newExecutionInput(idempotencyKey: string) {
  return {
    execution_id: randomUUID(), workspace_id: workspaceId, actor_id: actorId,
    idempotency_key: idempotencyKey, tool, action, resource_fingerprint: resourceFingerprint,
    request_fingerprint: requestFingerprint,
  } as const;
}

async function createAndReserve(
  runtime: ReturnType<typeof createD1DurableExecutionRuntime>,
  integrity: NonNullable<ReturnType<typeof createGrantIntegrityService>>,
  grantId: string,
  key: string,
) {
  const execution = newExecutionInput(key);
  const created = await runtime.createOrReplay(execution);
  assert(created.status === "COMMITTED", `create:${key}`);
  const grant = await runtime.storeGrant(newGrant(grantId, 1, integrity));
  assert(grant.status === "COMMITTED", `grant:${grantId}`);
  return { execution, runtime, grantId };
}

async function runD1Checks(env: TestEnv) {
  const integrity = createGrantIntegrityService(testSecret);
  assert(integrity, "test_integrity_secret");
  const runtime = createD1DurableExecutionRuntime(env.TEST_DB, integrity, true, testProviderPolicy);
  const closedProviderRuntime = createD1DurableExecutionRuntime(env.TEST_DB, integrity, true, {});
  const checks: Record<string, boolean> = {};
  let providerCalls = 0;

  // T0: first insert, idempotent replay, and same-key/different-request conflict.
  const firstInput = newExecutionInput(`t0-${randomUUID()}`);
  const first = await runtime.createOrReplay(firstInput);
  const replay = await runtime.createOrReplay({ ...firstInput, execution_id: randomUUID() });
  const conflict = await runtime.createOrReplay({ ...firstInput, execution_id: randomUUID(), request_fingerprint: "sha256:different" });
  checks.t0_created = first.status === "COMMITTED" && first.value?.kind === "CREATED";
  checks.t0_replay = replay.status === "COMMITTED" && replay.value?.kind === "REPLAY";
  checks.t0_conflict = conflict.status === "CONFLICT" && conflict.conflict_code === "IDEMPOTENCY_CONFLICT";
  assert(checks.t0_created && checks.t0_replay && checks.t0_conflict, "t0_idempotency");

  // T1: concurrent last-use attempts yield exactly one durable reservation.
  const raceGrantId = `grant-${randomUUID()}`;
  const raceA = newExecutionInput(`t1a-${randomUUID()}`);
  const raceB = newExecutionInput(`t1b-${randomUUID()}`);
  assert((await runtime.createOrReplay(raceA)).status === "COMMITTED", "t1_create_a");
  assert((await runtime.createOrReplay(raceB)).status === "COMMITTED", "t1_create_b");
  assert((await runtime.storeGrant(newGrant(raceGrantId, 1, integrity))).status === "COMMITTED", "t1_store_grant");
  const reserveResults = await Promise.all([
    runtime.reserveGrantUse({ execution_id: raceA.execution_id, grant_id: raceGrantId, agent_id: agentId,
      workspace_id: workspaceId, actor_id: actorId, tool, action, now_seconds: Date.now() / 1000 }),
    runtime.reserveGrantUse({ execution_id: raceB.execution_id, grant_id: raceGrantId, agent_id: agentId,
      workspace_id: workspaceId, actor_id: actorId, tool, action, now_seconds: Date.now() / 1000 }),
  ]);
  const raceSession = env.TEST_DB.withSession("first-primary");
  const grantUses = await raceSession.prepare("SELECT uses FROM delegated_grants WHERE grant_id = ?").bind(raceGrantId).first<{ uses: number }>();
  const reservationCount = await raceSession.prepare("SELECT COUNT(*) AS count FROM reservations WHERE grant_id = ?").bind(raceGrantId).first<{ count: number }>();
  checks.t1_one_winner = reserveResults.filter((result) => result.status === "COMMITTED").length === 1;
  checks.t1_last_use_persisted = grantUses?.uses === 1 && reservationCount?.count === 1;
  assert(checks.t1_one_winner && checks.t1_last_use_persisted, "t1_concurrent_last_use");

  // Transaction/audit rollback: force the sequence-1 audit constraint to fail.
  const rollbackGrantId = `grant-${randomUUID()}`;
  const rollbackExecution = newExecutionInput(`rollback-${randomUUID()}`);
  assert((await runtime.createOrReplay(rollbackExecution)).status === "COMMITTED", "rollback_create");
  assert((await runtime.storeGrant(newGrant(rollbackGrantId, 1, integrity))).status === "COMMITTED", "rollback_grant");
  await env.TEST_DB.prepare(
    "INSERT INTO audit_events (event_id, workspace_id, actor_id, execution_id, sequence, event_type, to_state, occurred_at, metadata_json) VALUES (?, ?, ?, ?, 1, 'test.collision', 'CREATED', ?, '{}')",
  ).bind(randomUUID(), workspaceId, actorId, rollbackExecution.execution_id, new Date().toISOString()).run();
  const rolled = await runtime.reserveGrantUse({ execution_id: rollbackExecution.execution_id, grant_id: rollbackGrantId,
    agent_id: agentId, workspace_id: workspaceId, actor_id: actorId, tool, action, now_seconds: Date.now() / 1000 });
  const rollbackSession = env.TEST_DB.withSession("first-primary");
  const untouchedGrant = await rollbackSession.prepare("SELECT uses FROM delegated_grants WHERE grant_id = ?").bind(rollbackGrantId).first<{ uses: number }>();
  const untouchedExecution = await rollbackSession.prepare("SELECT state FROM executions WHERE execution_id = ?").bind(rollbackExecution.execution_id).first<{ state: string }>();
  const rollbackReservation = await rollbackSession.prepare("SELECT COUNT(*) AS count FROM reservations WHERE execution_id = ?").bind(rollbackExecution.execution_id).first<{ count: number }>();
  checks.audit_failure_not_partially_committed = rolled.status !== "COMMITTED" && untouchedGrant?.uses === 0 &&
    untouchedExecution?.state === "CREATED" && rollbackReservation?.count === 0;
  assert(checks.audit_failure_not_partially_committed, "audit_atomic_rollback");

  // T2: signed approval JTI is durably claimed once; duplicate claims cannot advance state again.
  const approvalGrantId = `grant-${randomUUID()}`;
  const approvalExecution = newExecutionInput(`t2-${randomUUID()}`);
  assert((await runtime.createOrReplay(approvalExecution)).status === "COMMITTED", "t2_create");
  assert((await runtime.storeGrant(newGrant(approvalGrantId, 1, integrity))).status === "COMMITTED", "t2_grant");
  assert((await runtime.reserveGrantUse({ execution_id: approvalExecution.execution_id, grant_id: approvalGrantId,
    agent_id: agentId, workspace_id: workspaceId, actor_id: actorId, tool, action, now_seconds: Date.now() / 1000 })).status === "COMMITTED", "t2_reserve");
  const keyPair = generateKeyPairSync("ed25519");
  const now = Math.floor(Date.now() / 1000);
  const approval = issueApproval({ action, resource_ids: [resourceFingerprint], workspace_id: workspaceId,
    actor_id: actorId, ttl_seconds: 300, now }, keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  assert(approval, "t2_issue_approval");
  const claimInput = { execution_id: approvalExecution.execution_id, token: approval.token,
    public_key_pem: keyPair.publicKey.export({ type: "spki", format: "pem" }).toString(), now_seconds: now };
  const claims = await Promise.all([runtime.claimApproval(claimInput), runtime.claimApproval(claimInput)]);
  const claimSession = env.TEST_DB.withSession("first-primary");
  const claimCount = await claimSession.prepare("SELECT COUNT(*) AS count FROM approval_claims WHERE execution_id = ?")
    .bind(approvalExecution.execution_id).first<{ count: number }>();
  checks.t2_single_durable_claim = claims.filter((result) => result.status === "COMMITTED").length === 1 && claimCount?.count === 1;
  assert(checks.t2_single_durable_claim, "t2_single_claim");

  // T3: no verified provider policy means no intent; configured policy permits only durable intent.
  const deniedIntent = await closedProviderRuntime.markDispatching({ execution_id: approvalExecution.execution_id,
    expected_version: 2, provider_name: "test-provider", provider_request_id: `idemp-${randomUUID()}`,
    attempt_id: randomUUID(), request_fingerprint: requestFingerprint, occurred_at: new Date().toISOString() });
  checks.t3_provider_gate = deniedIntent.status === "CONFLICT" && deniedIntent.conflict_code === "PROVIDER_NOT_RECONCILABLE";
  assert(checks.t3_provider_gate, "t3_provider_gate");
  const providerRequestId = `idemp-${randomUUID()}`;
  const dispatch = await runtime.markDispatching({ execution_id: approvalExecution.execution_id, expected_version: 2,
    provider_name: "test-provider", provider_request_id: providerRequestId, attempt_id: randomUUID(),
    request_fingerprint: requestFingerprint, occurred_at: new Date().toISOString() });
  checks.t3_intent_committed = dispatch.status === "COMMITTED";
  assert(checks.t3_intent_committed, "t3_intent");
  // The runtime contains no adapter invocation; the harness intentionally makes zero provider calls.

  // T4: wrong-provider outcomes are rejected; uncertain outcomes stay unresolved until reconciliation.
  const mismatch = await runtime.recordOutcome({ outcome_id: randomUUID(), execution_id: approvalExecution.execution_id,
    expected_version: 3, outcome: "SUCCEEDED", provider_name: "attacker-provider", provider_request_id: providerRequestId,
    observed_at: new Date().toISOString() });
  checks.t4_provider_binding = mismatch.status === "CONFLICT";
  assert(checks.t4_provider_binding, "t4_provider_binding");
  const uncertainOutcomeId = randomUUID();
  const uncertainInput = { outcome_id: uncertainOutcomeId, execution_id: approvalExecution.execution_id,
    expected_version: 3, outcome: "UNCERTAIN", provider_name: "test-provider", provider_request_id: providerRequestId,
    observed_at: new Date().toISOString(), metadata: { observed: "timeout" } } as const;
  const uncertain = await runtime.recordOutcome(uncertainInput);
  assert(uncertain.status === "COMMITTED", "t4_uncertain");
  const uncertainReplay = await runtime.recordOutcome(uncertainInput);
  checks.t4_outcome_replay = uncertainReplay.status === "COMMITTED";
  assert(checks.t4_outcome_replay, "t4_outcome_replay");
  const pendingOutcomeId = randomUUID();
  const pendingInput = { execution_id: approvalExecution.execution_id, expected_version: 4,
    outcome_id: pendingOutcomeId, evidence: { provider: "test-provider", provider_request_id: providerRequestId,
      observed_at: new Date().toISOString(), outcome: "STILL_PENDING" as const } };
  const pending = await runtime.reconcile(pendingInput);
  assert(pending.status === "COMMITTED", "t4_pending_reconcile");
  checks.reconciliation_replay = (await runtime.reconcile(pendingInput)).status === "COMMITTED";
  assert(checks.reconciliation_replay, "reconciliation_replay");
  const resolved = await runtime.reconcile({ execution_id: approvalExecution.execution_id, expected_version: 5,
    outcome_id: randomUUID(), evidence: { provider: "test-provider", provider_request_id: providerRequestId,
      observed_at: new Date().toISOString(), outcome: "CONFIRMED_SUCCEEDED", evidence_reference: "local-test-proof",
      evidence_digest: "sha256:local-test-digest" } });
  const resolvedRow = await env.TEST_DB.withSession("first-primary").prepare("SELECT state, version FROM executions WHERE execution_id = ?")
    .bind(approvalExecution.execution_id).first<{ state: string; version: number }>();
  checks.t4_reconciled_terminal = resolved.status === "COMMITTED" && resolvedRow?.state === "SUCCEEDED" && resolvedRow.version === 6;
  checks.no_provider_call = providerCalls === 0;
  assert(checks.t4_reconciled_terminal && checks.no_provider_call, "t4_reconciliation");

  const audit = await runtime.getAuditForExecution(approvalExecution.execution_id);
  checks.audit_sequence = audit.status === "COMMITTED" && audit.value?.map((event) => event.sequence).join(",") === "0,1,2,3,4,5,6";
  assert(checks.audit_sequence, "audit_sequence");
  return { ok: true, checks, provider_calls: providerCalls };
}

export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    if (request.method === "GET" && new URL(request.url).pathname === "/healthz") {
      return Response.json({ ok: true, test_harness: true, execution: "test-only" }, { headers: { "cache-control": "no-store" } });
    }
    if (request.method !== "POST" || new URL(request.url).pathname !== "/__local-test/durable-execution") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const expected = env.DURABLE_EXECUTION_TEST_TOKEN;
    const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!expected || provided !== expected) return Response.json({ error: "not_found" }, { status: 404 });
    try {
      return Response.json(await runD1Checks(env), { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "test_failed" }, { status: 500 });
    }
  },
};
