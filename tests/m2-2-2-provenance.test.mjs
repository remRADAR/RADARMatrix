/**
 * RADARMatrix M2.2.2 Provenance Suite
 *
 * Owner directive (M2.2.2), Finding C — regression tests proving the
 * server-authority composition boundary closes the M2.2.1 residual
 * provenance weaknesses with REAL denial behavior:
 *
 *   A. Membership provider provenance: the trusted provider is bound
 *      ONCE per process by the server composition boundary
 *      (the trusted composition root — M2.2.3 moved it to
 *      apps/mcp-server/src/auth/server-composition.ts);
 *      createTrustedActorContext accepts NO provider argument, and
 *      caller-fabricated providers are rejected outright.
 *   B. Tool registry provenance: the canonical registry is
 *      server-owned (bound once); grant inputs cannot carry a
 *      registry, and unknown tools fail closed.
 *   C. All M2.2.1 protections (HMAC seal, atomic reservation) remain
 *      intact after the migration.
 *
 * The shared test composition lives in ./server-authority.helper.mjs:
 * it performs the ONE-TIME binding through the trusted composition
 * root, exactly as gateway startup will in production. Tests mutate
 * the server-side membership STATE (test fixtures), never the
 * provider or the binding — the same rule that applies to request
 * handlers. Post-binding immutability of the provider methods and
 * the registry snapshot is proven separately, in
 * ./m2-2-3-authority-hardening.test.mjs.
 *
 * Failures are counted and returned to tests/test-runner.mjs, which
 * exits non-zero when any test fails. Standalone runs exit non-zero.
 */

import assert from "node:assert/strict";
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
  composeServerAuthority,
  isServerAuthorityComposed,
} from "../apps/mcp-server/src/auth/server-composition.ts";
import {
  TOOL_REGISTRY,
} from "../apps/mcp-server/src/chatgpt-app-contract.ts";
import { setMembershipState, TEST_REGISTRY } from "./server-authority.helper.mjs";

const NOW = 1_000_000;
const W = "w_prod";
const ACTOR = "user_editor";
const AGENT = "agent_specialist_1";
const SECRET = "m2-2-2-provenance-suite-integrity-secret-0123456789";
const INTEGRITY = createGrantIntegrityService(SECRET);
assert.ok(INTEGRITY, "integrity service must construct");

/** State-based trusted-actor mint: the STATE is this test's server-side membership data. */
function trustedActor(role, opts) {
  const o = opts || {};
  setMembershipState({
    actor: o.actor || ACTOR,
    workspace: o.workspace || W,
    role,
    rawRole: o.rawRole,
    isMember: o.isMember,
    getRole: o.getRole,
  });
  return createTrustedActorContext({ caller_id: o.actor || ACTOR, workspace_id: o.workspace || W });
}

function baseGrantInput(overrides) {
  return Object.assign(
    {
      grant_id: "grant_m222",
      agent_id: AGENT,
      allowed_tools: ["radar.search"],
      allowed_actions: ["read"],
      ttl_seconds: 600,
      max_uses: 1,
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
// Finding A — membership provider provenance.
// ---------------------------------------------------------------------------
test("A: a FABRICATED membership provider (returns true / admin) is rejected as an argument", () => {
  const fabricatedProvider = {
    isMember: () => true,
    getRole: () => "admin",
  };
  // The factory takes NO provider argument — any second argument is refused:
  assert.equal(
    createTrustedActorContext({ caller_id: ACTOR, workspace_id: W }, fabricatedProvider),
    null,
    "a caller-supplied provider must never mint a trusted context",
  );
  assert.equal(
    createTrustedActorContext({ caller_id: ACTOR, workspace_id: W }, {}),
    null,
  );
  // And the fabricated admin result cannot derive authority on its own:
  assert.equal(
    deriveActorAuthority({ actor_id: ACTOR, actor_roles: ["admin"], workspace_id: W }, TEST_REGISTRY),
    null,
    "a fabricated admin ROLE object is not a trusted context",
  );
});

test("A: the server authority is composed exactly ONCE — a mid-flight re-composition attempt fails closed", () => {
  assert.ok(isServerAuthorityComposed(), "the shared test composition bound the authority at import");
  const maliciousProvider = {
    isMember: () => true,
    getRole: () => "admin",
  };
  const rebound = composeServerAuthority({
    membershipProvider: maliciousProvider,
    toolRegistry: Object.assign({}, TEST_REGISTRY, { "made.up.tool": { required_role: "viewer", is_write_operation: true } }),
  });
  assert.equal(rebound, false, "a second composeServerAuthority call must be refused");
  // The ORIGINAL bound provider still serves — the malicious one has no effect:
  const ctx = trustedActor("viewer");
  assert.ok(ctx, "the original provider still mints");
  const authority = deriveActorAuthority(ctx, TEST_REGISTRY);
  assert.ok(authority);
  // The viewer derived NOTHING from the malicious re-composition attempt: it
  // still cannot derive the editor-only write tool, and cannot mint
  // a grant for it either.
  assert.ok(!authority.actor_tools.includes("radar.record_decision"), "the failed re-composition granted no editor authority");
  assert.equal(
    createDelegatedGrant(
      baseGrantInput({ actor: trustedActor("viewer"), allowed_tools: ["radar.record_decision"] }),
      NOW,
      INTEGRITY,
    ),
    null,
    "the failed re-composition granted nothing",
  );
});

test("A: UNAUTHENTICATED principals cannot mint trusted contexts", () => {
  // The SERVER-BOUND provider reports non-membership:
  const ctx = trustedActor("editor", { actor: "stranger", isMember: () => false });
  assert.equal(ctx, null);
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: null }), NOW, INTEGRITY),
    null,
  );
});

