/**
 * RADARMatrix M2.2.1 Security Correction Suite
 *
 * Owner-directed corrections (M2.2.1 directive, 2026-11-04), each
 * verified with REAL denial behavior — no mock that skips the
 * security boundary:
 *
 *   A. Grant integrity: the seal is a server-held HMAC-SHA-256 over
 *      EVERY security-relevant field (grant id, actor, agent,
 *      workspace, tools, actions, expiry, max uses, current uses).
 *      Complete mutation matrix + unkeyed-hash bypass + wrong/missing
 *      secret fail-closed.
 *   B. Atomic grant-use enforcement: reserveGrantUse consumes the use
 *      BEFORE dispatch through the M2.2.1 compatibility adapter
 *      (apps/mcp-server/src/runtime/github-readonly.ts — the branch
 *      copy; the original M3 branch is untouched).
 *   C. Trusted actor provenance: authority originates ONLY from the
 *      runtime-branded trusted context minted by
 *      createTrustedActorContext (verified membership).
 *   D. Approval ordering and replay: grant validation -> reservation
 *      -> approval redemption immediately before dispatch; failed
 *      grant checks never consume approvals; failed approvals never
 *      dispatch.
 *   E. Membership file hardening: exclusive temp creation ("wx"),
 *      restrictive permissions (0o600), atomic replacement, safe
 *      cleanup, fail-closed corrupt/missing.
 *
 * Failures are counted and returned to tests/test-runner.mjs, which
 * exits non-zero when any test fails. Standalone runs exit non-zero.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  createDelegatedGrant,
  validateGrantUse,
  reserveGrantUse,
  deriveActorAuthority,
  createGrantIntegrityService,
  createTrustedActorContext,
} from "../apps/mcp-server/src/auth/delegation.ts";
import {
  issueApproval,
  verifyApproval,
  createRedemptionRecord,
} from "../apps/mcp-server/src/auth/approvals.ts";
import { createGitHubReadOnlyAdapter } from "../apps/mcp-server/src/runtime/github-readonly.ts";
import { FileMembershipProvider } from "../apps/mcp-server/src/providers/membership-file.cjs";
import {
  generateEd25519KeyPair,
} from "../apps/mcp-server/src/auth/token-service.ts";
import {
  TOOL_REGISTRY,
} from "../apps/mcp-server/src/chatgpt-app-contract.ts";

const NOW = 1_000_000;
const W = "w_prod";
const ACTOR = "user_editor";
const AGENT = "agent_specialist_1";
const SECRET = "m2-2-1-correction-suite-integrity-secret-0123456789";
const INTEGRITY = createGrantIntegrityService(SECRET);
assert.ok(INTEGRITY, "integrity service must construct");

function membershipFor(role, opts) {
  const o = opts || {};
  return {
    isMember(caller, ws) {
      if (o.isMember !== undefined) return o.isMember(caller, ws);
      return caller === (o.actor || ACTOR) && ws === (o.workspace || W);
    },
    getRole(caller, ws) {
      if (caller !== (o.actor || ACTOR) || ws !== (o.workspace || W)) return null;
      return o.rawRole !== undefined ? o.rawRole : role;
    },
  };
}

function trustedActor(role, opts) {
  return createTrustedActorContext(
    { caller_id: (opts && opts.actor) || ACTOR, workspace_id: (opts && opts.workspace) || W },
    membershipFor(role, opts),
  );
}

function baseGrantInput(overrides) {
  return Object.assign(
    {
      grant_id: "grant_1",
      agent_id: AGENT,
      allowed_tools: ["radar.search"],
      allowed_actions: ["read"],
      ttl_seconds: 600,
      max_uses: 1,
      registry: TOOL_REGISTRY,
      actor: trustedActor("editor"),
    },
    overrides || {},
  );
}

function baseCheck(overrides) {
  return Object.assign(
    { agent_id: AGENT, workspace_id: W, tool: "radar.search", action: "read" },
    overrides || {},
  );
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// A. Grant integrity — complete mutation matrix.
// ---------------------------------------------------------------------------
test("A: modified ACTOR ID is rejected (seal binds actor identity)", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  const r = validateGrantUse(Object.assign({}, grant, { actor_id: "attacker_admin" }), baseCheck(), NOW, INTEGRITY);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "grant_mutated");
});

test("A: modified AGENT ID is rejected", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  assert.equal(
    validateGrantUse(Object.assign({}, grant, { agent_id: "agent_intruder" }), baseCheck({ agent_id: "agent_intruder" }), NOW, INTEGRITY).reason,
    "grant_mutated",
  );
});

test("A: modified WORKSPACE is rejected", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  assert.equal(
    validateGrantUse(Object.assign({}, grant, { workspace_id: "w_other" }), baseCheck({ workspace_id: "w_other" }), NOW, INTEGRITY).reason,
    "grant_mutated",
  );
});

test("A: modified TOOL/ACTION scope is rejected", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  assert.equal(
    validateGrantUse(Object.assign({}, grant, { allowed_tools: ["radar.search", "radar.remember"] }), baseCheck({ tool: "radar.remember" }), NOW, INTEGRITY).reason,
    "grant_mutated",
  );
  assert.equal(
    validateGrantUse(Object.assign({}, grant, { allowed_actions: ["read", "write"] }), baseCheck({ action: "write" }), NOW, INTEGRITY).reason,
    "grant_mutated",
  );
});

test("A: modified EXPIRY is rejected", () => {
  const grant = createDelegatedGrant(baseGrantInput({ ttl_seconds: 60 }), NOW, INTEGRITY);
  assert.equal(
    validateGrantUse(Object.assign({}, grant, { expires_at: NOW + 99999 }), baseCheck(), NOW, INTEGRITY).reason,
    "grant_mutated",
  );
});

test("A: modified MAX-USE COUNT is rejected", () => {
  const grant = createDelegatedGrant(baseGrantInput({ max_uses: 1 }), NOW, INTEGRITY);
  assert.equal(
    validateGrantUse(Object.assign({}, grant, { max_uses: 999 }), baseCheck(), NOW, INTEGRITY).reason,
    "grant_mutated",
  );
});

test("A: modified CURRENT-USE COUNT (rollback/reset attack) is rejected", () => {
  const grant = createDelegatedGrant(baseGrantInput({ max_uses: 1 }), NOW, INTEGRITY);
  assert.equal(reserveGrantUse(grant, INTEGRITY, NOW).reserved, true);
  assert.equal(grant.uses, 1);
  // Attacker resets the counter WITHOUT the secret:
  const reset = Object.assign({}, grant, { uses: 0 });
  assert.equal(validateGrantUse(reset, baseCheck(), NOW, INTEGRITY).reason, "grant_mutated");
  assert.equal(reserveGrantUse(reset, INTEGRITY, NOW).reason, "grant_mutated");
});

test("A: modified GRANT ID is rejected", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  assert.equal(
    validateGrantUse(Object.assign({}, grant, { grant_id: "grant_forged" }), baseCheck(), NOW, INTEGRITY).reason,
    "grant_mutated",
  );
});

test("A: missing or malformed seal is rejected", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  assert.equal(validateGrantUse(Object.assign({}, grant, { integrity_hash: "" }), baseCheck(), NOW, INTEGRITY).reason, "malformed_grant");
  assert.equal(validateGrantUse(Object.assign({}, grant, { integrity_hash: "not-hex-at-all" }), baseCheck(), NOW, INTEGRITY).reason, "grant_mutated");
  const noSeal = Object.assign({}, grant);
  delete noSeal.integrity_hash;
  assert.equal(validateGrantUse(noSeal, baseCheck(), NOW, INTEGRITY).reason, "malformed_grant");
});

test("A: a recomputed UNKEYED hash cannot bypass integrity", () => {
  const grant = createDelegatedGrant(baseGrantInput({ max_uses: 1 }), NOW, INTEGRITY);
  const attacker = Object.assign({}, grant, { max_uses: 999 });
  const canonical = JSON.stringify([
    attacker.grant_id, attacker.actor_id, attacker.agent_id, attacker.workspace_id,
    attacker.allowed_tools.slice().sort(),
    attacker.allowed_actions.slice().sort(),
    attacker.expires_at, attacker.max_uses, attacker.uses,
  ]);
  attacker.integrity_hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  assert.equal(validateGrantUse(attacker, baseCheck(), NOW, INTEGRITY).reason, "grant_mutated");
});

test("A: wrong or missing HMAC secret fails closed", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  // Missing service:
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, null).reason, "integrity_unavailable");
  // Wrong secret:
  const wrong = createGrantIntegrityService("a-completely-different-server-secret-abcdefghijklmnopqrstuvwxyz");
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, wrong).reason, "grant_mutated");
  // Weak secret cannot even construct a service:
  assert.equal(createGrantIntegrityService("short"), null);
});

test("A: valid unmodified grant continues to work", () => {
  const grant = createDelegatedGrant(baseGrantInput({ max_uses: 1 }), NOW, INTEGRITY);
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, INTEGRITY).valid, true);
  assert.equal(reserveGrantUse(grant, INTEGRITY, NOW).reserved, true);
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, INTEGRITY).reason, "use_limit_reached");
  assert.equal(reserveGrantUse(grant, INTEGRITY, NOW).reserved, false);
});

// ---------------------------------------------------------------------------
// Adapter harness (deterministic transport) for B and D.
// ---------------------------------------------------------------------------

/** Deterministic transport: counts dispatches, returns a 200 JSON body. */
function makeTransport(opts) {
  const o = opts || {};
  let calls = 0;
  const urls = [];
  const impl = (url, init) => {
    calls += 1;
    urls.push(String(url));
    if (o.behavior === "hang") {
      return new Promise((_resolve, reject) => {
        if (init && init.signal) {
          init.signal.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }
      });
    }
    if (o.behavior === "reject") {
      const e = new Error("connection refused");
      e.name = "Error";
      return Promise.reject(e);
    }
    return Promise.resolve({
      status: 200,
      text: () => Promise.resolve("{\"ok\":true}"),
    });
  };
  return {
    fetchImpl: impl,
    count: () => calls,
    urls: () => urls,
  };
}

