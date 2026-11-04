/**
 * RADARMatrix Delegation & Approval Tests (M2, Phase P4; hardened M2.2; corrected M2.2.1)
 *
 * Verifies the owner-approved M2 delegation and approval-token
 * architecture:
 *   apps/mcp-server/src/auth/delegation.ts   (scoped delegated grants)
 *   apps/mcp-server/src/auth/approvals.ts    (single-use approval tokens)
 *
 * Security invariants verified:
 * - An agent NEVER inherits its delegating actor's full authority:
 *   grants are subset-enforced at creation time.
 * - Actor authority is DERIVED from a trusted server-side actor
 *   context minted by createTrustedActorContext (verified membership
 *   + derived role) — inputs still carrying caller-supplied
 *   actor_tools/actor_can_write are rejected outright.
 * - M2.2.1: plain object literals shaped like TrustedActorContext
 *   carry no runtime brand and are rejected (provenance is runtime,
 *   never compile-time).
 * - M2.2.1: grants are sealed with a server-held HMAC-SHA-256
 *   integrity service binding EVERY security-relevant field
 *   including the current use count; unkeyed hashes cannot bypass.
 * - M2.2.1: reserveGrantUse atomically consumes a use BEFORE
 *   dispatch and re-seals the grant.
 * - Write delegation requires the actor to hold write capability.
 * - Grants bind one agent + one workspace; mismatch fails closed.
 * - Expiry and use limits are enforced on every validation.
 * - Approvals are Ed25519-signed, short-lived, scope-bound to an
 *   exact action + exact resource list, workspace- and actor-bound,
 *   and redeemable exactly once. Replay is denied.
 * - Malformed or forged tokens fail closed.
 *
 * These modules are implemented and unit-tested but NOT yet wired
 * into the gateway for execution; runtime execution remains future
 * work (M3+). The delegation mechanism is NOT connected to
 * unrestricted agent execution.
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

/** Server-held test secret (>= 32 chars per the entropy policy). */
const INTEGRITY_SECRET =
  "test-suite-integrity-secret-0123456789abcdef";
const INTEGRITY = createGrantIntegrityService(INTEGRITY_SECRET);
assert.ok(INTEGRITY, "test integrity service must construct");

/**
 * Membership source double: the role the trusted membership layer
 * reports for (caller, workspace). Everything else fails membership.
 */
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

/** Mints a RUNTIME-BRANDED trusted actor context (the only legal way). */
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
      max_uses: 2,
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
// M2.2/M2.2.1: derived actor authority — never caller-supplied,
// never compile-time-only.
// ---------------------------------------------------------------------------
test("M2.2.1: deriveActorAuthority derives tools from verified roles, never from the caller", () => {
  const viewer = deriveActorAuthority(trustedActor("viewer"), TOOL_REGISTRY);
  assert.ok(viewer, "viewer authority must derive");
  assert.equal(viewer.actor_can_write, false, "viewer never derives write capability");
  assert.ok(viewer.actor_tools.includes("radar.search"), "viewer derives read tools");
  assert.ok(!viewer.actor_tools.includes("radar.remember"), "viewer must not derive write tools");

  const admin = deriveActorAuthority(trustedActor("admin"), TOOL_REGISTRY);
  assert.ok(admin.actor_tools.length === Object.keys(TOOL_REGISTRY).length, "admin derives every registered tool");
  assert.equal(admin.actor_can_write, true, "admin derives write capability");
});

test("M2.2.1: a caller-constructed (unbranded) actor object is rejected at RUNTIME — the type is not the boundary", () => {
  // A plain literal shaped exactly like TrustedActorContext, claiming
  // admin. It carries no runtime brand and must fail closed.
  const fabricatedAdmin = {
    actor_id: "attacker",
    actor_roles: ["admin"],
    workspace_id: W,
  };
  assert.equal(deriveActorAuthority(fabricatedAdmin, TOOL_REGISTRY), null, "unbranded context must never derive authority");
  assert.equal(
    createDelegatedGrant(
      Object.assign(baseGrantInput(), { actor: fabricatedAdmin }),
      NOW,
      INTEGRITY,
    ),
    null,
    "a grant on a fabricated admin context must be rejected",
  );
});

