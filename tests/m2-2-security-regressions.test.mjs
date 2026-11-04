/**
 * RADARMatrix M2.2 Security Regression Suite
 *
 * Owner-directed security corrections (M2.2 directive, 2026-11-04):
 *   A. Runtime mode must fail closed (apps/mcp-server/src/mcp-gateway.ts)
 *   C. Approval token claim/clock validation hardened
 *      (apps/mcp-server/src/auth/approvals.ts)
 *
 * Runtime-mode tests run the REAL gateway in child processes through
 * handleRequest only — no bypass — exactly as the existing suites do.
 * They verify ACTUAL DENIAL BEHAVIOR (401 + empty membership), not
 * merely that an error was returned.
 *
 * Security invariants verified:
 * - An unset, empty, misspelled, or unknown RADARMATRIX_RUNTIME_MODE
 *   yields "fail_closed": development identities can NEVER
 *   authenticate, and no principal is a member of any workspace.
 * - Explicit "development" and "test" modes activate the
 *   deterministic fixtures; explicit "production" activates the
 *   production chain only with a COMPLETE configuration.
 * - A signed approval with malformed claims structure (non-finite
 *   iat/exp, non-integer timestamps, exp <= iat, missing scope
 *   fields) is rejected before any scope decision.
 * - A non-finite verification clock (NaN/Infinity) can never
 *   validate an approval.
 *
 * Failures are counted and returned to tests/test-runner.mjs, which
 * exits non-zero when any test fails. Standalone runs exit non-zero.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { sign as cryptoSign, createPrivateKey } from "node:crypto";

import {
  issueApproval,
  verifyApproval,
  createRedemptionRecord,
} from "../apps/mcp-server/src/auth/approvals.ts";
import {
  generateEd25519KeyPair,
} from "../apps/mcp-server/src/auth/token-service.ts";

const NOW = 1_000_000;
const W = "w_prod";
const ACTOR = "user_editor";
const approvalKeys = generateEd25519KeyPair();

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// A. Runtime mode — the real gateway in child processes.
// ---------------------------------------------------------------------------
const GATEWAY_URL = new URL("../apps/mcp-server/src/mcp-gateway.ts", import.meta.url).href;

const CHILD_SCRIPT = [
  "const g = await import(process.env.GATEWAY_URL);",
  "const out = { mode: typeof g.getRuntimeMode === \"function\" ? g.getRuntimeMode() : null };",
  "const read = g.handleRequest({ tool: \"radar.search\", params: { workspace_id: \"w_dev\", query: \"x\" }, context: { caller_id: \"admin_123\", workspace_id: \"w_dev\" } });",
  "out.read = { success: read.success, code: read.error ? read.error.code : null, status: read.error ? read.error.status : null };",
  "const write = g.handleRequest({ tool: \"radar.remember\", params: { workspace_id: \"w_dev\", content: \"x\" }, context: { caller_id: \"admin_123\", workspace_id: \"w_dev\" } });",
  "out.write = { success: write.success, code: write.error ? write.error.code : null, status: write.error ? write.error.status : null };",
  "out.isolation = g.validateWorkspaceIsolation({ caller_id: \"admin_123\", caller_roles: [\"admin\"], workspace_id: \"w_dev\", request_id: \"r\", timestamp: new Date().toISOString(), tool: \"radar.search\", params: {} });",
  "console.log(JSON.stringify(out));",
].join("\n");

/**
 * Runs the real gateway in a child process with the given runtime
 * mode (mode === undefined => the variable is DELETED from env).
 */
function runGatewayChild(mode) {
  const env = Object.assign({}, process.env, { GATEWAY_URL });
  delete env.RADARMATRIX_RUNTIME_MODE;
  if (mode !== undefined) {
    env.RADARMATRIX_RUNTIME_MODE = mode;
  }
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", CHILD_SCRIPT], {
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, "gateway child process failed: " + String(result.stderr || "").slice(0, 800));
  return JSON.parse(result.stdout.trim().split("\n").pop());
}

const DENIED = { success: false, code: "UNAUTHENTICATED", status: 401 };