/** Registry with one approval-gated operation (for D ordering tests). */
const TEST_OPERATIONS = {
  "github.read.branches": {
    name: "github.read.branches",
    description: "List a repository's branches (test copy)",
    method: "GET",
    pathTemplate: "/repos/{owner}/{repo}/branches",
    requiredParams: ["owner", "repo"],
    requiresApproval: false,
  },
  "github.read.sensitive": {
    name: "github.read.sensitive",
    description: "Approval-gated read (test-only operation)",
    method: "GET",
    pathTemplate: "/repos/{owner}/{repo}/collaborators",
    requiredParams: ["owner", "repo"],
    requiresApproval: true,
  },
};

/**
 * The TOOL_REGISTRY extended with the read-only test operations so
 * grants for them derive legally from the editor actor (the
 * delegation subset rule validates against the registry input).
 */
const TEST_REGISTRY = Object.assign({}, TOOL_REGISTRY, {
  "github.read.branches": { required_role: "viewer", is_write_operation: false },
  "github.read.sensitive": { required_role: "viewer", is_write_operation: false },
});

function adapterGrant(maxUses, overrides) {
  return createDelegatedGrant(
    baseGrantInput(Object.assign({ max_uses: maxUses, registry: TEST_REGISTRY, allowed_tools: ["github.read.branches", "github.read.sensitive"] }, overrides || {})),
    NOW,
    INTEGRITY,
  );
}