test("A: INVALID membership (unknown/missing role) fails closed", () => {
  // rawRole "superuser" is NOT a recognized role in the role ladder:
  const ctx = trustedActor("editor", { rawRole: "superuser" });
  assert.equal(ctx, null, "an unrecognized role must fail closed");
  const missingRole = trustedActor("editor", { rawRole: null, getRole: () => null });
  assert.equal(missingRole, null, "a provider with no authoritative role fails closed");
});

test("A: cross-workspace access remains rejected", () => {
  setMembershipState({ actor: ACTOR, workspace: W, role: "editor" });
  assert.equal(
    createTrustedActorContext({ caller_id: ACTOR, workspace_id: "w_other" }),
    null,
    "membership is verified against the REQUESTED workspace by the bound provider",
  );
  // A context valid in W cannot mint a grant sealed to another workspace:
  const grant = createDelegatedGrant(baseGrantInput({ actor: trustedActor("editor") }), NOW, INTEGRITY);
  assert.ok(grant);
  assert.equal(
    validateGrantUse(grant, baseCheck({ workspace_id: "w_other" }), NOW, INTEGRITY).reason,
    "workspace_mismatch",
  );
});

// ---------------------------------------------------------------------------
// Finding B — tool registry provenance.
// ---------------------------------------------------------------------------
test("B: a CALLER-CONTROLLED tool registry cannot elevate permissions", () => {
  const attackerRegistry = {
    "radar.remember": { required_role: "viewer", is_write_operation: true },
    "made.up.tool": { required_role: "viewer", is_write_operation: true },
  };
  // A viewer actor with the attacker's registry injected into the input:
  const viewer = trustedActor("viewer");
  assert.ok(viewer);
  assert.equal(
    createDelegatedGrant(
      baseGrantInput({ actor: viewer, registry: attackerRegistry, allowed_tools: ["made.up.tool"] }),
      NOW,
      INTEGRITY,
    ),
    null,
    "a registry smuggled through the grant input must fail loudly",
  );
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: viewer, registry: TOOL_REGISTRY }), NOW, INTEGRITY),
    null,
    "even the benign legacy registry field is rejected — the registry is server-owned",
  );
  // Unknown tools fail closed against the CANONICAL (bound) registry:
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: viewer, allowed_tools: ["made.up.tool"] }), NOW, INTEGRITY),
    null,
  );
  // Write actions stay stricter than read:
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: viewer, allowed_actions: ["write"] }), NOW, INTEGRITY),
    null,
  );
});

test("B: permission checks use the CANONICAL registry — admin cannot grant unregistered tools", () => {
  const admin = trustedActor("admin");
  assert.ok(admin);
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: admin, allowed_tools: ["totally.unregistered"] }), NOW, INTEGRITY),
    null,
  );
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: admin, ttl_seconds: 60 * 60 * 24 }), NOW, INTEGRITY),
    null,
    "the policy TTL ceiling binds admins too",
  );
});

// ---------------------------------------------------------------------------
// Authorized principals receive exactly their policy authority.
// ---------------------------------------------------------------------------
test("C: valid CONTRIBUTORS receive only the permitted authority", () => {
  const ctx = trustedActor("contributor");
  assert.ok(ctx);
  const authority = deriveActorAuthority(ctx, TEST_REGISTRY);
  assert.ok(authority);
  for (const [toolName, entry] of Object.entries(TEST_REGISTRY)) {
    if (entry && (entry.required_role === "editor" || entry.required_role === "admin")) {
      assert.ok(!authority.actor_tools.includes(toolName), "contributor must not derive " + toolName);
    }
  }
  // Contributor-level writes (radar.remember) are WITHIN the policy
  // hierarchy (viewer < contributor < editor < admin); the boundary
  // is the EDITOR-only write, which a contributor never derives:
  assert.ok(authority.actor_tools.includes("radar.remember"), "contributor derives the contributor-level tool");
  assert.ok(!authority.actor_tools.includes("radar.record_decision"), "contributor must not derive the editor-only write tool");
  assert.equal(
    createDelegatedGrant(
      baseGrantInput({ actor: trustedActor("contributor"), allowed_tools: ["radar.record_decision"] }),
      NOW,
      INTEGRITY,
    ),
    null,
    "a contributor cannot delegate the editor-only write tool",
  );
});

