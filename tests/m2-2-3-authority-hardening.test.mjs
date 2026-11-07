/**
 * RADARMatrix M2.2.3 Authority Hardening Suite
 *
 * Owner directive (M2.2.3) — dedicated regression suite proving, with
 * REAL denial behavior, that the two PR #7 review findings are
 * closed:
 *
 *   A. Secure first initialization: the general-purpose auth module
 *      exports NO initialization capability; only the trusted
 *      server composition root (server-composition.ts) can establish
 *      the authority; set-once and fail-closed semantics are
 *      preserved.
 *   B. Immutable bound dependencies: the membership provider is a
 *      protected adapter (method references captured ONCE at
 *      composition — post-binding replacement of the original
 *      provider's methods has no effect, while legitimate underlying
 *      membership data updates still flow), and the tool registry is
 *      a validated, copied, deep-frozen server-owned snapshot
 *      (retained references to the original registry cannot mutate
 *      required roles, write permissions or tool identities).
 *
 * First-initialization behavior (A) needs FRESH module state, so the
 * A-tests spawn child processes (./m2223-composition-child.mjs); the
 * shared test process has already composed the authority once at
 * import time through ./server-authority.helper.mjs.
 *
 * B/C tests mutate the ORIGINAL helper-owned provider and registry
 * objects (retained references) and prove the BOUND authority ignores
 * them. Every mutation is restored in a finally block so no fixture
 * leaks into other suites.
 *
 * Failures are counted and returned to tests/test-runner.mjs, which
 * exits non-zero when any test fails. Standalone runs exit non-zero.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  createDelegatedGrant,
  deriveActorAuthority,
  createGrantIntegrityService,
  createTrustedActorContext,
  isServerAuthorityInitialized,
} from "../apps/mcp-server/src/auth/delegation.ts";
import {
  composeServerAuthority,
  isServerAuthorityComposed,
} from "../apps/mcp-server/src/auth/server-composition.ts";
import {
  setMembershipState,
  TEST_REGISTRY,
  testMembershipProvider,
} from "./server-authority.helper.mjs";

const NOW = 1_000_000;
const W = "w_prod";
const ACTOR = "user_editor";
const AGENT = "agent_specialist_1";
const SECRET = "m2-2-3-authority-hardening-suite-integrity-secret-0123456789";
const INTEGRITY = createGrantIntegrityService(SECRET);
assert.ok(INTEGRITY, "integrity service must construct");

const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), "m2223-composition-child.mjs");

/** Runs a fresh-process composition scenario and returns its RESULT object. */
function childScenario(scenario) {
  const run = spawnSync(process.execPath, [CHILD, scenario], {
    env: Object.assign({}, process.env, { RADARMATRIX_RUNTIME_MODE: "test" }),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, "child scenario " + scenario + " must exit 0 (stderr: " + (run.stderr || "").slice(0, 300) + ")");
  const line = (run.stdout || "").split("\n").find((l) => l.startsWith("RESULT:"));
  assert.ok(line, "child scenario " + scenario + " must emit a RESULT line");
  return JSON.parse(line.slice("RESULT:".length));
}

/** State-based trusted-actor mint (same convention as the M2.2.2 suite). */
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
      grant_id: "grant_m223",
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

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// A — Initialization provenance.
// ---------------------------------------------------------------------------
test("A1: unauthorized first initialization cannot establish authority — the request-facing auth surface exports no initialization capability (fresh process)", () => {
  const r = childScenario("request-surface");
  assert.equal(r.initExportType, "undefined", "delegation.ts must NOT export initializeServerAuthority");
  assert.equal(r.composeExportType, "undefined", "delegation.ts must NOT export composeServerAuthority");
  assert.equal(r.initialized, false, "a fresh process that never ran the composition root stays unbound");
  assert.equal(r.fabricatedProviderMintNull, true, "a fabricated provider smuggled as an argument cannot mint");
});

test("A2: only the trusted server composition path can establish authority (fresh process)", () => {
  const r = childScenario("trusted-composition");
  assert.equal(r.composed, true, "the composition root establishes the authority on the first call");
  assert.equal(r.isComposed, true);
  assert.equal(r.aliceMinted, true, "membership verified through the composed adapter");
  assert.equal(r.aliceEditorGrantMinted, true, "grants mint after legitimate composition");
});

test("A3: a second composition attempt is rejected — set-once semantics preserved", () => {
  const r = childScenario("trusted-composition");
  assert.equal(r.secondComposeRejected, true, "a second composeServerAuthority call must be refused");
  assert.equal(r.bobStillDeniedAfterRegistryMutation, true, "the original authority keeps serving after the refused re-composition");
});

test("A4: request-controlled provider or registry values cannot influence initialization (JSON payloads are not live capabilities)", () => {
  // A serialized "request payload" configuration — functions cannot
  // survive JSON, and the composition root refuses everything else:
  const payloadConfig = JSON.parse(
    JSON.stringify({
      membershipProvider: { isMember: "（） => true", getRole: "return 'admin'" },
      toolRegistry: { "made.up.tool": { required_role: "viewer", is_write_operation: true } },
    }),
  );
  assert.equal(composeServerAuthority(payloadConfig), false, "a payload-shaped config must never compose");
  // The ORIGINAL bound authority still serves — nothing changed:
  assert.ok(isServerAuthorityComposed(), "the original composition is untouched");
  const ctx = trustedActor("viewer");
  assert.ok(ctx, "the original provider still mints");
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: trustedActor("viewer"), allowed_tools: ["made.up.tool"] }), NOW, INTEGRITY),
    null,
    "no payload-supplied tool entered the bound snapshot",
  );
});