test("M2.2.1: createTrustedActorContext fails closed on malformed/unauthenticated/malicious membership sources", () => {
  assert.equal(createTrustedActorContext(null, membershipFor("editor")), null);
  assert.equal(createTrustedActorContext({ caller_id: "", workspace_id: W }, membershipFor("editor")), null);
  assert.equal(createTrustedActorContext({ caller_id: ACTOR, workspace_id: "" }, membershipFor("editor")), null);
  // Not a member => no trusted context (unauthenticated actor).
  assert.equal(
    createTrustedActorContext({ caller_id: ACTOR, workspace_id: W }, membershipFor("editor", { isMember: () => false })),
    null,
    "non-members never receive a trusted context",
  );
  // Unknown role from the membership layer => fail closed.
  assert.equal(
    createTrustedActorContext({ caller_id: ACTOR, workspace_id: W }, membershipFor(null, { rawRole: "superuser" })),
    null,
    "unknown roles never receive a trusted context",
  );
  // Malformed membership surface => fail closed.
  assert.equal(createTrustedActorContext({ caller_id: ACTOR, workspace_id: W }, null), null);
  assert.equal(createTrustedActorContext({ caller_id: ACTOR, workspace_id: W }, {}), null);
});

test("M2.2: caller-supplied actor_tools / actor_can_write are rejected outright", () => {
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor_tools: ["radar.search"], actor_can_write: true }), NOW, INTEGRITY),
    null,
    "actor_tools input must be rejected",
  );
  assert.equal(
    createDelegatedGrant(baseGrantInput({ actor_can_write: true }), NOW, INTEGRITY),
    null,
    "actor_can_write input must be rejected",
  );
});

// ---------------------------------------------------------------------------
// Delegated grants: subset enforcement (agent privilege escalation).
// ---------------------------------------------------------------------------
test("valid scoped grant is created and sealed with a keyed HMAC integrity seal", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  assert.ok(grant, "valid grant must be created");
  assert.equal(grant.agent_id, AGENT);
  assert.equal(grant.workspace_id, W);
  assert.equal(grant.expires_at, NOW + 600);
  assert.equal(grant.uses, 0);
  assert.equal(typeof grant.integrity_hash, "string");
  assert.ok(grant.integrity_hash.length === 64, "HMAC-SHA-256 hex seal expected");
  // The secret never appears in the grant.
  assert.ok(!JSON.stringify(grant).includes(INTEGRITY_SECRET), "the integrity secret must never be embedded in a grant");
});

test("M2.2.1: a grant cannot be created without the server-held integrity service (fail closed)", () => {
  assert.equal(createDelegatedGrant(baseGrantInput(), NOW, null), null, "missing integrity service must fail closed");
  assert.equal(createDelegatedGrant(baseGrantInput(), NOW, undefined), null);
  assert.equal(createDelegatedGrant(baseGrantInput(), NOW, {}), null, "a non-service object must fail closed");
});

test("grant requesting a tool OUTSIDE the actor's derived authority is rejected (escalation control)", () => {
  const escalated = createDelegatedGrant(
    baseGrantInput({
      actor: trustedActor("viewer"),
      allowed_tools: ["radar.remember"],
      allowed_actions: ["write"],
    }),
    NOW,
    INTEGRITY,
  );
  assert.equal(escalated, null, "subset violation must be rejected at creation");
  const within = createDelegatedGrant(
    baseGrantInput({
      actor: trustedActor("viewer"),
      allowed_tools: ["radar.search"],
      allowed_actions: ["read"],
    }),
    NOW,
    INTEGRITY,
  );
  assert.ok(within, "viewer within subset is fine");
});

test("grant requesting an unknown tool is rejected", () => {
  const g = createDelegatedGrant(
    baseGrantInput({ allowed_tools: ["totally.made_up_tool"] }),
    NOW,
    INTEGRITY,
  );
  assert.equal(g, null);
});

test("write delegation requires the actor to hold derived write capability", () => {
  const ok = createDelegatedGrant(
    baseGrantInput({
      allowed_tools: ["radar.remember"],
      allowed_actions: ["write"],
    }),
    NOW,
    INTEGRITY,
  );
  assert.ok(ok, "editor may delegate write");
  const denied = createDelegatedGrant(
    baseGrantInput({
      actor: trustedActor("viewer"),
      allowed_tools: ["radar.remember"],
      allowed_actions: ["write"],
    }),
    NOW,
    INTEGRITY,
  );
  assert.equal(denied, null, "read-only actor must not delegate write");
});

test("unknown action and duplicate actions are rejected", () => {
  assert.equal(createDelegatedGrant(baseGrantInput({ allowed_actions: ["admin"] }), NOW, INTEGRITY), null);
  assert.equal(createDelegatedGrant(baseGrantInput({ allowed_actions: ["read", "read"] }), NOW, INTEGRITY), null);
  assert.equal(createDelegatedGrant(baseGrantInput({ allowed_actions: [] }), NOW, INTEGRITY), null);
});