function adapterRequest(overrides) {
  return Object.assign(
    {
      command: "github.read.branches",
      args: { owner: "remRADAR", repo: "RADARMatrix" },
      authority: { agent_id: AGENT, workspace_id: W, grant: adapterGrant(1) },
    },
    overrides || {},
  );
}

function makeAdapter(transport, extraConfig) {
  return createGitHubReadOnlyAdapter(
    Object.assign(
      {
        token: "gh_test_token",
        baseUrl: "https://api.test.local",
        fetchImpl: transport.fetchImpl,
        operations: TEST_OPERATIONS,
        grantIntegrity: INTEGRITY,
        now: NOW,
        defaultTimeoutMs: 5,
      },
      extraConfig || {},
    ),
  );
}

// ---------------------------------------------------------------------------
// B. Atomic grant-use enforcement (compat adapter).
// ---------------------------------------------------------------------------
test("B: two SIMULTANEOUS requests against ONE remaining use — exactly one reaches the transport", async () => {
  const transport = makeTransport();
  const adapter = makeAdapter(transport);
  const grant = adapterGrant(1); // ONE remaining use
  const request = (authority) => adapterRequest({ authority: { agent_id: AGENT, workspace_id: W, grant: authority } });
  const [r1, r2] = await Promise.all([
    adapter.execute(request(grant)),
    adapter.execute(request(grant)),
  ]);
  assert.equal(transport.count(), 1, "exactly one request may reach the transport");
  const statuses = [r1.status, r2.status].sort();
  assert.equal(statuses[0], "denied", "the losing reservation must be DENIED");
  assert.equal(statuses[1], "executed", "the winning reservation must EXECUTE");
  const denied = r1.status === "denied" ? r1 : r2;
  assert.equal(denied.notes, "authority_denied", "the loser fails the pre-reservation capacity check");
});

