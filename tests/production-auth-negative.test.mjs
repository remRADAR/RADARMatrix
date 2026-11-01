/**
 * RADARMatrix Production Authentication & Membership Tests (M2, hardened M2.1)
 *
 * Implements the negative-JWT matrix and the production authentication
 * chain verification from the owner-approved M2 assessment, extended in
 * M2.1 with the full temporal-validation and token-purpose matrix:
 *   apps/mcp-server/src/auth/token-service.ts          (control-plane tokens)
 *   apps/mcp-server/src/auth/production-authentication.ts
 *   apps/mcp-server/src/providers/membership-file.cjs   (durable membership)
 *   apps/mcp-server/src/mcp-gateway.ts                  (wiring, config gate)
 *
 * Security invariants verified:
 * - Signature verification is ALWAYS required. An unsigned or decoded
 *   payload is never an identity.
 * - Issuer/audience are exact-match. Expiry and not-before enforced.
 * - M2.1: exp/iat/nbf must be FINITE numbers (NaN, Infinity, and JSON
 *   1e999 tricks are rejected); future iat beyond the 30s skew and
 *   exp <= iat are rejected; lifetime is bounded by the documented
 *   1-hour maximum; malformed nbf is never silently accepted.
 * - M2.1: token purpose is enforced — interactive user authentication
 *   accepts ONLY token_use === "access"; service/missing/arbitrary
 *   purposes fail closed.
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
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sign as cryptoSign,
  createPrivateKey,
} from "node:crypto";

import {
  generateEd25519KeyPair,
  issueGatewayToken,
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
      { sub, issuer: ISSUER, audience: AUDIENCE, ttlSeconds: 900, tokenUse: "access" },
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
// M2.1 hardening: deterministic-clock temporal + purpose matrix.
// All temporal tests run against a fixed NOW via the verify() clock
// override — no wall-clock dependence, no sleeps.
// ---------------------------------------------------------------------------
const NOW = 2_000_000_000;
let jtiCounter = 0;

function baseClaims(overrides) {
  jtiCounter += 1;
  return Object.assign(
    {
      sub: "user_editor",
      iss: ISSUER,
      aud: AUDIENCE,
      iat: NOW,
      exp: NOW + 900,
      jti: "jti_det_" + jtiCounter,
      token_use: "access",
    },
    overrides || {},
  );
}

function signDet(claims, keys) {
  return issueGatewayToken(claims, (keys || gatewayKeyPair).privateKeyPem);
}

function verifyDet(token, opts) {
  return verifyGatewayToken(
    token,
    gatewayKeyPair.publicKeyPem,
    Object.assign({ issuer: ISSUER, audience: AUDIENCE, now: NOW }, opts || {}),
  );
}

/**
 * Hand-signs a raw JSON payload. Unlike JSON.stringify (which turns
 * NaN/Infinity into null), this lets tests place numeric literals
 * like 1e999 in the payload — JSON.parse evaluates 1e999 to Infinity,
 * so the verifier must reject it via Number.isFinite.
 */
function handSignedToken(payloadJson, keys) {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signingInput = header + "." + payload;
  const signature = cryptoSign(
    null,
    Buffer.from(signingInput, "utf8"),
    createPrivateKey((keys || gatewayKeyPair).privateKeyPem),
  );
  return signingInput + "." + signature.toString("base64url");
}

test("M2.1: deterministic baseline — valid access token verifies at the fixed clock", () => {
  const claims = verifyDet(signDet(baseClaims()));
  assert.ok(claims, "valid deterministic token must verify");
  assert.equal(claims.sub, "user_editor");
  assert.equal(claims.token_use, "access");
});

test("M2.1: future iat far beyond skew is rejected", () => {
  assert.equal(verifyDet(signDet(baseClaims({ iat: NOW + 3600 }))), null);
});

test("M2.1: iat within the 30s clock-skew allowance is accepted (skew policy unchanged)", () => {
  assert.ok(verifyDet(signDet(baseClaims({ iat: NOW + 10 }))), "iat +10s must verify");
});

