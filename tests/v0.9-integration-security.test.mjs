/**
 * RADARMatrix v0.9 Integration & Security Tests
 *
 * Purpose:
 * - Verify authentication boundary
 * - Verify workspace isolation
 * - Verify role enforcement
 * - Verify consequential write protection
 * - Verify malformed-request rejection
 *
 * These tests intentionally exercise the security boundary rather
 * than individual implementation details.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DevelopmentAuthenticationProvider,
} from "../apps/mcp-server/src/providers/authentication.js";

import {
  DevelopmentAuthorizationProvider,
} from "../apps/mcp-server/src/providers/authorization.js";

import {
  DevelopmentMembershipProvider,
} from "../apps/mcp-server/src/providers/membership.js";

const WORKSPACE_A = "workspace_a";
const WORKSPACE_B = "workspace_b";

function request({
  caller_id = "viewer_000",
  workspace_id = WORKSPACE_A,
  tool = "radar.get_context",
  arguments: toolArguments = {},
} = {}) {
  return {
    context: {
      caller_id,
      workspace_id,
      request_id: "test_request_001",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    tool,
    arguments: toolArguments,
  };
}

const authentication = new DevelopmentAuthenticationProvider();

const membership = new DevelopmentMembershipProvider();

const authorization = new DevelopmentAuthorizationProvider();

test("authentication accepts a known development principal", () => {
  const result = authentication.authenticate(
    request({
      caller_id: "viewer_000",
    }),
  );

  assert.ok(result);
  assert.equal(result.caller_id, "viewer_000");
  assert.equal(result.workspace_id, WORKSPACE_A);
});

test("authentication rejects an unknown caller", () => {
  const result = authentication.authenticate(
    request({
      caller_id: "unknown_caller",
    }),
  );

  assert.equal(result, null);
});

test("authentication rejects a missing caller", () => {
  const result = authentication.authenticate({
    context: {
      workspace_id: WORKSPACE_A,
    },
    tool: "radar.get_context",
    arguments: {},
  });

  assert.equal(result, null);
});

test("authentication rejects a missing workspace", () => {
  const result = authentication.authenticate({
    context: {
      caller_id: "viewer_000",
    },
    tool: "radar.get_context",
    arguments: {},
  });

  assert.equal(result, null);
});

test("authentication rejects malformed requests", () => {
  assert.equal(authentication.authenticate(null), null);
  assert.equal(authentication.authenticate(undefined), null);
  assert.equal(authentication.authenticate("invalid"), null);
});

test("membership does not grant access merely because authentication succeeded", () => {
  const identity = authentication.authenticate(
    request({
      caller_id: "viewer_000",
      workspace_id: WORKSPACE_B,
    }),
  );

  assert.ok(identity);

  const result = membership.isMember(
    identity.caller_id,
    WORKSPACE_B,
  );

  assert.equal(result, false);
});

test("authorized viewer can perform read operations", () => {
  const identity = authentication.authenticate(
    request({
      caller_id: "viewer_000",
      workspace_id: WORKSPACE_A,
      tool: "radar.get_context",
    }),
  );

  assert.ok(identity);

  assert.equal(
    membership.isMember(
      identity.caller_id,
      identity.workspace_id,
    ),
    true,
  );

  assert.equal(
    authorization.isAuthorized(
      identity,
      "radar.get_context",
    ),
    true,
  );
});

test("viewer cannot perform memory writes", () => {
  const identity = authentication.authenticate(
    request({
      caller_id: "viewer_000",
      workspace_id: WORKSPACE_A,
      tool: "radar.remember",
    }),
  );

  assert.ok(identity);

  assert.equal(
    authorization.isAuthorized(
      identity,
      "radar.remember",
    ),
    false,
  );
});

test("contributor can perform memory writes", () => {
  const identity = authentication.authenticate(
    request({
      caller_id: "contributor_789",
      workspace_id: WORKSPACE_A,
      tool: "radar.remember",
    }),
  );

  assert.ok(identity);

  assert.equal(
    authorization.isAuthorized(
      identity,
      "radar.remember",
    ),
    true,
  );
});

test("contributor cannot record editor-level decisions", () => {
  const identity = authentication.authenticate(
    request({
      caller_id: "contributor_789",
      workspace_id: WORKSPACE_A,
      tool: "radar.record_decision",
    }),
  );

  assert.ok(identity);

  assert.equal(
    authorization.isAuthorized(
      identity,
      "radar.record_decision",
    ),
    false,
  );
});

test("editor can record decisions", () => {
  const identity = authentication.authenticate(
    request({
      caller_id: "editor_456",
      workspace_id: WORKSPACE_A,
      tool: "radar.record_decision",
    }),
  );

  assert.ok(identity);

  assert.equal(
    authorization.isAuthorized(
      identity,
      "radar.record_decision",
    ),
    true,
  );
});

test("admin has editor-level access", () => {
  const identity = authentication.authenticate(
    request({
      caller_id: "admin_123",
      workspace_id: WORKSPACE_A,
      tool: "radar.record_decision",
    }),
  );

  assert.ok(identity);

  assert.equal(
    authorization.isAuthorized(
      identity,
      "radar.record_decision",
    ),
    true,
  );
});

test("workspace isolation rejects a caller from another workspace", () => {
  const identity = authentication.authenticate(
    request({
      caller_id: "viewer_000",
      workspace_id: WORKSPACE_B,
    }),
  );

  assert.ok(identity);

  assert.equal(
    membership.isMember(
      identity.caller_id,
      WORKSPACE_B,
    ),
    false,
  );
});

test("authorization rejects an unauthenticated identity", () => {
  assert.equal(
    authorization.isAuthorized(
      null,
      "radar.get_context",
    ),
    false,
  );
});

test("authorization rejects an unknown tool", () => {
  const identity = authentication.authenticate(
    request({
      caller_id: "admin_123",
      workspace_id: WORKSPACE_A,
    }),
  );

  assert.ok(identity);

  assert.equal(
    authorization.isAuthorized(
      identity,
      "radar.this_tool_does_not_exist",
    ),
    false,
  );
});

test("authorization rejects malformed tool names", () => {
  const identity = authentication.authenticate(
    request({
      caller_id: "admin_123",
      workspace_id: WORKSPACE_A,
    }),
  );

  assert.ok(identity);

  assert.equal(
    authorization.isAuthorized(identity, ""),
    false,
  );

  assert.equal(
    authorization.isAuthorized(identity, null),
    false,
  );
});

console.log(
  "RADARMatrix v0.9 integration/security test suite loaded.",
);