test("B: exhausted grant — ZERO external requests", async () => {
  const transport = makeTransport();
  const adapter = makeAdapter(transport);
  const grant = adapterGrant(1);
  assert.equal(reserveGrantUse(grant, INTEGRITY, NOW).reserved, true, "exhaust the grant");
  const r = await adapter.execute(adapterRequest({ authority: { agent_id: AGENT, workspace_id: W, grant } }));
  assert.equal(r.status, "denied");
  assert.equal(transport.count(), 0, "an exhausted grant must never dispatch");
});

test("B: expired grant — ZERO external requests", async () => {
  const transport = makeTransport();
  const adapter = makeAdapter(transport);
  const expiredGrant = createDelegatedGrant(
    baseGrantInput({ registry: TEST_REGISTRY, allowed_tools: ["github.read.branches"], ttl_seconds: 60 }),
    NOW - 120,
    INTEGRITY,
  );
  assert.ok(expiredGrant, "the expired grant must be constructible (issued in the past)");
  const r = await adapter.execute(adapterRequest({ authority: { agent_id: AGENT, workspace_id: W, grant: expiredGrant } }));
  assert.equal(r.status, "denied");
  assert.equal(r.notes, "authority_denied");
  assert.equal(transport.count(), 0, "an expired grant must never dispatch");
});

test("B: invalid integrity seal — ZERO external requests", async () => {
  const transport = makeTransport();
  const adapter = makeAdapter(transport);
  const grant = adapterGrant(1);
  const mutated = Object.assign({}, grant, { max_uses: 999 });
  const r = await adapter.execute(adapterRequest({ authority: { agent_id: AGENT, workspace_id: W, grant: mutated } }));
  assert.equal(r.status, "denied");
  assert.equal(r.notes, "authority_denied");
  assert.equal(transport.count(), 0, "a mutated grant must never dispatch");
});

test("B: missing grant integrity service — every authority-bearing execution DENIED (fail closed)", async () => {
  const transport = makeTransport();
  const adapter = createGitHubReadOnlyAdapter({
    token: "gh_test_token",
    baseUrl: "https://api.test.local",
    fetchImpl: transport.fetchImpl,
    operations: TEST_OPERATIONS,
    grantIntegrity: null,
    now: NOW,
  });
  const r = await adapter.execute(adapterRequest());
  assert.equal(r.status, "denied");
  assert.equal(r.notes, "grant_integrity_unavailable");
  assert.equal(transport.count(), 0);
});

test("B: transport TIMEOUT follows the documented reservation policy — the use stays consumed", async () => {
  const transport = makeTransport({ behavior: "hang" });
  const adapter = makeAdapter(transport);
  const grant = adapterGrant(1);
  const r = await adapter.execute(
    adapterRequest({ authority: { agent_id: AGENT, workspace_id: W, grant }, timeoutMs: 5 }),
  );
  assert.equal(r.status, "unavailable");
  assert.equal(r.notes, "timeout");
  // No refund on uncertain outcome: the reservation stands.
  assert.equal(grant.uses, 1, "the timed-out reservation must NOT be refunded");
  assert.equal(reserveGrantUse(grant, INTEGRITY, NOW).reserved, false, "a refunded use would enable over-use — forbidden");
});

test("B: concurrent requests NEVER exceed the use limit (5 concurrent vs max_uses=2 — exactly 2 dispatch)", async () => {
  const transport = makeTransport();
  const adapter = makeAdapter(transport);
  const grant = adapterGrant(2);
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      adapter.execute(adapterRequest({ authority: { agent_id: AGENT, workspace_id: W, grant } })),
    ),
  );
  assert.equal(transport.count(), 2, "exactly max_uses requests may reach the transport");
  const executed = results.filter((r) => r.status === "executed").length;
  assert.equal(executed, 2, "exactly two executions");
  assert.equal(results.filter((r) => r.status === "denied").length, 3);
});

test("B: deterministic adapter behavior preserved (allowlist + argument law)", async () => {
  const transport = makeTransport();
  const adapter = makeAdapter(transport);
  const r1 = await adapter.execute(adapterRequest({ command: "not.in.allowlist" }));
  assert.equal(r1.status, "denied");
  assert.equal(r1.notes, "operation_not_in_allowlist");
  const r2 = await adapter.execute(adapterRequest({ args: { owner: "remRADAR" } }));
  assert.equal(r2.status, "denied");
  assert.equal(r2.notes, "missing_or_invalid_argument");
  const r3 = await adapter.execute(adapterRequest({ args: { owner: "remRADAR", repo: "RADARMatrix", rogue: "x" } }));
  assert.equal(r3.status, "denied");
  assert.equal(r3.notes, "unknown_argument");
  const ok = await adapter.execute(adapterRequest());
  assert.equal(ok.status, "executed");
  assert.equal(transport.count(), 1, "only the valid request reached the transport");
  assert.ok(transport.urls()[0].startsWith("https://api.test.local/repos/remRADAR/RADARMatrix/branches"));
});

