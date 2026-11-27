import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_MESSAGE_BYTES,
  encodeNdjsonFrame,
  decodeNdjsonFrame,
  validateExecutionEnvelope,
  validateExecutionSessionClaims,
  validateNamedToolCall,
} from "../apps/mcp-server/src/auth/execution-boundary.ts";
const NOW = Math.floor(Date.now() / 1000);
const session = { token_use: "execution-session", session_id: "s_1", actor_id: "actor_1", agent_id: "agent_1", workspace_id: "w_1", audience: "local-execution", issuer: "control-plane", issued_at: NOW - 1, expires_at: NOW + 300, jti: "j_1" };
const request = { version: "RM-IEP/1", type: "execution.request", message_id: "m_1", request_id: "r_1", session, tool: { name: "radar.search", arguments: { workspace_id: "w_1", query: "status" } }, created_at: NOW };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
test("validates a named tool request and rejects arbitrary command strings", () => {
  assert.equal(validateNamedToolCall(request.tool).valid, true);
  assert.equal(validateNamedToolCall({ name: "shell.exec", arguments: { command: "id" } }).valid, false);
  assert.equal(validateNamedToolCall({ name: "radar.search", arguments: { workspace_id: "w_1", query: "x", command: "id" } }).code, "arbitrary_command_rejected");
  assert.equal(validateNamedToolCall({ name: "radar.search", arguments: { workspace_id: "w_1" } }).valid, false);
});
test("validates execution-session claims with expiry, audience, and clock skew", () => {
  assert.equal(validateExecutionSessionClaims(session, NOW).valid, true);
  assert.equal(validateExecutionSessionClaims({ ...session, audience: "wrong" }, NOW).valid, false);
  assert.equal(validateExecutionSessionClaims({ ...session, expires_at: NOW }, NOW).valid, false);
  assert.equal(validateExecutionSessionClaims({ ...session, issued_at: NOW + 31 }, NOW).valid, false);
});
test("validates versioned request, response, cancellation, failure, and audit envelopes", () => {
  assert.equal(validateExecutionEnvelope(request, NOW * 1000).valid, true);
  assert.equal(validateExecutionEnvelope({ ...request, version: "RM-IEP/2" }, NOW * 1000).valid, false);
  for (const message of [
    { version: "RM-IEP/1", type: "execution.response", message_id: "m", request_id: "r", status: "denied", created_at: NOW, error_code: "denied" },
    { version: "RM-IEP/1", type: "execution.cancel", message_id: "m", request_id: "r", session_id: "s", reason: "operator", created_at: NOW },
    { version: "RM-IEP/1", type: "execution.failure", message_id: "m", request_id: "r", session_id: "s", code: "timeout", retryable: false, created_at: NOW },
    { version: "RM-IEP/1", type: "execution.audit", message_id: "m", request_id: "r", session_id: "s", actor_id: "a", agent_id: "g", workspace_id: "w", tool: "radar.search", outcome: "failed", created_at: NOW },
  ]) assert.equal(validateExecutionEnvelope(message, NOW * 1000).valid, true);
});
test("enforces local NDJSON framing and the 1 MiB maximum", () => {
  const encoded = encodeNdjsonFrame(request);
  assert.equal(encoded.valid, true);
  assert.deepEqual(decodeNdjsonFrame(encoded.value).valid, true);
  assert.equal(decodeNdjsonFrame(encoded.value + "extra\n").valid, false);
  const oversized = { ...request, tool: { name: "radar.search", arguments: { workspace_id: "w_1", query: "x", padding: "x".repeat(MAX_MESSAGE_BYTES) } } };
  assert.equal(encodeNdjsonFrame(oversized).code, "message_too_large");
});
test("import guard scans all supported extensions and loading forms", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-boundary-"));
  try {
    const fixtures = [
      ["bad.tsx", "const x = import(target);"],
      ["bad.mts", "const x = require(target);"],
      ["bad.cts", "const x = require(target);"],
    ];
    for (const [name, source] of fixtures) writeFileSync(join("tests", name), source);
    const result = spawnSync(process.execPath, ["scripts/check-authority-boundary.mjs"], { cwd: process.cwd(), encoding: "utf8" });
    for (const [name] of fixtures) rmSync(join("tests", name), { force: true });
    assert.notEqual(result.status, 0, "non-literal loaders must be rejected");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
export function runAllTests() {
  let passed = 0; let failed = 0;
  for (const { name, fn } of tests) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (error) { failed++; console.log(`  ✗ ${name}: ${error?.message || String(error)}`); } }
  console.log(`\nM2.3.1 boundary-contract tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
if (import.meta.url === `file://${process.argv[1]}`) process.exit(runAllTests().failed ? 1 : 0);