test("C: valid ADMINS receive only policy-authorized authority (self-delegation bounded)", () => {
  const ctx = trustedActor("admin");
  const authority = deriveActorAuthority(ctx, TEST_REGISTRY);
  assert.ok(authority);
  // Self-delegation (agent == actor) is refused outright:
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: ctx, agent_id: ACTOR }), NOW, INTEGRITY),
    null,
  );
  // A legal admin grant derives ONLY the requested subset:
  const grant = createDelegatedGrant(
    baseGrantInput({ actor: ctx, allowed_tools: ["radar.search"], allowed_actions: ["read"], max_uses: 3 }),
    NOW,
    INTEGRITY,
  );
  assert.ok(grant);
  assert.deepEqual(grant.allowed_tools, ["radar.search"]);
  assert.equal(grant.allowed_actions.includes("write"), false, "the grant cannot exceed the requested subset");
  assert.equal(grant.max_uses, 3);
});

test("C: SELF-DELEGATION cannot exceed the actor's own authority (editor vs viewer subset)", () => {
  const viewer = trustedActor("viewer");
  const viewerAuthority = deriveActorAuthority(viewer, TEST_REGISTRY);
  assert.ok(viewerAuthority);
  const editorTool = Object.entries(TEST_REGISTRY).find(
    ([, e]) => e && e.required_role === "editor",
  );
  if (editorTool) {
    assert.equal(
      createDelegatedGrant(baseGrantInput({ actor: viewer, allowed_tools: [editorTool[0]] }), NOW, INTEGRITY),
      null,
      "a viewer cannot delegate an editor-only tool to themselves",
    );
  }
});

// ---------------------------------------------------------------------------
// M2.2.1 protections remain intact (Finding C, bullet 10).
// ---------------------------------------------------------------------------
test("M2.2.1 intact: HMAC seal rejects a mutated grant_id", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  assert.equal(
    validateGrantUse(Object.assign({}, grant, { grant_id: "grant_forged" }), baseCheck(), NOW, INTEGRITY).reason,
    "grant_mutated",
  );
});

test("M2.2.1 intact: a recomputed UNKEYED hash cannot bypass integrity", () => {
  const attacker = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  const inflated = Object.assign({}, attacker, { max_uses: 999 });
  const canonical = JSON.stringify([
    inflated.grant_id, inflated.actor_id, inflated.agent_id, inflated.workspace_id,
    inflated.allowed_tools.slice().sort(),
    inflated.allowed_actions.slice().sort(),
    inflated.expires_at, inflated.max_uses, inflated.uses,
  ]);
  inflated.integrity_hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  assert.equal(validateGrantUse(inflated, baseCheck(), NOW, INTEGRITY).reason, "grant_mutated");
  // And a reservation rollback (uses reset without the secret) is rejected:
  const consumed = createDelegatedGrant(baseGrantInput({ max_uses: 1 }), NOW, INTEGRITY);
  assert.equal(reserveGrantUse(consumed, INTEGRITY, NOW).reserved, true);
  assert.equal(
    reserveGrantUse(Object.assign({}, consumed, { uses: 0 }), INTEGRITY, NOW).reason,
    "grant_mutated",
  );
});

test("M2.2.1 intact: atomic reservation — one remaining use permits exactly one reservation", () => {
  const grant = createDelegatedGrant(baseGrantInput({ max_uses: 1 }), NOW, INTEGRITY);
  assert.equal(reserveGrantUse(grant, INTEGRITY, NOW).reserved, true);
  assert.equal(reserveGrantUse(grant, INTEGRITY, NOW).reserved, false, "the second concurrent reservation loses");
  assert.equal(grant.uses, 1);
  // Integrity unavailable => reservation fails closed:
  assert.equal(reserveGrantUse(grant, null, NOW).reason, "integrity_unavailable");
});

// ---------------------------------------------------------------------------
// Harness (M1a/M2 convention): failures propagate to the exit code.
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
  console.log("\nM2.2.2 provenance tests: " + passed + " passed, " + failed + " failed");
  return { failed, passed };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const { failed } = await runAllTests();
  process.exit(failed > 0 ? 1 : 0);
}