// ---------------------------------------------------------------------------
// C. Trusted actor provenance.
// ---------------------------------------------------------------------------
test("C: caller-supplied ADMIN ROLE is rejected (runtime provenance, not compile-time typing)", () => {
  const fabricated = { actor_id: "attacker", actor_roles: ["admin"], workspace_id: W };
  assert.equal(deriveActorAuthority(fabricated, TOOL_REGISTRY), null);
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: fabricated }), NOW, INTEGRITY),
    null,
    "a fabricated admin context must never mint a grant",
  );
});

test("C: caller-supplied TOOL AUTHORITY is rejected", () => {
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor_tools: ["radar.search"], actor_can_write: true }), NOW, INTEGRITY),
    null,
  );
});

test("C: UNAUTHENTICATED actor is rejected (membership not verified)", () => {
  const ctx = createTrustedActorContext(
    { caller_id: "stranger", workspace_id: W },
    membershipFor("admin", { isMember: () => false }),
  );
  assert.equal(ctx, null, "an unauthenticated actor never receives a trusted context");
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: ctx }), NOW, INTEGRITY),
    null,
  );
});

test("C: INVALID WORKSPACE MEMBERSHIP is rejected", () => {
  const ctx = createTrustedActorContext(
    { caller_id: ACTOR, workspace_id: "w_not_a_member" },
    membershipFor("editor", { workspace: W }),
  );
  assert.equal(ctx, null, "membership is verified against the requested workspace");
});

test("C: CROSS-WORKSPACE delegation is rejected", () => {
  // A context minted for W cannot mint a grant for another workspace:
  const ctx = trustedActor("editor"); // verified in W only
  const grant = createDelegatedGrant(
    baseGrantInput({ actor: ctx, grant_id: "g_x" }),
    NOW,
    INTEGRITY,
  );
  assert.ok(grant, "the in-workspace grant exists");
  // The grant is sealed to W; presenting it for another workspace fails:
  assert.equal(
    validateGrantUse(grant, baseCheck({ workspace_id: "w_other" }), NOW, INTEGRITY).reason,
    "workspace_mismatch",
  );
  // And the trusted-context factory refuses foreign workspaces outright:
  assert.equal(
    createTrustedActorContext({ caller_id: ACTOR, workspace_id: "w_other" }, membershipFor("editor", { workspace: W })),
    null,
  );
});

test("C: valid authenticated CONTRIBUTOR receives only the permitted authority", () => {
  const ctx = trustedActor("contributor");
  const authority = deriveActorAuthority(ctx, TOOL_REGISTRY);
  assert.ok(authority, "contributor authority must derive");
  // No tool requiring editor or admin is within contributor authority:
  for (const [toolName, entry] of Object.entries(TOOL_REGISTRY)) {
    if (entry && (entry.required_role === "editor" || entry.required_role === "admin")) {
      assert.ok(!authority.actor_tools.includes(toolName), "contributor must not derive " + toolName);
    }
  }
  // A contributor grant asking for an editor-only tool is rejected:
  const editorOnly = Object.entries(TOOL_REGISTRY).find(
    ([, e]) => e && e.required_role === "editor",
  );
  if (editorOnly) {
    assert.equal(
      createDelegatedGrant(
        baseGrantInput({ actor: trustedActor("contributor"), allowed_tools: [editorOnly[0]] }),
        NOW,
        INTEGRITY,
      ),
      null,
      "a contributor cannot delegate beyond their derived authority",
    );
  }
});

test("C: valid authenticated ADMIN receives only the authority allowed by policy", () => {
  const ctx = trustedActor("admin");
  const authority = deriveActorAuthority(ctx, TOOL_REGISTRY);
  assert.ok(authority);
  // Policy still bounds an admin: unregistered tools are never grantable...
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: ctx, allowed_tools: ["made.up.tool"] }), NOW, INTEGRITY),
    null,
  );
  // ...and the 4-hour TTL ceiling still applies.
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: ctx, ttl_seconds: 60 * 60 * 24 }), NOW, INTEGRITY),
    null,
  );
});

