/**
 * RADARMatrix Delegation & Approval Tests (M2, Phase P4)
 *
 * Verifies the owner-approved M2 delegation and approval-token
 * architecture:
 *   apps/mcp-server/src/auth/delegation.ts   (scoped delegated grants)
 *   apps/mcp-server/src/auth/approvals.ts    (single-use approval tokens)
 *
 * Security invariants verified:
 * - An agent NEVER inherits its delegating actor's full authority:
 *   grants are subset-enforced at creation time.
 * - Write delegation requires the actor to hold write capability.
 * - Grants bind one agent + one workspace; mismatch fails closed.
 * - Expiry and use limits are enforced on every validation.
 * - Approvals are Ed25519-signed, short-lived, scope-bound to an
 *   exact action + exact resource list, workspace- and actor-bound,
 *   and redeemable exactly once. Replay is denied.
 * - Malformed or forged tokens fail closed.
 *
 * These modules are implemented and unit-tested but NOT yet wired
 * into the gateway; runtime execution remains future work (M3+).
 *
 * Failures are counted and returned to tests/test-runner.mjs, which
 * exits non-zero when any test fails. Standalone runs exit non-zero.
 */

import assert from "node:assert/strict";

import {
  createDelegatedGrant,
  validateGrantUse,
  recordGrantUse,
} from "../apps/mcp-server/src/auth/delegation.ts";
import {
  issueApproval,
  verifyApproval,
  createRedemptionRecord,
} from "../apps/mcp-server/src/auth/approvals.ts";
import {
  generateEd25519KeyPair,
} from "../apps/mcp-server/src/auth/token-service.ts";
import {
  TOOL_REGISTRY,
} from "../apps/mcp-server/src/chatgpt-app-contract.ts";

const W = "w_prod";
const ACTOR = "user_editor";
const AGENT = "agent_specialist_1";
const NOW = 1_000_000;

// The actor's own authority mirrors an editor in the tool registry:
// every registered tool the actor may call, write included.
const ACTOR_TOOLS = Object.keys(TOOL_REGISTRY);

function baseGrantInput(overrides) {
  return Object.assign(
    {
      grant_id: "grant_1",
      actor_id: ACTOR,
      actor_tools: ACTOR_TOOLS,
      actor_can_write: true,
      agent_id: AGENT,
      workspace_id: W,
      allowed_tools: ["radar.search"],
      allowed_actions: ["read"],
      ttl_seconds: 600,
      max_uses: 2,
      registry: TOOL_REGISTRY,
    },
    overrides || {},
  );
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// Delegated grants: subset enforcement (agent privilege escalation).
// ---------------------------------------------------------------------------
test("valid scoped grant is created", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW);
  assert.ok(grant, "valid grant must be created");
  assert.equal(grant.agent_id, AGENT);
  assert.equal(grant.workspace_id, W);
  assert.equal(grant.expires_at, NOW + 600);
  assert.equal(grant.uses, 0);
});

test("grant requesting a tool OUTSIDE the actor's authority is rejected (escalation control)", () => {
  const grant = createDelegatedGrant(
    baseGrantInput({ actor_tools: ["radar.search"] }),
    NOW,
  );
  // allowed_tools asks for radar.remember, actor only has radar.search.
  const escalated = createDelegatedGrant(
    baseGrantInput({
      actor_tools: ["radar.search"],
      allowed_tools: ["radar.remember"],
      allowed_actions: ["write"],
    }),
    NOW,
  );
  assert.equal(escalated, null, "subset violation must be rejected at creation");
  assert.ok(grant, "sanity: same actor within subset is fine");
});

test("grant requesting an unknown tool is rejected", () => {
  const g = createDelegatedGrant(
    baseGrantInput({ allowed_tools: ["totally.made_up_tool"] }),
    NOW,
  );
  assert.equal(g, null);
});

test("write delegation requires the actor to hold write capability", () => {
  const ok = createDelegatedGrant(
    baseGrantInput({
      allowed_tools: ["radar.remember"],
      allowed_actions: ["write"],
    }),
    NOW,
  );
  assert.ok(ok, "editor may delegate write");
  const denied = createDelegatedGrant(
    baseGrantInput({
      actor_can_write: false,
      allowed_tools: ["radar.remember"],
      allowed_actions: ["write"],
    }),
    NOW,
  );
  assert.equal(denied, null, "read-only actor must not delegate write");
});