test("A5: an unbound authority fails closed (fresh process — every mint and every grant denied)", () => {
  const r = childScenario("request-surface");
  assert.equal(r.initialized, false);
  assert.equal(r.unboundMintNull, true, "an unbound authority mints nothing");
  assert.equal(r.unboundGrantNull, true, "an unbound authority creates no grants");
  assert.equal(isServerAuthorityInitialized(), true, "sanity: THIS process is bound (by the shared test composition)");
});

test("A6: existing legitimate server initialization works (the shared test composition)", () => {
  assert.ok(isServerAuthorityComposed(), "the shared helper composed the authority at import");
  assert.ok(isServerAuthorityInitialized());
  const ctx = trustedActor("editor");
  assert.ok(ctx, "legitimate composition mints trusted contexts");
  const grant = createDelegatedGrant(baseGrantInput({ actor: ctx }), NOW, INTEGRITY);
  assert.ok(grant, "legitimate composition creates grants");
});

// ---------------------------------------------------------------------------
// B — Provider immutability (the ORIGINAL helper provider object is a
// retained caller-owned reference; the BOUND authority is a frozen
// adapter with stable method references).
// ---------------------------------------------------------------------------
test("B1: replacing the original provider's isMember after initialization has no effect", () => {
  const original = testMembershipProvider.isMember;
  try {
    // The membership STATE (server-side data) says only ACTOR is a
    // member. The attacker replaces the retained provider's method
    // with an always-true forgery:
    setMembershipState({ actor: ACTOR, workspace: W, role: "editor" });
    testMembershipProvider.isMember = () => true;
    // The bound adapter keeps using the CAPTURED original method,
    // which consults the real state — so the stranger still fails:
    const stranger = createTrustedActorContext({ caller_id: "stranger", workspace_id: W });
    assert.equal(stranger, null, "a replaced isMember on the retained reference must not reach the bound adapter");
    // And the legitimate member still mints through the CAPTURED method:
    const ctx = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
    assert.ok(ctx, "the captured method reference still serves the real membership data");
  } finally {
    testMembershipProvider.isMember = original;
  }
});

test("B2: replacing the original provider's getRole after initialization has no effect", () => {
  const original = testMembershipProvider.getRole;
  try {
    testMembershipProvider.getRole = () => "admin";
    setMembershipState({ actor: ACTOR, workspace: W, role: "viewer" });
    const ctx = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
    assert.ok(ctx, "the captured method still mints");
    const authority = deriveActorAuthority(ctx, TEST_REGISTRY);
    assert.ok(authority);
    assert.ok(
      !authority.actor_tools.includes("radar.record_decision"),
      "a replaced getRole must not elevate a viewer to editor authority",
    );
    assert.equal(
      createDelegatedGrant(
        baseGrantInput({ actor: ctx, allowed_tools: ["radar.record_decision"], allowed_actions: ["write"] }),
        NOW,
        INTEGRITY,
      ),
      null,
      "a replaced getRole must not produce an editor-level write grant",
    );
  } finally {
    testMembershipProvider.getRole = original;
  }
});

test("B3: a forged provider (full replacement of both methods) cannot elevate a viewer to admin", () => {
  const origIsMember = testMembershipProvider.isMember;
  const origGetRole = testMembershipProvider.getRole;
  try {
    testMembershipProvider.isMember = () => true;
    testMembershipProvider.getRole = () => "admin";
    setMembershipState({ actor: ACTOR, workspace: W, role: "viewer" });
    const ctx = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
    assert.ok(ctx, "the captured methods still mint");
    const authority = deriveActorAuthority(ctx, TEST_REGISTRY);
    assert.ok(authority);
    assert.ok(!authority.actor_tools.includes("radar.record_decision"), "no editor tool for the viewer");
    assert.equal(
      createDelegatedGrant(
        baseGrantInput({ actor: ctx, allowed_tools: ["radar.record_decision"] }),
        NOW,
        INTEGRITY,
      ),
      null,
      "a fully forged retained reference cannot mint elevated grants",
    );
  } finally {
    testMembershipProvider.isMember = origIsMember;
    testMembershipProvider.getRole = origGetRole;
  }
});