test("A: UNSET runtime mode fails closed — dev identities never authenticate", () => {
  const out = runGatewayChild(undefined);
  assert.equal(out.mode, "fail_closed");
  assert.deepEqual(out.read, DENIED);
  assert.deepEqual(out.write, DENIED);
  assert.equal(out.isolation, false, "fail_closed mode must contain no membership");
});

test("A: EMPTY runtime mode value fails closed", () => {
  const out = runGatewayChild("");
  assert.equal(out.mode, "fail_closed");
  assert.deepEqual(out.read, DENIED);
  assert.deepEqual(out.write, DENIED);
  assert.equal(out.isolation, false);
});

test("A: MISSPELLED runtime mode ('Production ') fails closed", () => {
  const out = runGatewayChild("Production ");
  assert.equal(out.mode, "fail_closed");
  assert.deepEqual(out.read, DENIED);
  assert.deepEqual(out.write, DENIED);
  assert.equal(out.isolation, false);
});

test("A: UNKNOWN runtime mode ('prod') fails closed", () => {
  const out = runGatewayChild("prod");
  assert.equal(out.mode, "fail_closed");
  assert.deepEqual(out.read, DENIED);
  assert.deepEqual(out.write, DENIED);
  assert.equal(out.isolation, false);
});

test("A: CASING mismatch ('DEVELOPMENT') fails closed — modes are exact", () => {
  const out = runGatewayChild("DEVELOPMENT");
  assert.equal(out.mode, "fail_closed");
  assert.deepEqual(out.read, DENIED);
  assert.deepEqual(out.write, DENIED);
  assert.equal(out.isolation, false);
});

test("A: EXPLICIT development mode activates the development fixtures", () => {
  const out = runGatewayChild("development");
  assert.equal(out.mode, "development");
  assert.equal(out.read.success, true, "explicit development mode must serve the deterministic dev fixtures");
  assert.equal(out.isolation, true);
});

test("A: EXPLICIT test mode activates the documented test fixtures", () => {
  const out = runGatewayChild("test");
  assert.equal(out.mode, "test");
  assert.equal(out.read.success, true, "explicit test mode must serve the deterministic test fixtures");
  assert.equal(out.isolation, true);
});

test("A: production mode with NO auth configuration fails closed (empty gates)", () => {
  const out = runGatewayChild("production");
  assert.equal(out.mode, "production");
  assert.deepEqual(out.read, DENIED, "unconfigured production must deny everything");
  assert.deepEqual(out.write, DENIED);
  assert.equal(out.isolation, false, "unconfigured production must contain no membership");
});

test("A: the parent test process itself runs in explicit test mode (no accidental default)", () => {
  assert.equal(process.env.RADARMATRIX_RUNTIME_MODE, "test", "the test scripts must set the runtime mode explicitly");
});

// ---------------------------------------------------------------------------
// C. Approval tokens — hardened claims/clock validation.
// ---------------------------------------------------------------------------

function issueFor(overrides) {
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
    approvalKeys.privateKeyPem,
  );
}

function checkFor(overrides) {
  return Object.assign(
    { action: "shell.exec", resource_id: "res_1", workspace_id: W, actor_id: ACTOR },
    overrides || {},
  );
}

/**
 * Hand-signs a raw approval payload (payload.sig format, matching
 * approvals.ts). Unlike JSON.stringify — which turns NaN/Infinity
 * into null — this lets tests place numeric literals like 1e999 in
 * the payload; JSON.parse evaluates 1e999 to Infinity, and the
 * verifier must reject it via Number.isFinite.
 */
function handSignedApproval(payloadJson, keys) {
  const payload = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signature = cryptoSign(
    null,
    Buffer.from(payload, "utf8"),
    createPrivateKey((keys || approvalKeys).privateKeyPem),
  );
  return payload + "." + signature.toString("base64url");
}

const CLAIMS_BASE = '"jti":"jti_m22","action":"shell.exec","resource_ids":["res_1"],' +
  '"workspace_id":"' + W + '","actor_id":"' + ACTOR + '"';

test("C: signed approval with non-finite exp (1e999 payload trick) is rejected", () => {
  const token = handSignedApproval("{" + CLAIMS_BASE + ',"iat":' + NOW + ',"exp":1e999}');
  const r = verifyApproval(token, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 1);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "malformed_claims");
});