test("C: SELF-DELEGATION cannot exceed the actor's own permissions", () => {
  // Agent == actor is rejected outright...
  assert.equal(
    createDelegatedGrant(baseGrantInput({ agent_id: ACTOR }), NOW, INTEGRITY),
    null,
  );
  // ...and a viewer's self-delegation cannot carry more than the
  // viewer's own derived authority (enforced by the subset rule):
  const grant = createDelegatedGrant(
    baseGrantInput({
      actor: trustedActor("viewer"),
      allowed_tools: ["radar.search"],
      allowed_actions: ["read"],
      max_uses: 5,
    }),
    NOW,
    INTEGRITY,
  );
  assert.ok(grant);
  assert.deepEqual(grant.allowed_tools, ["radar.search"]);
  assert.equal(grant.allowed_actions.includes("write"), false);
});

// ---------------------------------------------------------------------------
// D. Approval ordering and replay (compat adapter, approval-gated op).
// ---------------------------------------------------------------------------
const approvalKeys = generateEd25519KeyPair();

function approvalAdapterSetup(maxUses) {
  const transport = makeTransport();
  const redemption = createRedemptionRecord();
  const adapter = createGitHubReadOnlyAdapter({
    token: "gh_test_token",
    baseUrl: "https://api.test.local",
    fetchImpl: transport.fetchImpl,
    operations: TEST_OPERATIONS,
    grantIntegrity: INTEGRITY,
    now: NOW,
    defaultTimeoutMs: 1000,
    approvalVerifier: (token, check, when) =>
      verifyApproval(token, approvalKeys.publicKeyPem, check, redemption, when),
  });
  const grant = adapterGrant(maxUses, { allowed_tools: ["github.read.sensitive"] });
  const requestPath = "/repos/remRADAR/RADARMatrix/collaborators";
  return { transport, redemption, adapter, grant, requestPath };
}

function approvalRequest(setup, token) {
  return {
    command: "github.read.sensitive",
    args: { owner: "remRADAR", repo: "RADARMatrix" },
    authority: { agent_id: AGENT, workspace_id: W, grant: setup.grant },
    approvalToken: token,
  };
}

function mintApproval(setup, overrides) {
  return issueApproval(
    Object.assign(
      {
        action: "github.read.sensitive",
        resource_ids: [setup.requestPath],
        workspace_id: W,
        actor_id: ACTOR,
        grant_id: setup.grant.grant_id,
        ttl_seconds: 300,
        now: NOW,
      },
      overrides || {},
    ),
    approvalKeys.privateKeyPem,
  );
}

test("D: INVALID GRANT does not consume the approval", async () => {
  const setup = approvalAdapterSetup(1);
  const issued = mintApproval(setup);
  // A MUTATED grant (inflated tool scope, invalid seal):
  const mutated = Object.assign({}, setup.grant, { allowed_tools: ["github.read.sensitive", "github.read.branches"] });
  const result = await setup.adapter.execute({
    command: "github.read.sensitive",
    args: { owner: "remRADAR", repo: "RADARMatrix" },
    authority: { agent_id: AGENT, workspace_id: W, grant: mutated },
    approvalToken: issued.token,
  });
  assert.equal(result.status, "denied");
  assert.equal(result.notes, "authority_denied", "grant validation runs BEFORE the approval gate");
  assert.equal(setup.redemption.size(), 0, "a failed grant check must NEVER consume the approval");
  assert.equal(setup.transport.count(), 0, "nothing may dispatch");
});

test("D: WRONG ACTOR does not consume the approval", async () => {
  const setup = approvalAdapterSetup(2);
  const issued = mintApproval(setup, { actor_id: "someone_else" });
  const result = await setup.adapter.execute(approvalRequest(setup, issued.token));
  assert.equal(result.status, "denied");
  assert.equal(result.notes, "actor_mismatch");
  assert.equal(setup.redemption.size(), 0);
  assert.equal(setup.transport.count(), 0);
});

test("D: WRONG WORKSPACE does not consume the approval", async () => {
  const setup = approvalAdapterSetup(2);
  const issued = mintApproval(setup, { workspace_id: "w_other" });
  const result = await setup.adapter.execute(approvalRequest(setup, issued.token));
  assert.equal(result.status, "denied");
  assert.equal(result.notes, "workspace_mismatch");
  assert.equal(setup.redemption.size(), 0);
  assert.equal(setup.transport.count(), 0);
});