test("B4: invalid or unavailable membership remains denied (the adapter fails closed)", () => {
  // A throwing underlying membership layer never leaks an exception
  // or a permissive fallback past the boundary:
  setMembershipState({ actor: ACTOR, workspace: W, role: "editor", isMember: () => { throw new Error("membership store down"); } });
  assert.equal(createTrustedActorContext({ caller_id: ACTOR, workspace_id: W }), null);
  setMembershipState({ actor: ACTOR, workspace: W, isMember: () => true, getRole: () => { throw new Error("role store down"); } });
  assert.equal(createTrustedActorContext({ caller_id: ACTOR, workspace_id: W }), null);
  // An unknown role also fails closed:
  const unknown = trustedActor("editor", { rawRole: "superuser" });
  assert.equal(unknown, null);
});

test("B5: legitimate membership data changes are observed through the trusted provider WITHOUT replacing it", () => {
  // The underlying membership RECORD changes (exactly like a role
  // change in the live store) — the SAME bound adapter observes it:
  setMembershipState({ actor: ACTOR, workspace: W, role: "viewer" });
  const asViewer = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
  assert.ok(asViewer);
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: asViewer, allowed_tools: ["radar.record_decision"] }), NOW, INTEGRITY),
    null,
    "as a viewer the actor cannot delegate the editor-only write tool",
  );
  setMembershipState({ actor: ACTOR, workspace: W, role: "editor" });
  const asEditor = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
  assert.ok(asEditor);
  const grant = createDelegatedGrant(baseGrantInput({ actor: asEditor, allowed_tools: ["radar.record_decision"], allowed_actions: ["write"] }), NOW, INTEGRITY);
  assert.ok(grant, "the same bound adapter observes the legitimate role promotion — no provider replacement needed");
});

test("B6: cross-workspace access remains denied through the protected adapter", () => {
  setMembershipState({ actor: ACTOR, workspace: W, role: "editor" });
  assert.equal(
    createTrustedActorContext({ caller_id: ACTOR, workspace_id: "w_other" }),
    null,
    "membership verification stays workspace-scoped",
  );
});

// ---------------------------------------------------------------------------
// C — Registry snapshot immutability (the ORIGINAL registry objects are
// retained references; the BOUND registry is a validated, copied,
// deep-frozen server-owned snapshot).
// ---------------------------------------------------------------------------
test("C1: mutating the original registry after initialization has no effect", () => {
  const entry = TEST_REGISTRY["github.read.branches"];
  const origRole = entry.required_role;
  try {
    entry.required_role = "admin"; // mutate the RETAINED original
    setMembershipState({ actor: ACTOR, workspace: W, role: "viewer" });
    const viewer = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
    assert.ok(viewer);
    const authority = deriveActorAuthority(viewer, TEST_REGISTRY);
    assert.ok(authority);
    // NOTE: deriveActorAuthority is a PURE function of its arguments —
    // it sees the mutated original (so the tool disappears from a
    // derivation over the mutated argument) — while the GRANT path
    // uses the BOUND snapshot, which the mutation cannot reach:
    assert.ok(!authority.actor_tools.includes("github.read.branches"), "the pure derivation sees the mutated argument");
    const grant = createDelegatedGrant(baseGrantInput({ actor: viewer, allowed_tools: ["github.read.branches"] }), NOW, INTEGRITY);
    assert.ok(grant, "the BOUND snapshot still grants the viewer-level tool — the original mutation did not reach it");
  } finally {
    entry.required_role = origRole;
  }
});

test("C2: mutating an individual original tool definition has no effect", () => {
  const entry = TEST_REGISTRY["github.read.branches"];
  const origWrite = entry.is_write_operation;
  try {
    entry.is_write_operation = true; // attempt to make the read-only tool a write tool
    setMembershipState({ actor: ACTOR, workspace: W, role: "viewer" });
    const viewer = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
    assert.ok(viewer);
    // The bound snapshot still classifies the tool as read-only, so
    // the viewer's derived write capability is unchanged:
    assert.equal(
      createDelegatedGrant(baseGrantInput({ actor: viewer, allowed_tools: ["github.read.branches"], allowed_actions: ["write"] }), NOW, INTEGRITY),
      null,
      "flipping is_write_operation on the retained original must not create write authority",
    );
  } finally {
    entry.is_write_operation = origWrite;
  }
});

