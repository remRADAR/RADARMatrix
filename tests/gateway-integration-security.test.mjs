/**
 * RADARMatrix Gateway Integration Security Test (M1a)
 *
 * This suite rewrites the intent of the v0.9-security-gate branch
 * (tests/v0.9-integration-security.test.mjs, unrunnable as authored)
 * against the REAL gateway implementation:
 *   apps/mcp-server/src/mcp-gateway.ts
 *
 * It imports and exercises the actual gateway end-to-end:
 * real authentication, real RBAC, real workspace isolation, real
 * tool execution, real audit, real response validation.
 *
 * Security invariants verified:
 * - Strict fail-closed model preserved.
 * - Unknown principals never receive implicit access.
 * - No permissive fallback membership.
 * - Workspace isolation is not bypassed.
 * - Both authorized and unauthorized execution paths are tested.
 *
 * Failures are counted and returned to tests/test-runner.mjs, which
 * exits non-zero when any test fails. Standalone runs exit non-zero.
 */

import assert from "node:assert/strict";

let gateway = null;
let gatewayImportError = null;

try {
  gateway = await import("../apps/mcp-server/src/mcp-gateway.ts");
} catch (error) {
  gatewayImportError = error;
}

const W_DEV = "w_dev";
const W_OTHER = "w_other";

function makeContext(callerId, workspaceId) {
  return {
    caller_id: callerId,
    workspace_id: workspaceId,
    request_id: "req_integration_1",
    timestamp: new Date().toISOString(),
  };
}

function makeRequest(tool, params, context) {
  return { tool, params, context: context || makeContext("admin_123", W_DEV) };
}

const auditLines = [];
const originalConsoleLog = console.log;

function withAuditCapture(fn) {
  auditLines.length = 0;
  console.log = (...args) => {
    auditLines.push(args.map(String).join(" "));
  };
  try {
    return fn();
  } finally {
    console.log = originalConsoleLog;
  }
}

const allResponses = [];