test("D: WRONG ACTION/RESOURCE does not consume the approval", async () => {
  const setup = approvalAdapterSetup(2);
  const wrongAction = mintApproval(setup, { action: "github.read.branches" });
  const r1 = await setup.adapter.execute(approvalRequest(setup, wrongAction.token));
  assert.equal(r1.notes, "action_mismatch");
  const wrongResource = mintApproval(setup, { resource_ids: ["/repos/remRADAR/RADARMatrix/branches"] });
  const r2 = await setup.adapter.execute(approvalRequest(setup, wrongResource.token));
  assert.equal(r2.notes, "resource_mismatch");
  assert.equal(setup.redemption.size(), 0, "scope mismatches must never consume the approval");
  assert.equal(setup.transport.count(), 0);
});

test("D: EXPIRED approval is rejected (and never dispatched)", async () => {
  const setup = approvalAdapterSetup(2);
  const issued = mintApproval(setup, { ttl_seconds: 60, now: NOW - 300 });
  const result = await setup.adapter.execute(approvalRequest(setup, issued.token));
  assert.equal(result.status, "denied");
  assert.equal(result.notes, "expired");
  assert.equal(setup.transport.count(), 0);
});

test("D: TWO CONCURRENT redemptions — only ONE succeeds within the supported runtime", async () => {
  const setup = approvalAdapterSetup(2); // capacity for both attempts
  const issued = mintApproval(setup);
  const [r1, r2] = await Promise.all([
    setup.adapter.execute(approvalRequest(setup, issued.token)),
    setup.adapter.execute(approvalRequest(setup, issued.token)),
  ]);
  const executed = [r1, r2].filter((r) => r.status === "executed").length;
  assert.equal(executed, 1, "exactly one concurrent redemption may succeed");
  assert.equal(setup.redemption.size(), 1, "the jti is redeemed exactly once");
  assert.equal(setup.transport.count(), 1, "only the winner dispatches");
});

test("D: a SUCCESSFUL approval cannot be replayed", async () => {
  const setup = approvalAdapterSetup(2);
  const issued = mintApproval(setup);
  const first = await setup.adapter.execute(approvalRequest(setup, issued.token));
  assert.equal(first.status, "executed");
  const replay = await setup.adapter.execute(approvalRequest(setup, issued.token));
  assert.equal(replay.status, "denied");
  assert.equal(replay.notes, "replayed");
  assert.equal(setup.transport.count(), 1, "the replay must not dispatch again");
});

test("D: NO external operation after a FAILED approval verification", async () => {
  const setup = approvalAdapterSetup(2);
  const issued = mintApproval(setup, { resource_ids: ["/repos/remRADAR/RADARMatrix/invaders"] });
  const result = await setup.adapter.execute(approvalRequest(setup, issued.token));
  assert.equal(result.status, "denied");
  assert.equal(setup.transport.count(), 0, "a failed approval check must never dispatch");
  // The reservation policy is documented: the reserved use stays
  // consumed (no refund) but nothing was dispatched.
  assert.equal(setup.grant.uses, 1, "no-refund reservation policy (documented)");
});

// ---------------------------------------------------------------------------
// E. Membership file hardening.
// ---------------------------------------------------------------------------
function tempFilePath(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "radarmatrix-m221-")), name);
}

test("E: temporary files are created EXCLUSIVELY (a pre-created temp path cannot be hijacked)", () => {
  const file = tempFilePath("membership.json");
  const provider = new FileMembershipProvider({ path: file, _tmpNameFn: () => "fixed-suffix" });
  provider.grant(ACTOR, W, "editor"); // succeeds (no collision yet)
  const predictedTmp = file + ".tmp-fixed-suffix";
  fs.writeFileSync(predictedTmp, "attacker-controlled", { flag: "w" });
  const provider2 = new FileMembershipProvider({ path: file, _tmpNameFn: () => "fixed-suffix" });
  assert.throws(() => provider2.grant("user_other", W, "viewer"), /EEXIST|exists/i, "exclusive creation must refuse the existing temp path");
  // The attacker's file was removed by cleanup; the live file still
  // holds ONLY the first provider's valid data.
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(onDisk[ACTOR], "the previous valid membership file is intact");
  assert.equal(onDisk["user_other"], undefined, "the failed write must not leak into the live file");
});

test("E: restrictive file permissions (0o600 on POSIX)", () => {
  if (process.platform === "win32") {
    console.log("  (skipped on win32 — open mode is a no-op there)");
    return;
  }
  const file = tempFilePath("membership.json");
  const provider = new FileMembershipProvider({ path: file });
  provider.grant(ACTOR, W, "editor");
  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(mode, 0o600, "the live membership file must be owner-only (0o600)");
});