test("C3: mutating nested authority-relevant properties has no effect", () => {
  const entry = TEST_REGISTRY["github.read.sensitive"];
  const origRole = entry.required_role;
  const origWrite = entry.is_write_operation;
  try {
    entry.required_role = "admin";
    entry.is_write_operation = true;
    setMembershipState({ actor: ACTOR, workspace: W, role: "viewer" });
    const viewer = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
    assert.ok(viewer);
    // The bound snapshot keeps the tool viewer-level read-only:
    assert.ok(
      createDelegatedGrant(baseGrantInput({ actor: viewer, allowed_tools: ["github.read.sensitive"] }), NOW, INTEGRITY),
      "the read grant still works — the bound snapshot did not absorb the nested mutations",
    );
    assert.equal(
      createDelegatedGrant(baseGrantInput({ actor: viewer, allowed_tools: ["github.read.sensitive"], allowed_actions: ["write"] }), NOW, INTEGRITY),
      null,
      "the write grant still fails — no elevation through nested mutation",
    );
  } finally {
    entry.required_role = origRole;
    entry.is_write_operation = origWrite;
  }
});

test("C4: a caller cannot inject a new tool into the bound authority", () => {
  assert.throws(() => { TEST_REGISTRY["made.up.tool"] = { required_role: "viewer", is_write_operation: true }; },
    "the frozen test registry (retained original) refuses new entries outright");
  setMembershipState({ actor: ACTOR, workspace: W, role: "admin" });
  const admin = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
  assert.ok(admin);
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: admin, allowed_tools: ["made.up.tool"] }), NOW, INTEGRITY),
    null,
    "unknown tools remain denied — nothing outside the composition root enters the snapshot",
  );
});

test("C5: a caller cannot lower an existing tool's required role", () => {
  // NOTE: this entry is SHARED with the real TOOL_REGISTRY — restore guaranteed.
  const entry = TEST_REGISTRY["radar.record_decision"];
  const origRole = entry.required_role;
  try {
    entry.required_role = "viewer"; // attempt to lower the editor-only write tool
    setMembershipState({ actor: ACTOR, workspace: W, role: "viewer" });
    const viewer = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
    assert.ok(viewer);
    assert.equal(
      createDelegatedGrant(baseGrantInput({ actor: viewer, allowed_tools: ["radar.record_decision"], allowed_actions: ["write"] }), NOW, INTEGRITY),
      null,
      "the bound snapshot keeps radar.record_decision editor-only — the retained original's mutation has no effect",
    );
  } finally {
    entry.required_role = origRole;
  }
});

test("C6: a caller cannot turn a write tool into a read tool (or vice versa) after binding", () => {
  // NOTE: this entry is SHARED with the real TOOL_REGISTRY — restore guaranteed.
  const entry = TEST_REGISTRY["radar.remember"];
  const origWrite = entry.is_write_operation;
  try {
    entry.is_write_operation = false; // attempt to relabel the contributor-level write tool as read-only
    setMembershipState({ actor: ACTOR, workspace: W, role: "contributor" });
    const contributor = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
    assert.ok(contributor);
    // The bound snapshot still classifies radar.remember as a WRITE
    // tool: the contributor's derived write capability and the
    // write grant flow (which use the BOUND snapshot, not the
    // retained original) are unchanged by the relabeling attempt.
    // (deriveActorAuthority is pure over its argument, so a direct
    // derivation over the MUTATED original sees the relabeling —
    // the grant path never uses that argument.)
    const authority = deriveActorAuthority(contributor, TEST_REGISTRY);
    assert.ok(authority);
    assert.equal(authority.actor_can_write, false, "the pure derivation sees the mutated argument");
    assert.ok(
      createDelegatedGrant(baseGrantInput({ actor: contributor, allowed_tools: ["radar.remember"], allowed_actions: ["write"] }), NOW, INTEGRITY),
      "the write grant still succeeds exactly as policy defines",
    );
  } finally {
    entry.is_write_operation = origWrite;
  }
});

test("C7: unknown tools remain denied", () => {
  setMembershipState({ actor: ACTOR, workspace: W, role: "admin" });
  const admin = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
  assert.ok(admin);
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor: admin, allowed_tools: ["totally.unregistered"] }), NOW, INTEGRITY),
    null,
  );
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
  console.log("\nM2.2.3 authority-hardening tests: " + passed + " passed, " + failed + " failed");
  return { failed, passed };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const { failed } = await runAllTests();
  process.exit(failed > 0 ? 1 : 0);
}