function track(response) {
  allResponses.push(response);
  return response;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// 0. The real gateway implementation loads and exports its full surface.
// ---------------------------------------------------------------------------
test("real gateway implementation loads and exports its full surface", () => {
  assert.ok(!gatewayImportError, "gateway import failed: " + (gatewayImportError && gatewayImportError.message ? gatewayImportError.message : String(gatewayImportError)));
  const expected = [
    "authenticate",
    "authorize",
    "validateWorkspaceIsolation",
    "validateRequest",
    "validateResponse",
    "executeTool",
    "auditOperation",
    "handleRequest",
    "isWriteOperation",
    "generateRequestId",
    "generateId",
    "GatewayError",
  ];
  for (const name of expected) {
    assert.equal(typeof gateway[name], "function", "gateway export missing: " + name);
  }
});

// ---------------------------------------------------------------------------
// 1. Authorized execution path (read) through the full pipeline.
// ---------------------------------------------------------------------------
test("authorized principal executes a read tool end-to-end", () => {
  const response = track(gateway.handleRequest(makeRequest("radar.search", { workspace_id: W_DEV, query: "release radar" })));
  assert.equal(response.success, true);
  assert.equal(response.error, undefined);
  assert.deepEqual(response.data, { results: [], total: 0 });
  assert.equal(typeof response.metadata.request_id, "string");
  assert.ok(response.metadata.request_id.length > 0);
  assert.equal(typeof response.metadata.timestamp, "string");
  assert.equal(typeof response.metadata.execution_time_ms, "number");
});

// ---------------------------------------------------------------------------
// 2. Authorized execution path (write) + audit event generation.
// ---------------------------------------------------------------------------
test("authorized principal executes a write tool and a SUCCESS audit event is generated", () => {
  const captured = withAuditCapture(() =>
    gateway.handleRequest(makeRequest("radar.remember", { workspace_id: W_DEV, content: "M1a integration test memory" })),
  );
  const response = track(captured);
  assert.equal(response.success, true);
  assert.ok(response.data.memory_id, "expected memory_id in write response");
  assert.equal(typeof response.data.recorded_at, "string");
  const auditLine = auditLines.find((line) => line.includes("[AUDIT]"));
  assert.ok(auditLine, "expected an [AUDIT] line for a successful write");
  assert.ok(auditLine.includes("tool_execution"), "audit line should record tool_execution, got: " + auditLine);
  assert.ok(auditLine.includes("admin_123@w_dev"), "audit line should record caller@workspace, got: " + auditLine);
  assert.ok(auditLine.includes("radar.remember"), "audit line should record the tool, got: " + auditLine);
  assert.ok(auditLine.includes("SUCCESS"), "audit line should record SUCCESS, got: " + auditLine);
});

// ---------------------------------------------------------------------------
// 3. Role enforcement: viewer may read.
// ---------------------------------------------------------------------------
test("viewer role may execute read tools", () => {
  const response = track(gateway.handleRequest(makeRequest("radar.search", { workspace_id: W_DEV, query: "anything" }, makeContext("viewer_000", W_DEV))));
  assert.equal(response.success, true);
});

// ---------------------------------------------------------------------------
// 4. Role enforcement: viewer is denied writes + failure audit event.
// ---------------------------------------------------------------------------
test("viewer role is denied write tools and a FAILED audit event is generated", () => {
  const captured = withAuditCapture(() =>
    gateway.handleRequest(makeRequest("radar.remember", { workspace_id: W_DEV, content: "should be denied" }, makeContext("viewer_000", W_DEV))),
  );
  const response = track(captured);
  assert.equal(response.success, false);
  assert.equal(response.error.code, "FORBIDDEN");
  assert.equal(response.error.status, 403);
  const auditLine = auditLines.find((line) => line.includes("[AUDIT]"));
  assert.ok(auditLine, "expected an [AUDIT] line for a denied write");
  assert.ok(auditLine.includes("authorization_check"), "audit line should record authorization_check, got: " + auditLine);
  assert.ok(auditLine.includes("FAILED(FORBIDDEN)"), "audit line should record FAILED(FORBIDDEN), got: " + auditLine);
});

// ---------------------------------------------------------------------------
// 5. Role hierarchy per tool: contributor may remember, may not decide.
// ---------------------------------------------------------------------------
test("role hierarchy is enforced per tool (contributor: memory yes, decision no)", () => {
  const allowed = track(gateway.handleRequest(makeRequest("radar.remember", { workspace_id: W_DEV, content: "contributor memory" }, makeContext("contributor_789", W_DEV))));
  assert.equal(allowed.success, true);

  const denied = track(gateway.handleRequest(makeRequest("radar.record_decision", { workspace_id: W_DEV, decision: "ship it", rationale: "verified" }, makeContext("contributor_789", W_DEV))));
  assert.equal(denied.success, false);
  assert.equal(denied.error.code, "FORBIDDEN");
  assert.equal(denied.error.status, 403);
});

// ---------------------------------------------------------------------------
// 6. Unknown principal rejection — no implicit access, read or write.
// ---------------------------------------------------------------------------
test("unknown principal is rejected without implicit access (read and write)", () => {
  const cases = [
    ["radar.search", { workspace_id: W_DEV, query: "x" }],
    ["radar.remember", { workspace_id: W_DEV, content: "x" }],
  ];
  for (const [tool, params] of cases) {
    const response = track(gateway.handleRequest(makeRequest(tool, params, makeContext("attacker_999", W_DEV))));
    assert.equal(response.success, false);
    assert.equal(response.error.code, "UNAUTHENTICATED");
    assert.equal(response.error.status, 401);
  }
});

// ---------------------------------------------------------------------------
// 7. Workspace mismatch between context and params is rejected.
// ---------------------------------------------------------------------------
test("workspace mismatch between context and params is rejected (isolation not bypassed)", () => {
  const response = track(gateway.handleRequest(makeRequest("radar.search", { workspace_id: W_OTHER, query: "x" }, makeContext("admin_123", W_DEV))));
  assert.equal(response.success, false);
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(response.error.status, 400);
  assert.ok(response.error.message.includes("Workspace mismatch"), "expected mismatch message, got: " + response.error.message);
});

// ---------------------------------------------------------------------------
// 8. Membership fails closed: known principal, non-member workspace.
// ---------------------------------------------------------------------------
test("membership fails closed: a known principal requesting a workspace it does not belong to is rejected", () => {
  const response = track(gateway.handleRequest(makeRequest("radar.search", { workspace_id: W_OTHER, query: "x" }, makeContext("admin_123", W_OTHER))));
  assert.equal(response.success, false);
  assert.equal(response.error.code, "WORKSPACE_FORBIDDEN");
  assert.equal(response.error.status, 403);
});

// ---------------------------------------------------------------------------
// 9. Invalid tool rejection.
// ---------------------------------------------------------------------------
test("unknown tool is rejected", () => {
  const response = track(gateway.handleRequest(makeRequest("radar.definitely_not_a_tool", { workspace_id: W_DEV })));
  assert.equal(response.success, false);
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(response.error.status, 400);
  assert.ok(response.error.message.includes("Unknown tool"), "expected unknown-tool message, got: " + response.error.message);
});

// ---------------------------------------------------------------------------
// 10. Missing required request fields are rejected.
// ---------------------------------------------------------------------------
test("missing required request fields are rejected", () => {
  const response = track(gateway.handleRequest(makeRequest("radar.search", { workspace_id: W_DEV }, makeContext("admin_123", W_DEV))));
  assert.equal(response.success, false);
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(response.error.status, 400);
  assert.ok(response.error.message.includes("Missing required field: query"), "expected missing-field message, got: " + response.error.message);
});

// ---------------------------------------------------------------------------
// 11. Missing caller context is rejected at validation.
// ---------------------------------------------------------------------------
test("requests without caller context are rejected at validation", () => {
  const response = track(gateway.handleRequest({ tool: "radar.search", params: { workspace_id: W_DEV, query: "x" } }));
  assert.equal(response.success, false);
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(response.error.status, 400);
});

// ---------------------------------------------------------------------------
// 12. Plan-only agent routing tools work through the real pipeline and
//     remain plan-only (no execution, no side effects).
// ---------------------------------------------------------------------------
test("plan-only agent routing tools work through the real pipeline and stay plan-only", () => {
  const listResponse = track(gateway.handleRequest(makeRequest("radar.list_agents", { workspace_id: W_DEV })));
  assert.equal(listResponse.success, true);
  assert.ok(Array.isArray(listResponse.data.agents) && listResponse.data.agents.length > 0, "expected agent directory");
  assert.equal(listResponse.data.executionMode, "plan_only");
  assert.equal(listResponse.data.workspace_id, W_DEV);

  const planResponse = track(gateway.handleRequest(makeRequest("radar.plan_task", { workspace_id: W_DEV, goal: "Plan a RADAR social intelligence audit of the account." })));
  assert.equal(planResponse.success, true);
  assert.equal(planResponse.data.workspace_id, W_DEV);
  assert.equal(planResponse.data.execution.started, false, "plan-only routing must not start execution");
  assert.equal(planResponse.data.execution.providerConfigured, false, "no provider is configured yet");
});

// ---------------------------------------------------------------------------
// 13. Write-operation classification is registry-driven.
// ---------------------------------------------------------------------------
test("write-operation classification is registry-driven", () => {
  assert.equal(gateway.isWriteOperation("radar.remember"), true);
  assert.equal(gateway.isWriteOperation("radar.record_decision"), true);
  assert.equal(gateway.isWriteOperation("radar.search"), false);
  assert.equal(gateway.isWriteOperation("radar.nonexistent"), false);
});

// ---------------------------------------------------------------------------
// 14. Defensive error handling: every response is structurally valid and
//     error messages never leak internals (paths, stacks, raw exceptions).
// ---------------------------------------------------------------------------
test("defensive response handling: all responses structurally valid, no internal leakage", () => {
  assert.ok(allResponses.length >= 12, "expected earlier tests to have produced responses");
  for (const response of allResponses) {
    assert.equal(typeof response.success, "boolean");
    assert.ok(response.metadata, "response must carry metadata");
    assert.equal(typeof response.metadata.request_id, "string");
    assert.equal(typeof response.metadata.timestamp, "string");
    assert.equal(typeof response.metadata.execution_time_ms, "number");
    if (!response.success) {
      assert.ok(response.error, "failed responses must carry an error object");
      assert.equal(typeof response.error.code, "string");
      assert.equal(typeof response.error.message, "string");
      assert.equal(typeof response.error.status, "number");
      const leak = /\/home\/|node:internal|\.ts:\d+|\.cjs:\d+|\s at\s/;
      assert.ok(!leak.test(response.error.message), "possible internal leak in error message: " + response.error.message);
    }
  }
});

// ---------------------------------------------------------------------------
// Harness (M1a): failures propagate to the exit code.
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
  console.log("\nGateway integration security tests: " + passed + " passed, " + failed + " failed");
  return { failed, passed };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const { failed } = runAllTests();
  process.exit(failed > 0 ? 1 : 0);
}