test("unknown action and duplicate actions are rejected", () => {
  assert.equal(createDelegatedGrant(baseGrantInput({ allowed_actions: ["admin"] }), NOW), null);
  assert.equal(createDelegatedGrant(baseGrantInput({ allowed_actions: ["read", "read"] }), NOW), null);
  assert.equal(createDelegatedGrant(baseGrantInput({ allowed_actions: [] }), NOW), null);
});

test("absurd TTLs are rejected (too short, zero, negative, too long)", () => {
  assert.equal(createDelegatedGrant(baseGrantInput({ ttl_seconds: 0 }), NOW), null);
  assert.equal(createDelegatedGrant(baseGrantInput({ ttl_seconds: -5 }), NOW), null);
  assert.equal(createDelegatedGrant(baseGrantInput({ ttl_seconds: 60 * 60 * 24 }), NOW), null);
});

test("agent cannot equal actor (self-delegation rejected)", () => {
  assert.equal(createDelegatedGrant(baseGrantInput({ agent_id: ACTOR }), NOW), null);
});

// ---------------------------------------------------------------------------
// Delegated grants: validation-time enforcement.
// ---------------------------------------------------------------------------
test("valid use passes; agent mismatch, workspace mismatch fail closed", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW);
  assert.equal(validateGrantUse(grant, { agent_id: AGENT, workspace_id: W, tool: "radar.search", action: "read" }, NOW).valid, true);
  assert.equal(validateGrantUse(grant, { agent_id: "other_agent", workspace_id: W, tool: "radar.search", action: "read" }, NOW).reason, "agent_mismatch");
  assert.equal(validateGrantUse(grant, { agent_id: AGENT, workspace_id: "w_other", tool: "radar.search", action: "read" }, NOW).reason, "workspace_mismatch");
});

test("tool outside the grant is denied (scope not inherited)", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW);
  const r = validateGrantUse(grant, { agent_id: AGENT, workspace_id: W, tool: "radar.remember", action: "read" }, NOW);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "tool_not_allowed");
});

test("write action on a read-only grant is denied", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW);
  const r = validateGrantUse(grant, { agent_id: AGENT, workspace_id: W, tool: "radar.search", action: "write" }, NOW);
  assert.equal(r.reason, "action_not_allowed");
});

test("expired grant is denied at validation time", () => {
  const grant = createDelegatedGrant(baseGrantInput({ ttl_seconds: 60 }), NOW);
  const r = validateGrantUse(grant, { agent_id: AGENT, workspace_id: W, tool: "radar.search", action: "read" }, NOW + 61);
  assert.equal(r.reason, "grant_expired");
});

test("use limit is enforced: max_uses=2 allows two uses then denies", () => {
  const grant = createDelegatedGrant(baseGrantInput({ max_uses: 2 }), NOW);
  const check = { agent_id: AGENT, workspace_id: W, tool: "radar.search", action: "read" };
  assert.equal(validateGrantUse(grant, check, NOW).valid, true);
  assert.equal(recordGrantUse(grant), true);
  assert.equal(validateGrantUse(grant, check, NOW).valid, true);
  assert.equal(recordGrantUse(grant), true);
  assert.equal(validateGrantUse(grant, check, NOW).reason, "use_limit_reached");
  assert.equal(recordGrantUse(grant), false, "double-count must be refused");
});

test("malformed grant objects fail closed", () => {
  assert.equal(validateGrantUse(null, { agent_id: AGENT, workspace_id: W, tool: "radar.search", action: "read" }, NOW).valid, false);
  assert.equal(validateGrantUse({}, { agent_id: AGENT, workspace_id: W, tool: "radar.search", action: "read" }, NOW).reason, "malformed_grant");
});

// ---------------------------------------------------------------------------
// Approval tokens.
// ---------------------------------------------------------------------------
const approvalKeys = generateEd25519KeyPair();
const attackerKeys = generateEd25519KeyPair();

function issueFor(overrides, keys) {
  return issueApproval(
    Object.assign(
      {
        action: "shell.exec",
        resource_ids: ["res_1"],
        workspace_id: W,
        actor_id: ACTOR,
        ttl_seconds: 300,
        now: NOW,
      },
      overrides || {},
    ),
    (keys || approvalKeys).privateKeyPem,
  );
}

function checkFor(overrides) {
  return Object.assign(
    { action: "shell.exec", resource_id: "res_1", workspace_id: W, actor_id: ACTOR },
    overrides || {},
  );
}

test("valid approval verifies and redeems exactly once", () => {
  const issued = issueFor();
  assert.ok(issued && issued.token, "approval must issue");
  const redemption = createRedemptionRecord();
  const first = verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor(), redemption, NOW + 1);
  assert.equal(first.valid, true);
  const replay = verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor(), redemption, NOW + 2);
  assert.equal(replay.valid, false);
  assert.equal(replay.reason, "replayed");
});