test("absurd TTLs are rejected (too short, zero, negative, too long)", () => {
  assert.equal(createDelegatedGrant(baseGrantInput({ ttl_seconds: 0 }), NOW, INTEGRITY), null);
  assert.equal(createDelegatedGrant(baseGrantInput({ ttl_seconds: -5 }), NOW, INTEGRITY), null);
  assert.equal(createDelegatedGrant(baseGrantInput({ ttl_seconds: 60 * 60 * 24 }), NOW, INTEGRITY), null);
});

test("agent cannot equal actor (self-delegation rejected)", () => {
  assert.equal(createDelegatedGrant(baseGrantInput({ agent_id: ACTOR }), NOW, INTEGRITY), null);
});

test("missing or malformed actor context fails closed", () => {
  assert.equal(createDelegatedGrant(baseGrantInput({ actor: null }), NOW, INTEGRITY), null);
  // Branded contexts are minted ONLY from verified membership; a
  // context whose membership is unverifiable yields null first.
  const noRole = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W }, membershipFor(null, { rawRole: "not_a_role" }));
  assert.equal(noRole, null);
  const otherActorGrant = createDelegatedGrant(
    baseGrantInput({ actor: trustedActor("admin", { actor: "u_other" }) }),
    NOW,
    INTEGRITY,
  );
  assert.ok(otherActorGrant, "admin actor context must derive authority");
  assert.equal(otherActorGrant.actor_id, "u_other", "the grant binds to the trusted context's actor, not the caller's assertion");
});

// ---------------------------------------------------------------------------
// Delegated grants: validation-time enforcement.
// ---------------------------------------------------------------------------
test("valid use passes; agent mismatch, workspace mismatch fail closed", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, INTEGRITY).valid, true);
  assert.equal(validateGrantUse(grant, baseCheck({ agent_id: "other_agent" }), NOW, INTEGRITY).reason, "agent_mismatch");
  assert.equal(validateGrantUse(grant, baseCheck({ workspace_id: "w_other" }), NOW, INTEGRITY).reason, "workspace_mismatch");
});

test("tool outside the grant is denied (scope not inherited)", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  const r = validateGrantUse(grant, baseCheck({ tool: "radar.recall" }), NOW, INTEGRITY);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "tool_not_allowed");
});

test("write action on a read-only grant is denied", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  const r = validateGrantUse(grant, baseCheck({ action: "write" }), NOW, INTEGRITY);
  assert.equal(r.reason, "action_not_allowed");
});

test("expired grant is denied at validation time", () => {
  const grant = createDelegatedGrant(baseGrantInput({ ttl_seconds: 60 }), NOW, INTEGRITY);
  const r = validateGrantUse(grant, baseCheck(), NOW + 61, INTEGRITY);
  assert.equal(r.reason, "grant_expired");
});

test("M2.2: a non-finite validation clock is rejected (invalid_clock)", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  assert.equal(validateGrantUse(grant, baseCheck(), NaN, INTEGRITY).reason, "invalid_clock");
  assert.equal(validateGrantUse(grant, baseCheck(), Infinity, INTEGRITY).reason, "invalid_clock");
});

test("M2.2.1: use limit enforcement via ATOMIC reservation (validate -> reserve -> deny)", () => {
  const grant = createDelegatedGrant(baseGrantInput({ max_uses: 2 }), NOW, INTEGRITY);
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, INTEGRITY).valid, true);
  assert.equal(reserveGrantUse(grant, INTEGRITY, NOW).reserved, true, "first use reserves");
  assert.equal(grant.uses, 1);
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, INTEGRITY).valid, true, "the re-sealed grant still validates after reservation");
  assert.equal(reserveGrantUse(grant, INTEGRITY, NOW).reserved, true, "second use reserves");
  assert.equal(grant.uses, 2);
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, INTEGRITY).reason, "use_limit_reached");
  assert.equal(reserveGrantUse(grant, INTEGRITY, NOW).reserved, false, "the exhausted grant cannot reserve");
  assert.equal(reserveGrantUse(grant, INTEGRITY, NOW).reason, "use_limit_reached");
});