test("E: successful ATOMIC replacement — the next instance loads the new state", () => {
  const file = tempFilePath("membership.json");
  const p1 = new FileMembershipProvider({ path: file });
  p1.grant(ACTOR, W, "editor");
  const p2 = new FileMembershipProvider({ path: file });
  p2.grant("user_admin", W, "admin");
  const p3 = new FileMembershipProvider({ path: file });
  assert.equal(p3.isMember(ACTOR, W), true);
  assert.equal(p3.getRole("user_admin", W), "admin");
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(Array.isArray(onDisk[ACTOR]) && Array.isArray(onDisk["user_admin"]), "both persisted members on disk");
});

test("E: a FAILED WRITE leaves the previous valid membership file intact", () => {
  const file = tempFilePath("membership.json");
  const provider = new FileMembershipProvider({ path: file });
  provider.grant(ACTOR, W, "editor");
  const before = fs.readFileSync(file, "utf8");
  const dir = path.dirname(file);
  if (process.platform !== "win32") {
    fs.chmodSync(dir, 0o500); // read-only directory => openSync fails
    try {
      assert.throws(() => provider.grant("user_new", W, "viewer"), /EACCES|permission/i, "persistence failures must propagate loudly");
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  }
  assert.equal(fs.readFileSync(file, "utf8"), before, "the previous valid file is untouched");
  const reloaded = new FileMembershipProvider({ path: file });
  assert.equal(reloaded.isMember("user_new", W), false, "the failed mutation never landed");
  assert.equal(reloaded.isMember(ACTOR, W), true);
});

test("E: temporary-file CLEANUP — no temp residue after success or failure", () => {
  const file = tempFilePath("membership.json");
  const dir = path.dirname(file);
  const provider = new FileMembershipProvider({ path: file });
  provider.grant(ACTOR, W, "editor");
  const leftovers = fs.readdirSync(dir).filter((n) => n.includes(".tmp-"));
  assert.equal(leftovers.length, 0, "no temporary residue after a successful persist");
  // A failing persist must also leave no residue:
  const fixed = new FileMembershipProvider({ path: file, _tmpNameFn: () => "blocked" });
  fs.writeFileSync(file + ".tmp-blocked", "pre-existing", { flag: "w" });
  assert.throws(() => fixed.grant("u", W, "viewer"));
  const leftovers2 = fs.readdirSync(dir).filter((n) => n.includes(".tmp-"));
  assert.equal(leftovers2.length, 0, "cleanup removes temp files even on failure");
});

test("E: a CORRUPT file fails closed (empty registry, never fixtures)", () => {
  const file = tempFilePath("membership.json");
  fs.writeFileSync(file, "{ not valid json at all", { flag: "w" });
  const provider = new FileMembershipProvider({ path: file });
  assert.equal(provider.isMember(ACTOR, W), false, "corrupt data fails closed — nobody is a member");
  assert.equal(provider.getRole(ACTOR, W), null);
});

test("E: a MISSING file fails closed", () => {
  const file = path.join(os.tmpdir(), "radarmatrix-m221-missing-" + Date.now() + "-membership.json");
  const provider = new FileMembershipProvider({ path: file });
  assert.equal(provider.isMember(ACTOR, W), false);
  assert.equal(provider.hasCaller(ACTOR), false);
});

test("E: the concurrent multi-instance limitation is explicitly documented in the provider", () => {
  const source = fs.readFileSync(
    new URL("../apps/mcp-server/src/providers/membership-file.cjs", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("last-writer-wins"), "the lost-write limitation must be documented");
  assert.ok(source.includes("NOT a transactional distributed membership"), "the single-instance boundary must be documented");
  assert.ok(source.includes("TORN writes") && source.includes("LOST writes"), "atomic rename must not be overclaimed");
});

// ---------------------------------------------------------------------------
// Harness (M1a/M2 convention): failures propagate to the exit code.
// The runner awaits this suite, so async denial tests are verified
// exactly like sync ones.
// ---------------------------------------------------------------------------
export async function runAllTests() {
  let failed = 0;
  let passed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log("  ✓ " + name);
    } catch (error) {
      failed += 1;
      console.log("  ✗ " + name + ": " + (error && error.message ? error.message : String(error)));
    }
  }
  console.log("\nM2.2.1 security correction tests: " + passed + " passed, " + failed + " failed");
  return { failed, passed };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const { failed } = await runAllTests();
  process.exit(failed > 0 ? 1 : 0);
}