test("forged approval (attacker key) fails signature verification", () => {
  const forged = issueFor({}, attackerKeys);
  const r = verifyApproval(forged.token, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 1);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "bad_signature");
});

test("expired approval is denied", () => {
  const issued = issueFor({ ttl_seconds: 60 });
  const r = verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 61);
  assert.equal(r.reason, "expired");
});

test("wrong action is denied (exact scope match)", () => {
  const issued = issueFor({ action: "file.write" });
  const r = verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor({ action: "shell.exec" }), createRedemptionRecord(), NOW + 1);
  assert.equal(r.reason, "action_mismatch");
});

test("unapproved resource id is denied — no wildcard resources", () => {
  const issued = issueFor({ resource_ids: ["res_1", "res_2"] });
  const r = verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor({ resource_id: "res_999" }), createRedemptionRecord(), NOW + 1);
  assert.equal(r.reason, "resource_mismatch");
});

test("cross-workspace and cross-actor redemption is denied", () => {
  const issued = issueFor();
  const red = createRedemptionRecord();
  assert.equal(verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor({ workspace_id: "w_other" }), red, NOW + 1).reason, "workspace_mismatch");
  assert.equal(verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor({ actor_id: "someone_else" }), red, NOW + 1).reason, "actor_mismatch");
  assert.equal(red.size(), 0, "failed redemptions must not consume the jti");
});

test("grant-bound approval cannot be redeemed with a different grant id", () => {
  const issued = issueFor({ grant_id: "grant_9" });
  const red = createRedemptionRecord();
  assert.equal(verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor({ grant_id: "grant_9" }), red, NOW + 1).valid, true);
  const issued2 = issueFor({ grant_id: "grant_9", action: "shell.exec", resource_ids: ["res_3"] });
  assert.equal(verifyApproval(issued2.token, approvalKeys.publicKeyPem, checkFor({ grant_id: "grant_other", resource_id: "res_3" }), red, NOW + 1).reason, "grant_mismatch");
});

test("issueApproval rejects invalid inputs (empty resources, bad TTLs)", () => {
  assert.equal(issueFor({ resource_ids: [] }), null);
  assert.equal(issueFor({ ttl_seconds: 0 }), null);
  assert.equal(issueFor({ ttl_seconds: -1 }), null);
  assert.equal(issueFor({ ttl_seconds: 60 * 60 * 24 }), null);
  assert.equal(issueFor({ action: "" }), null);
  assert.equal(issueFor({ workspace_id: "" }), null);
  assert.equal(issueFor({ actor_id: "" }), null);
});

test("malformed approval tokens fail closed", () => {
  const red = createRedemptionRecord();
  assert.equal(verifyApproval("", approvalKeys.publicKeyPem, checkFor(), red, NOW).reason, "missing_token");
  assert.equal(verifyApproval("only-one-part", approvalKeys.publicKeyPem, checkFor(), red, NOW).reason, "malformed_token");
  assert.equal(verifyApproval("bm90LWpzb24.bm90LWEtc2ln", approvalKeys.publicKeyPem, checkFor(), red, NOW).reason, "malformed_token");
});

test("tampered approval payload fails signature verification", () => {
  const issued = issueFor();
  const parts = issued.token.split(".");
  const forgedClaims = Buffer.from(
    JSON.stringify(Object.assign({}, issued.claims, { resource_ids: ["res_1", "res_evil"] })),
  ).toString("base64url");
  const tampered = forgedClaims + "." + parts[1];
  const r = verifyApproval(tampered, approvalKeys.publicKeyPem, checkFor({ resource_id: "res_evil" }), createRedemptionRecord(), NOW + 1);
  assert.equal(r.reason, "bad_signature");
});

// ---------------------------------------------------------------------------
// Harness (M1a/M2 convention): failures propagate to the exit code.
// ---------------------------------------------------------------------------
export function runAllTests() {
  let failed = 0;
  let passed = 0;
  for (const { name, fn } of tests) {
    try {
      fn();
      passed += 1;
      console.log("  ✓ " + name);
    } catch (error) {
      failed += 1;
      console.log("  ✗ " + name + ": " + (error && error.message ? error.message : String(error)));
    }
  }
  console.log("\nDelegation & approval tests: " + passed + " passed, " + failed + " failed");
  return { failed, passed };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const { failed } = runAllTests();
  process.exit(failed > 0 ? 1 : 0);
}