test("M2.2: grant mutation is rejected at validation time (integrity seal)", () => {
  const grant = createDelegatedGrant(baseGrantInput({ ttl_seconds: 60 }), NOW, INTEGRITY);
  // Tamper: extend the expiry.
  const extended = Object.assign({}, grant, { expires_at: NOW + 9999 });
  assert.equal(validateGrantUse(extended, baseCheck(), NOW, INTEGRITY).reason, "grant_mutated");
  // Tamper: widen the tool list.
  const widened = Object.assign({}, grant, { allowed_tools: ["radar.search", "radar.remember"] });
  assert.equal(validateGrantUse(widened, baseCheck({ tool: "radar.remember" }), NOW, INTEGRITY).reason, "grant_mutated");
  // Tamper: inflate the use limit.
  const inflated = Object.assign({}, grant, { max_uses: 999 });
  assert.equal(validateGrantUse(inflated, baseCheck(), NOW, INTEGRITY).reason, "grant_mutated");
  // M2.2.1: tamper: ROLL BACK the use count (reset attack).
  const rolledBack = Object.assign({}, grant, { uses: 0 });
  assert.equal(validateGrantUse(rolledBack, baseCheck(), NOW, INTEGRITY).reason, "grant_mutated");
  // Tamper: strip the seal.
  const stripped = Object.assign({}, grant, { integrity_hash: "" });
  assert.equal(validateGrantUse(stripped, baseCheck(), NOW, INTEGRITY).reason, "malformed_grant");
  // Sanity: the untouched grant still validates.
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, INTEGRITY).valid, true);
});

test("M2.2.1: a recomputed UNKEYED hash cannot bypass the integrity seal", () => {
  const grant = createDelegatedGrant(baseGrantInput({ ttl_seconds: 60 }), NOW, INTEGRITY);
  // Attacker widens the tool list and recomputes the PLAIN sha256
  // over the canonical fields (the M2.2 seal) — the HMAC must reject.
  const tampered = Object.assign({}, grant, { allowed_tools: ["radar.search", "radar.remember"] });
  const canonical = [
    tampered.grant_id, tampered.actor_id, tampered.agent_id, tampered.workspace_id,
    tampered.allowed_tools.slice().sort(),
    tampered.allowed_actions.slice().sort(),
    tampered.expires_at, tampered.max_uses, tampered.uses,
  ];
  tampered.integrity_hash = createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
  assert.equal(
    validateGrantUse(tampered, baseCheck({ tool: "radar.remember" }), NOW, INTEGRITY).reason,
    "grant_mutated",
    "an unkeyed hash must never satisfy the keyed seal",
  );
});

test("M2.2.1: validation fails closed without the integrity service (integrity_unavailable)", () => {
  const grant = createDelegatedGrant(baseGrantInput(), NOW, INTEGRITY);
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, null).reason, "integrity_unavailable");
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, undefined).reason, "integrity_unavailable");
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, {}).reason, "integrity_unavailable");
  assert.equal(reserveGrantUse(grant, null, NOW).reason, "integrity_unavailable");
});

test("M2.2.1: a seal from a DIFFERENT integrity secret never validates (wrong secret fails closed)", () => {
  const other = createGrantIntegrityService("another-server-secret-abcdefghijklmnopqrstuvwxyz-0123456789");
  assert.ok(other);
  const grant = createDelegatedGrant(baseGrantInput(), NOW, other);
  // Verified with the correct service:
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, other).valid, true);
  // Verified with the WRONG server secret:
  assert.equal(validateGrantUse(grant, baseCheck(), NOW, INTEGRITY).reason, "grant_mutated");
  assert.equal(reserveGrantUse(grant, INTEGRITY, NOW).reason, "grant_mutated");
});

test("M2.2.1: the integrity service refuses weak/missing secrets (fail closed at construction)", () => {
  assert.equal(createGrantIntegrityService(null), null);
  assert.equal(createGrantIntegrityService(undefined), null);
  assert.equal(createGrantIntegrityService(12345), null);
  assert.equal(createGrantIntegrityService(""), null);
  assert.equal(createGrantIntegrityService("too-short-secret"), null, "secrets below the entropy floor must not construct a service");
});

test("malformed grant objects fail closed", () => {
  assert.equal(validateGrantUse(null, baseCheck(), NOW, INTEGRITY).valid, false);
  assert.equal(validateGrantUse({}, baseCheck(), NOW, INTEGRITY).reason, "malformed_grant");
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
  assert.equal(issueFor({ now: NaN }), null, "M2.2: non-finite issue clock must not mint an approval");
  assert.equal(issueFor({ now: Infinity }), null, "M2.2: non-finite issue clock must not mint an approval");
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

test("M2.2: atomic redemption — claim() is a check-and-set, second claim loses", () => {
  const red = createRedemptionRecord();
  assert.equal(red.claim("jti_a"), true, "first claim wins");
  assert.equal(red.claim("jti_a"), false, "second claim for the same jti must lose");
  assert.equal(red.has("jti_a"), true);
  assert.equal(red.size(), 1);
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