test("M2.1: exp earlier than iat is rejected", () => {
  assert.equal(verifyDet(signDet(baseClaims({ exp: NOW - 1 }))), null);
});

test("M2.1: exp equal to iat is rejected", () => {
  assert.equal(verifyDet(signDet(baseClaims({ exp: NOW }))), null);
});

test("M2.1: token lifetime beyond the documented 1-hour maximum is rejected", () => {
  assert.equal(verifyDet(signDet(baseClaims({ exp: NOW + 3601 }))), null);
});

test("M2.1: token lifetime at exactly the documented maximum is accepted (boundary)", () => {
  assert.ok(verifyDet(signDet(baseClaims({ exp: NOW + 3600 }))), "exp-iat = 3600s must verify");
});

test("M2.1: expired token is rejected at the deterministic clock (exp > iat, but in the past)", () => {
  assert.equal(verifyDet(signDet(baseClaims({ iat: NOW - 1000, exp: NOW - 60 }))), null);
});

test("M2.1: future nbf beyond skew is rejected", () => {
  assert.equal(verifyDet(signDet(baseClaims({ nbf: NOW + 3600 }))), null);
});

test("M2.1: nbf within the 30s skew allowance is accepted", () => {
  assert.ok(verifyDet(signDet(baseClaims({ nbf: NOW + 10 }))), "nbf +10s must verify");
});

test("M2.1: malformed nbf (string) is rejected — invalid optional claims are never silently accepted", () => {
  assert.equal(verifyDet(signDet(baseClaims({ nbf: "tomorrow" }))), null);
});

test("M2.1: malformed nbf (null) is rejected", () => {
  assert.equal(verifyDet(signDet(baseClaims({ nbf: null }))), null);
});

test("M2.1: non-finite exp (1e999 payload trick) is rejected", () => {
  const token = handSignedToken(
    '{"sub":"user_editor","iss":"' + ISSUER + '","aud":"' + AUDIENCE +
      '","iat":' + NOW + ',"exp":1e999,"jti":"jti_inf_exp"}',
  );
  assert.equal(verifyDet(token), null);
});

test("M2.1: non-finite iat (1e999 payload trick) is rejected", () => {
  const token = handSignedToken(
    '{"sub":"user_editor","iss":"' + ISSUER + '","aud":"' + AUDIENCE +
      '","iat":1e999,"exp":' + (NOW + 900) + ',"jti":"jti_inf_iat"}',
  );
  assert.equal(verifyDet(token), null);
});

test("M2.1: minting with a non-finite expiresAt serializes to null and is rejected", () => {
  // JSON.stringify(Infinity) === "null" — the verifier must reject exp:null.
  const token = mintGatewayToken(
    { sub: "user_editor", issuer: ISSUER, audience: AUDIENCE, ttlSeconds: 900, expiresAt: Infinity, tokenUse: "access" },
    gatewayKeyPair.privateKeyPem,
  );
  assert.equal(verifyDet(token), null);
});

test("M2.1: missing jti is rejected", () => {
  assert.equal(verifyDet(signDet(baseClaims({ jti: undefined }))), null);
});

test("M2.1: empty sub is rejected", () => {
  assert.equal(verifyDet(signDet(baseClaims({ sub: "" }))), null);
});

test("M2.1: wrong signing algorithm (HS256 header) is rejected before signature handling", () => {
  const payload = Buffer.from(JSON.stringify(baseClaims()), "utf8").toString("base64url");
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const forged = header + "." + payload + "." + Buffer.from("not-a-valid-signature").toString("base64url");
  assert.equal(verifyDet(forged), null);
});

test("M2.1: wrong token purpose (service) is rejected where the access purpose is required", () => {
  assert.equal(
    verifyDet(signDet(baseClaims({ token_use: "service" })), { requiredTokenUse: "access" }),
    null,
  );
});

