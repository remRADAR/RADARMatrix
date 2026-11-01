/**
 * RADARMatrix Production Authentication & Membership Tests (M2)
 *
 * Implements the negative-JWT matrix and the production authentication
 * chain verification from the owner-approved M2 assessment:
 *   apps/mcp-server/src/auth/token-service.ts          (control-plane tokens)
 *   apps/mcp-server/src/auth/production-authentication.ts
 *   apps/mcp-server/src/providers/membership-file.cjs   (durable membership)
 *   apps/mcp-server/src/mcp-gateway.ts                  (wiring, config gate)
 *
 * Security invariants verified:
 * - Signature verification is ALWAYS required. An unsigned or decoded
 *   payload is never an identity.
 * - Issuer/audience are exact-match. Expiry and not-before enforced.
 * - Roles and workspace access are NEVER token claims — they come from
 *   the durable membership record only.
 * - Production mode fails closed on ANY incomplete configuration, even
 *   with a cryptographically valid token in hand.
 * - No wildcard membership; unknown roles fail at grant time.
 *
 * Failures are counted and returned to tests/test-runner.mjs, which
 * exits non-zero when any test fails. Standalone runs exit non-zero.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  generateEd25519KeyPair,
  mintGatewayToken,
  verifyGatewayToken,
  createTokenDenylist,
} from "../apps/mcp-server/src/auth/token-service.ts";
import {
  ProductionAuthenticationProvider,
  isProductionAuthConfigured,
} from "../apps/mcp-server/src/auth/production-authentication.ts";
import {
  FileMembershipProvider,
} from "../apps/mcp-server/src/providers/membership-file.js";

const ISSUER = "https://auth.radarmatrix.test";
const AUDIENCE = "radarmatrix-gateway";
const W_PROD = "w_prod";
const W_OTHER = "w_other";

const gatewayKeyPair = generateEd25519KeyPair();
const attackerKeyPair = generateEd25519KeyPair();

function mintFor(sub, overrides) {
  return mintGatewayToken(
    Object.assign(
      { sub, issuer: ISSUER, audience: AUDIENCE, ttlSeconds: 900 },
      overrides || {},
    ),
    gatewayKeyPair.privateKeyPem,
  );
}

function makeRequest(sub, workspaceId, token) {
  return {
    tool: "radar.search",
    params: { workspace_id: workspaceId, query: "x" },
    context: {
      caller_id: sub,
      workspace_id: workspaceId,
      request_id: "req_m2_" + sub,
      timestamp: new Date().toISOString(),
      token,
    },
  };
}

const providerAuthFailures = [];

function buildMembershipRecord() {
  return new FileMembershipProvider({
    members: {
      user_editor: [{ workspace: W_PROD, role: "editor" }],
      user_viewer: [{ workspace: W_PROD, role: "viewer" }],
      user_outsider: [{ workspace: W_OTHER, role: "admin" }],
    },
  });
}

function buildProvider(membership) {
  return new ProductionAuthenticationProvider({
    publicKeyPem: gatewayKeyPair.publicKeyPem,
    issuer: ISSUER,
    audience: AUDIENCE,
    membership,
    onAuthFailure: (reason, subject) => {
      providerAuthFailures.push(reason + ":" + subject);
    },
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// Token service: negative JWT matrix (threat model rows 2, 3, 4, 8, 16, 17).
// ---------------------------------------------------------------------------
test("valid token verifies and returns correct claims", () => {
  const token = mintFor("user_editor");
  const claims = verifyGatewayToken(token, gatewayKeyPair.publicKeyPem, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  assert.ok(claims, "valid token must verify");
  assert.equal(claims.sub, "user_editor");
  assert.equal(claims.iss, ISSUER);
  assert.equal(claims.aud, AUDIENCE);
  assert.equal(typeof claims.jti, "string");
  assert.ok(claims.jti.length > 0);
});

test("tampered payload is rejected (signature covers the payload)", () => {
  const token = mintFor("user_editor");
  const parts = token.split(".");
  const forgedPayload = Buffer.from(
    JSON.stringify({ sub: "attacker", iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 900, iat: 1, jti: "x" }),
  ).toString("base64url");
  const tampered = parts[0] + "." + forgedPayload + "." + parts[2];
  assert.equal(
    verifyGatewayToken(tampered, gatewayKeyPair.publicKeyPem, { issuer: ISSUER, audience: AUDIENCE }),
    null,
  );
});

test("expired token is rejected", () => {
  const token = mintFor("user_editor", { ttlSeconds: -120 });
  assert.equal(
    verifyGatewayToken(token, gatewayKeyPair.publicKeyPem, { issuer: ISSUER, audience: AUDIENCE }),
    null,
  );
});

test("not-yet-valid token is rejected", () => {
  const token = mintFor("user_editor", { notBefore: Math.floor(Date.now() / 1000) + 3600 });
  assert.equal(
    verifyGatewayToken(token, gatewayKeyPair.publicKeyPem, { issuer: ISSUER, audience: AUDIENCE }),
    null,
  );
});

test("wrong issuer is rejected (exact match)", () => {
  const token = mintGatewayToken(
    { sub: "user_editor", issuer: "https://evil.example", audience: AUDIENCE, ttlSeconds: 900 },
    gatewayKeyPair.privateKeyPem,
  );
  assert.equal(
    verifyGatewayToken(token, gatewayKeyPair.publicKeyPem, { issuer: ISSUER, audience: AUDIENCE }),
    null,
  );
});

test("wrong audience is rejected (exact match)", () => {
  const token = mintGatewayToken(
    { sub: "user_editor", issuer: ISSUER, audience: "other-service", ttlSeconds: 900 },
    gatewayKeyPair.privateKeyPem,
  );
  assert.equal(
    verifyGatewayToken(token, gatewayKeyPair.publicKeyPem, { issuer: ISSUER, audience: AUDIENCE }),
    null,
  );
});

test("forged signature (attacker key) is rejected", () => {
  const token = mintGatewayToken(
    { sub: "user_editor", issuer: ISSUER, audience: AUDIENCE, ttlSeconds: 900 },
    attackerKeyPair.privateKeyPem,
  );
  assert.equal(
    verifyGatewayToken(token, gatewayKeyPair.publicKeyPem, { issuer: ISSUER, audience: AUDIENCE }),
    null,
  );
});

test("unsigned token (alg none) is rejected — a decoded payload is never an identity", () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "user_editor", iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 900, iat: 1, jti: "x" }),
  ).toString("base64url");
  const unsigned = header + "." + payload + ".";
  assert.equal(
    verifyGatewayToken(unsigned, gatewayKeyPair.publicKeyPem, { issuer: ISSUER, audience: AUDIENCE }),
    null,
  );
});

test("malformed tokens are rejected (2-part, empty, garbage)", () => {
  for (const bad of ["", "a.b", "a.b.c.d", "just-a-string"]) {
    assert.equal(
      verifyGatewayToken(bad, gatewayKeyPair.publicKeyPem, { issuer: ISSUER, audience: AUDIENCE }),
      null,
    );
  }
});

test("revoked jti is rejected (denylist replay prevention)", () => {
  const token = mintFor("user_editor");
  const denylist = createTokenDenylist();
  const first = verifyGatewayToken(token, gatewayKeyPair.publicKeyPem, {
    issuer: ISSUER,
    audience: AUDIENCE,
    isDenied: (jti) => denylist.has(jti),
  });
  assert.ok(first, "first use must verify");
  denylist.add(first.jti);
  const second = verifyGatewayToken(token, gatewayKeyPair.publicKeyPem, {
    issuer: ISSUER,
    audience: AUDIENCE,
    isDenied: (jti) => denylist.has(jti),
  });
  assert.equal(second, null, "revoked jti must never verify again");
});

// ---------------------------------------------------------------------------
// Configuration gate (threat model row 16: misconfigured production mode).
// ---------------------------------------------------------------------------
test("isProductionAuthConfigured: complete config true, any partial config false", () => {
  const complete = {
    RADARMATRIX_AUTH_PUBLIC_KEY: gatewayKeyPair.publicKeyPem,
    RADARMATRIX_TOKEN_ISSUER: ISSUER,
    RADARMATRIX_AUDIENCE: AUDIENCE,
    RADARMATRIX_MEMBERSHIP_FILE: "/tmp/membership.json",
  };
  assert.equal(isProductionAuthConfigured(complete), true);
  for (const missing of ["RADARMATRIX_AUTH_PUBLIC_KEY", "RADARMATRIX_TOKEN_ISSUER", "RADARMATRIX_AUDIENCE", "RADARMATRIX_MEMBERSHIP_FILE"]) {
    const partial = Object.assign({}, complete);
    delete partial[missing];
    assert.equal(isProductionAuthConfigured(partial), false, "config missing " + missing + " must not be considered configured");
  }
});

// ---------------------------------------------------------------------------
// Production provider (in-process): every fail-closed path.
// ---------------------------------------------------------------------------
test("production provider rejects a forged token", () => {
  const provider = buildProvider(buildMembershipRecord());
  const forged = mintGatewayToken(
    { sub: "user_editor", issuer: ISSUER, audience: AUDIENCE, ttlSeconds: 900 },
    attackerKeyPair.privateKeyPem,
  );
  assert.equal(provider.authenticate(makeRequest("user_editor", W_PROD, forged)), null);
});

test("production provider rejects identity mismatch (context caller_id ≠ token subject)", () => {
  const provider = buildProvider(buildMembershipRecord());
  const token = mintFor("user_editor");
  const request = makeRequest("admin_123", W_PROD, token);
  assert.equal(provider.authenticate(request), null);
});

test("production provider rejects a verified subject that is not a member of the workspace", () => {
  const provider = buildProvider(buildMembershipRecord());
  const token = mintFor("user_outsider");
  assert.equal(provider.authenticate(makeRequest("user_outsider", W_PROD, token)), null);
});

test("production provider resolves the role from the membership record — never from claims", () => {
  const provider = buildProvider(buildMembershipRecord());
  const token = mintFor("user_editor");
  const principal = provider.authenticate(makeRequest("user_editor", W_PROD, token));
  assert.ok(principal, "verified member must authenticate");
  assert.equal(principal.caller_id, "user_editor");
  assert.deepEqual(principal.roles, ["editor"]);
  assert.equal(principal.workspace_id, W_PROD);
});

test("revoked membership takes effect on the very next authenticate", () => {
  const membership = buildMembershipRecord();
  const provider = buildProvider(membership);
  const token = mintFor("user_editor");
  assert.ok(provider.authenticate(makeRequest("user_editor", W_PROD, token)));
  membership.revoke("user_editor", W_PROD);
  assert.equal(provider.authenticate(makeRequest("user_editor", W_PROD, token)), null);
});

// ---------------------------------------------------------------------------
// Durable membership record semantics (M2 §5).
// ---------------------------------------------------------------------------
test("FileMembershipProvider rejects unknown roles at grant time", () => {
  const membership = new FileMembershipProvider({ members: {} });
  assert.throws(() => membership.grant("user_x", "w_x", "superuser"));
  assert.equal(membership.isMember("user_x", "w_x"), false);
});

test("FileMembershipProvider: corrupt or missing file yields an empty fail-closed registry", () => {
  const dir = mkdtempSync(join(tmpdir(), "m2-corrupt-"));
  const badPath = join(dir, "membership.json");
  writeFileSync(badPath, "{ this is not json ");
  const membership = new FileMembershipProvider({ path: badPath });
  assert.equal(membership.hasCaller("anyone"), false);
  assert.equal(membership.isMember("anyone", "w_any"), false);
});

test("FileMembershipProvider supports explicit multi-workspace membership (no wildcard, rows only)", () => {
  const membership = new FileMembershipProvider({
    members: {
      dual_user: [
        { workspace: "w_a", role: "viewer" },
        { workspace: "w_b", role: "admin" },
      ],
    },
  });
  assert.equal(membership.isMember("dual_user", "w_a"), true);
  assert.equal(membership.isMember("dual_user", "w_b"), true);
  assert.equal(membership.isMember("dual_user", "w_c"), false);
  assert.deepEqual(membership.getWorkspaces("dual_user"), ["w_a", "w_b"]);
  assert.equal(membership.getRole("dual_user", "w_b"), "admin");
});

test("FileMembershipProvider grant/revoke persist to the backing file (new instance observes revocation)", () => {
  const dir = mkdtempSync(join(tmpdir(), "m2-persist-"));
  const membershipPath = join(dir, "membership.json");
  const writer = new FileMembershipProvider({ path: membershipPath });
  writer.grant("user_persist", W_PROD, "viewer");
  const reader = new FileMembershipProvider({ path: membershipPath });
  assert.equal(reader.isMember("user_persist", W_PROD), true);
  assert.equal(reader.getRole("user_persist", W_PROD), "viewer");
  writer.revoke("user_persist", W_PROD);
  const rereader = new FileMembershipProvider({ path: membershipPath });
  assert.equal(rereader.isMember("user_persist", W_PROD), false);
});

// ---------------------------------------------------------------------------
// Gateway integration: the REAL gateway in production mode, through
// handleRequest only (no bypass), in child processes.
// ---------------------------------------------------------------------------
function childRequestLines() {
  return [
    "const g = await import(process.env.GATEWAY_URL);",
    "const tokens = JSON.parse(process.env.TOKENS);",
    "const out = { mode: g.getRuntimeMode() };",
    "function req(sub, ws, token, tool, extra) {",
    "  const params = Object.assign({ workspace_id: ws }, extra || {});",
    "  const r = g.handleRequest({ tool: tool, params: params, context: { caller_id: sub, workspace_id: ws, request_id: \"req_child\", timestamp: new Date().toISOString(), token: token } });",
    "  return { success: r.success, code: r.error ? r.error.code : null, status: r.error ? r.error.status : null };",
    "}",
    "out.editorRead = req(\"user_editor\", \"" + W_PROD + "\", tokens.editor, \"radar.search\", { query: \"release radar\" });",
    "out.viewerRead = req(\"user_viewer\", \"" + W_PROD + "\", tokens.viewer, \"radar.search\", { query: \"x\" });",
    "out.viewerWrite = req(\"user_viewer\", \"" + W_PROD + "\", tokens.viewer, \"radar.remember\", { content: \"viewer must not write\" });",
    "out.outsider = req(\"user_outsider\", \"" + W_PROD + "\", tokens.outsider, \"radar.search\", { query: \"x\" });",
    "out.expired = req(\"user_editor\", \"" + W_PROD + "\", tokens.expired, \"radar.search\", { query: \"x\" });",
    "out.forged = req(\"user_editor\", \"" + W_PROD + "\", tokens.forged, \"radar.search\", { query: \"x\" });",
    "console.log(JSON.stringify(out));",
  ].join("\n");
}

test("gateway: production mode with full config authenticates a verified member end-to-end", () => {
  const dir = mkdtempSync(join(tmpdir(), "m2-gw-"));
  const membershipPath = join(dir, "membership.json");
  writeFileSync(membershipPath, JSON.stringify({
    user_editor: [{ workspace: W_PROD, role: "editor" }],
    user_viewer: [{ workspace: W_PROD, role: "viewer" }],
    user_outsider: [{ workspace: W_OTHER, role: "admin" }],
  }));
  const tokens = {
    editor: mintFor("user_editor"),
    viewer: mintFor("user_viewer"),
    outsider: mintFor("user_outsider"),
    expired: mintFor("user_editor", { ttlSeconds: -120 }),
    forged: mintGatewayToken({ sub: "user_editor", issuer: ISSUER, audience: AUDIENCE, ttlSeconds: 900 }, attackerKeyPair.privateKeyPem),
  };
  const gatewayUrl = new URL("../apps/mcp-server/src/mcp-gateway.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", childRequestLines()], {
    env: Object.assign({}, process.env, {
      RADARMATRIX_RUNTIME_MODE: "production",
      RADARMATRIX_AUTH_PUBLIC_KEY: gatewayKeyPair.publicKeyPem,
      RADARMATRIX_TOKEN_ISSUER: ISSUER,
      RADARMATRIX_AUDIENCE: AUDIENCE,
      RADARMATRIX_MEMBERSHIP_FILE: membershipPath,
      GATEWAY_URL: gatewayUrl,
      TOKENS: JSON.stringify(tokens),
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, "production-configured child failed: " + String(result.stderr || "").slice(0, 800));
  const parsed = JSON.parse(result.stdout.trim().split("\n").pop());
  assert.equal(parsed.mode, "production");
  assert.deepEqual(parsed.editorRead, { success: true, code: null, status: null }, "verified member read must succeed");
  assert.deepEqual(parsed.viewerRead, { success: true, code: null, status: null }, "verified viewer read must succeed");
  assert.deepEqual(parsed.viewerWrite, { success: false, code: "FORBIDDEN", status: 403 }, "viewer write must be forbidden — role comes from the membership record");
  assert.deepEqual(parsed.outsider, { success: false, code: "WORKSPACE_FORBIDDEN", status: 403 }, "verified non-member must be isolated");
  assert.deepEqual(parsed.expired, { success: false, code: "UNAUTHENTICATED", status: 401 }, "expired token must be rejected");
  assert.deepEqual(parsed.forged, { success: false, code: "UNAUTHENTICATED", status: 401 }, "forged token must be rejected");
});

test("gateway: incomplete production config fails closed — a valid token cannot authenticate", () => {
  const dir = mkdtempSync(join(tmpdir(), "m2-gw2-"));
  const membershipPath = join(dir, "membership.json");
  writeFileSync(membershipPath, JSON.stringify({
    user_editor: [{ workspace: W_PROD, role: "editor" }],
  }));
  const gatewayUrl = new URL("../apps/mcp-server/src/mcp-gateway.ts", import.meta.url).href;
  const childScript = [
    "const g = await import(process.env.GATEWAY_URL);",
    "const tokens = JSON.parse(process.env.TOKENS);",
    "const out = { mode: g.getRuntimeMode() };",
    "const r = g.handleRequest({ tool: \"radar.search\", params: { workspace_id: \"" + W_PROD + "\", query: \"x\" }, context: { caller_id: \"user_editor\", workspace_id: \"" + W_PROD + "\", request_id: \"r\", timestamp: new Date().toISOString(), token: tokens.editor } });",
    "out.read = { success: r.success, code: r.error ? r.error.code : null, status: r.error ? r.error.status : null };",
    "console.log(JSON.stringify(out));",
  ].join("\n");
  const env = Object.assign({}, process.env, {
    RADARMATRIX_RUNTIME_MODE: "production",
    RADARMATRIX_AUTH_PUBLIC_KEY: gatewayKeyPair.publicKeyPem,
    RADARMATRIX_TOKEN_ISSUER: ISSUER,
    RADARMATRIX_MEMBERSHIP_FILE: membershipPath,
    GATEWAY_URL: gatewayUrl,
    TOKENS: JSON.stringify({ editor: mintFor("user_editor") }),
  });
  delete env.RADARMATRIX_AUDIENCE; // incomplete config: must fail closed
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", childScript], { env, encoding: "utf8" });
  assert.equal(result.status, 0, "incomplete-config child failed: " + String(result.stderr || "").slice(0, 800));
  const parsed = JSON.parse(result.stdout.trim().split("\n").pop());
  assert.equal(parsed.mode, "production");
  assert.deepEqual(parsed.read, { success: false, code: "UNAUTHENTICATED", status: 401 }, "incomplete config must fail closed even with a valid token");
});

// ---------------------------------------------------------------------------
// Harness (M1a convention): failures propagate to the exit code.
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
  console.log("\nProduction authentication & membership tests: " + passed + " passed, " + failed + " failed");
  return { failed, passed };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const { failed } = runAllTests();
  process.exit(failed > 0 ? 1 : 0);
}