test("C: signed approval with non-finite iat (1e999 payload trick) is rejected", () => {
  const token = handSignedApproval("{" + CLAIMS_BASE + ',"iat":1e999,"exp":' + (NOW + 300) + "}");
  const r = verifyApproval(token, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 1);
  assert.equal(r.reason, "malformed_claims");
});

test("C: signed approval with non-integer timestamps is rejected", () => {
  const fractional = handSignedApproval("{" + CLAIMS_BASE + ',"iat":' + NOW + ',"exp":' + (NOW + 300.5) + "}");
  assert.equal(verifyApproval(fractional, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 1).reason, "malformed_claims");
  const stringIat = handSignedApproval("{" + CLAIMS_BASE + ',"iat":"now","exp":' + (NOW + 300) + "}");
  assert.equal(verifyApproval(stringIat, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 1).reason, "malformed_claims");
});

test("C: signed approval with exp <= iat is rejected (zero/negative lifetime is never valid)", () => {
  const zero = handSignedApproval("{" + CLAIMS_BASE + ',"iat":' + NOW + ',"exp":' + NOW + "}");
  assert.equal(verifyApproval(zero, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 1).reason, "malformed_claims");
  const negative = handSignedApproval("{" + CLAIMS_BASE + ',"iat":' + NOW + ',"exp":' + (NOW - 10) + "}");
  assert.equal(verifyApproval(negative, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 1).reason, "malformed_claims");
});

test("C: signed approval with missing scope fields is rejected", () => {
  const noAction = handSignedApproval('{"jti":"jti_m22","resource_ids":["res_1"],"workspace_id":"' + W + '","actor_id":"' + ACTOR + '","iat":' + NOW + ',"exp":' + (NOW + 300) + "}");
  assert.equal(verifyApproval(noAction, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 1).reason, "malformed_claims");
  const noResources = handSignedApproval('{"jti":"jti_m22","action":"shell.exec","workspace_id":"' + W + '","actor_id":"' + ACTOR + '","iat":' + NOW + ',"exp":' + (NOW + 300) + "}");
  assert.equal(verifyApproval(noResources, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 1).reason, "malformed_claims");
});

test("C: signed approval with an empty or non-array resource list is rejected", () => {
  const emptyList = handSignedApproval('{"jti":"jti_m22","action":"shell.exec","resource_ids":[],"workspace_id":"' + W + '","actor_id":"' + ACTOR + '","iat":' + NOW + ',"exp":' + (NOW + 300) + "}");
  assert.equal(verifyApproval(emptyList, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 1).reason, "malformed_claims");
  const notArray = handSignedApproval('{"jti":"jti_m22","action":"shell.exec","resource_ids":"res_1","workspace_id":"' + W + '","actor_id":"' + ACTOR + '","iat":' + NOW + ',"exp":' + (NOW + 300) + "}");
  assert.equal(verifyApproval(notArray, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 1).reason, "malformed_claims");
});

test("C: a non-finite verification clock can never validate an approval", () => {
  const issued = issueFor();
  assert.equal(verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NaN).reason, "invalid_clock");
  assert.equal(verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), Infinity).reason, "invalid_clock");
  assert.equal(verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), "now").reason, "invalid_clock");
});

test("C: a failed clock validation never consumes the approval", () => {
  const issued = issueFor();
  const red = createRedemptionRecord();
  assert.equal(verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor(), red, NaN).reason, "invalid_clock");
  assert.equal(red.size(), 0, "invalid clock must not redeem the jti");
  assert.equal(verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor(), red, NOW + 1).valid, true, "the approval remains redeemable with a valid clock");
});

test("C: sanity — the valid baseline still verifies at the deterministic clock", () => {
  const issued = issueFor();
  assert.ok(issued && issued.token);
  const r = verifyApproval(issued.token, approvalKeys.publicKeyPem, checkFor(), createRedemptionRecord(), NOW + 1);
  assert.equal(r.valid, true);
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
  console.log("\nM2.2 security regression tests: " + passed + " passed, " + failed + " failed");
  return { failed, passed };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const { failed } = runAllTests();
  process.exit(failed > 0 ? 1 : 0);
}