test("M2.1: arbitrary token purpose string is rejected — only enumerated purposes exist", () => {
  assert.equal(
    verifyDet(signDet(baseClaims({ token_use: "admin" })), { requiredTokenUse: "access" }),
    null,
  );
});

test("M2.1: missing token purpose fails closed where a purpose is required", () => {
  assert.equal(
    verifyDet(signDet(baseClaims({ token_use: undefined })), { requiredTokenUse: "access" }),
    null,
  );
});

test("M2.1: documented compatibility — standalone verify without a required purpose accepts a purpose-less token", () => {
  // Standalone callers (e.g. a future service-auth path) may not require
  // a purpose; the PURPOSE POLICY is applied by the caller that needs it.
  assert.ok(verifyDet(signDet(baseClaims({ token_use: undefined }))));
});

// ---------------------------------------------------------------------------
// M2.1 hardening: token-purpose policy on the production provider.
// ---------------------------------------------------------------------------
test("M2.1: provider accepts a valid access-purpose token end-to-end", () => {
  const provider = buildProvider(buildMembershipRecord());
  const principal = provider.authenticate(makeRequest("user_editor", W_PROD, mintFor("user_editor")));
  assert.ok(principal, "access-purpose token of a workspace member must authenticate");
  assert.equal(principal.caller_id, "user_editor");
});

test("M2.1: provider rejects a service-purpose token on the interactive user path", () => {
  const provider = buildProvider(buildMembershipRecord());
  const serviceToken = mintFor("user_editor", { tokenUse: "service" });
  assert.equal(provider.authenticate(makeRequest("user_editor", W_PROD, serviceToken)), null);
});

test("M2.1: provider rejects a token with no token purpose (fail closed)", () => {
  const provider = buildProvider(buildMembershipRecord());
  const purposeless = mintGatewayToken(
    { sub: "user_editor", issuer: ISSUER, audience: AUDIENCE, ttlSeconds: 900 },
    gatewayKeyPair.privateKeyPem,
  );
  assert.equal(provider.authenticate(makeRequest("user_editor", W_PROD, purposeless)), null);
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
// Durable membership record semantics (M2 §5; M2.1 operational boundary).
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

test("M2.1: FileMembershipProvider: a MISSING membership file yields an empty fail-closed registry", () => {
  const dir = mkdtempSync(join(tmpdir(), "m2-missing-"));
  const missingPath = join(dir, "does-not-exist.json");
  assert.equal(existsSync(missingPath), false, "precondition: file must not exist");
  const membership = new FileMembershipProvider({ path: missingPath });
  assert.equal(membership.hasCaller("anyone"), false);
  assert.equal(membership.isMember("anyone", "w_any"), false);
  assert.equal(membership.getRole("anyone", "w_any"), null);
});

test("M2.1: FileMembershipProvider: valid JSON with the wrong shape yields an empty fail-closed registry", () => {
  const dir = mkdtempSync(join(tmpdir(), "m2-shape-"));
  const badShapePath = join(dir, "membership.json");
  writeFileSync(badShapePath, JSON.stringify({
    not_an_array: "just a string",
    user_x: [{ workspace: "w_x", role: "not-a-known-role" }],
    user_y: { workspace: "w_y", role: "viewer" },
  }));
  const membership = new FileMembershipProvider({ path: badShapePath });
  assert.equal(membership.hasCaller("user_x"), false, "unknown roles must not load");
  assert.equal(membership.hasCaller("user_y"), false, "non-array entries must not load");
  assert.equal(membership.isMember("user_x", "w_x"), false);
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
  // Defense in depth: the production provider verifies membership itself,
  // so a verified identity that is not a member of the requested
  // workspace fails AUTHENTICATION (401) before the gateway's 403
  // isolation gate. Cross-workspace isolation is enforced either way.
  assert.deepEqual(parsed.outsider, { success: false, code: "UNAUTHENTICATED", status: 401 }, "verified non-member must never access the workspace");
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
