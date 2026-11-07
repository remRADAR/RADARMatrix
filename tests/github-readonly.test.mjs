/**
 * RADARMatrix GitHub Read-Only Runtime Adapter Tests (M3)
 *
 * Verifies the owner-approved M3 runtime execution surface:
 *   apps/mcp-server/src/runtime/github-readonly.ts
 *
 * Security invariants verified (fail closed, all deterministic —
 * no network, no sleeps; the transport is an injected stub and the
 * clock is an injected constant):
 * - Allowlist only: unknown / arbitrary / write-sounding commands
 *   are denied; the caller can never inject a URL.
 * - Read-only only: the adapter issues GETs exclusively.
 * - Delegated authority is mandatory on EVERY execution: missing,
 *   mismatched, expired, over-limit or out-of-scope grants deny.
 * - A successful execution consumes one grant use; the use limit is
 *   enforced on the next attempt.
 * - Approval-gated operations (synthetic registry entry) demand a
 *   verified single-use approval token; replay is denied; no
 *   verifier configured => denied.
 * - No token configured => adapter status "unavailable" and every
 *   execution denied/unavailable. Nothing is simulated.
 * - HTTP 401/403/404/422 deny; 5xx and transport failures report
 *   "unavailable"; timeouts report "unavailable" (never "executed").
 * - Credentials never leak into results; response bodies are capped.
 *
 * Failures are counted and returned to tests/test-runner.mjs, which
 * exits non-zero when any test fails. Standalone runs exit non-zero.
 */

import assert from "node:assert/strict";

import {
  createGitHubReadOnlyAdapter,
  GITHUB_READONLY_OPERATIONS,
} from "../apps/mcp-server/src/runtime/github-readonly.ts";
import {
  createDelegatedGrant,
  reserveGrantUse,
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
import { setMembershipState, TEST_REGISTRY } from "./server-authority.helper.mjs";

const W = "w_prod";
const AGENT = "agent_github_reader_1";
const ACTOR = "user_editor";
const NOW = 1_000_000;
const TOKEN = "gh_test_token_123";
const SECRET = "m3-github-readonly-test-integrity-secret-0123456789";
const INTEGRITY = createGrantIntegrityService(SECRET);
assert.ok(INTEGRITY, "the test server integrity service must construct");

// Runtime operation names are granted only through the server-bound
// test registry and verified membership; no caller-supplied registry,
// role, or actor-tools field is used.
const RUNTIME_TOOLS = Object.keys(GITHUB_READONLY_OPERATIONS);

function trustedActor() {
  setMembershipState({ actor: ACTOR, workspace: W, role: "editor" });
  const actor = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
  if (!actor) throw new Error("trusted test actor could not be minted");
  return actor;
}

function baseGrantInput(overrides) {
  return Object.assign(
    {
      grant_id: "grant_m3_1",
      agent_id: AGENT,
      allowed_tools: RUNTIME_TOOLS,
      allowed_actions: ["read"],
      ttl_seconds: 600,
      max_uses: 0,
      actor: trustedActor(),
    },
    overrides || {},
  );
}

function createM3Grant(overrides, issuedAt) {
  const grant = createDelegatedGrant(
    baseGrantInput(overrides),
    issuedAt === undefined ? NOW : issuedAt,
    INTEGRITY,
  );
  if (!grant) throw new Error("server-bound test authority rejected the M3 grant fixture");
  return grant;
}

function authorityFor(overrides) {
  return Object.assign(
    {
      agent_id: AGENT,
      workspace_id: W,
      grant: createM3Grant(),
    },
    overrides || {},
  );
}

/** Deterministic transport stub: records calls, returns scripted responses. */
function stubTransport(script) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (typeof script === "function") return script(url, init, calls.length);
    return script;
  };
  return { impl, calls };
}

function jsonResponse(status, body) {
  return {
    status,
    text: async () => body,
  };
}

function okConfig(overrides) {
  const transport = stubTransport(
    jsonResponse(200, JSON.stringify({ ok: true, content: "hello" })),
  );
  const config = Object.assign(
    {
      token: TOKEN,
      baseUrl: "https://api.github.com",
      fetchImpl: transport.impl,
      now: NOW,
      grantIntegrity: INTEGRITY,
    },
    overrides || {},
  );
  return { config, transport };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("all M3 operations are present in the server-bound test registry as read-only viewer tools", () => {
  for (const operation of RUNTIME_TOOLS) {
    assert.equal(TEST_REGISTRY[operation]?.required_role, "viewer", operation + " role");
    assert.equal(TEST_REGISTRY[operation]?.is_write_operation, false, operation + " must stay read-only");
  }
});

// ---------------------------------------------------------------------------
// Configuration gate & honest status.
// ---------------------------------------------------------------------------
test("adapter without a token reports unavailable and denies execution", async () => {
  const { config } = okConfig({ token: undefined });
  const adapter = createGitHubReadOnlyAdapter(config);
  assert.equal(adapter.status, "unavailable");
  assert.equal(adapter.describe().status, "unavailable");
  const r = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "remRADAR", repo: "RADARMatrix" },
    authority: authorityFor(),
  });
  assert.equal(r.status, "unavailable");
  assert.equal(r.notes, "no_token_configured");
  assert.equal(r.stdout, "");
});

test("adapter without a transport reports unavailable (fetch-less environment simulated)", async () => {
  // The adapter falls back to the GLOBAL fetch; Node >= 18 always
  // provides it, so this test simulates a fetch-less environment by
  // temporarily removing globalThis.fetch (restored in finally).
  const realFetch = globalThis.fetch;
  globalThis.fetch = undefined;
  try {
    const { config } = okConfig({ fetchImpl: undefined });
    const adapter = createGitHubReadOnlyAdapter(config);
    assert.equal(adapter.status, "unavailable");
    const r = await adapter.execute({
      command: "github.read.branches",
      args: { owner: "remRADAR", repo: "RADARMatrix" },
      authority: authorityFor(),
    });
    assert.equal(r.status, "unavailable");
    assert.equal(r.notes, "no_transport_available");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("missing HMAC integrity service denies before any GitHub request", async () => {
  const { config, transport } = okConfig({ grantIntegrity: null });
  const adapter = createGitHubReadOnlyAdapter(config);
  const r = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "remRADAR", repo: "RADARMatrix" },
    authority: authorityFor(),
  });
  assert.equal(r.status, "denied");
  assert.equal(r.notes, "grant_integrity_unavailable");
  assert.equal(transport.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Allowlist enforcement.
// ---------------------------------------------------------------------------
test("unknown operation is denied (operation_not_in_allowlist)", async () => {
  const { config } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  const r = await adapter.execute({
    command: "github.write.file",
    args: { owner: "o", repo: "r", path: "p" },
    authority: authorityFor(),
  });
  assert.equal(r.status, "denied");
  assert.equal(r.notes, "operation_not_in_allowlist");
});

test("command-string injection attempts are denied (no shell, no URL control)", async () => {
  const { config } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  for (const bad of [
    "github.read.file && rm -rf /",
    "github.read.file?access_token=x",
    "../../etc/passwd",
    "github.read.file extra",
  ]) {
    const r = await adapter.execute({
      command: bad,
      args: { owner: "o", repo: "r", path: "p" },
      authority: authorityFor(),
    });
    assert.equal(r.status, "denied");
    assert.equal(r.notes, "operation_not_in_allowlist");
  }
  // An empty/missing command is its own fail-closed case.
  const empty = await adapter.execute({
    command: "",
    args: { owner: "o", repo: "r", path: "p" },
    authority: authorityFor(),
  });
  assert.equal(empty.status, "denied");
  assert.equal(empty.notes, "missing_command");
});

test("the adapter only ever issues GET requests", async () => {
  const { config, transport } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  await adapter.execute({
    command: "github.read.file",
    args: { owner: "remRADAR", repo: "RADARMatrix", path: "package.json" },
    authority: authorityFor(),
  });
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].init.method, "GET");
});

// ---------------------------------------------------------------------------
// Argument validation.
// ---------------------------------------------------------------------------
test("missing required arguments deny; empty/whitespace arguments deny", async () => {
  const { config } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  const noArgs = await adapter.execute({
    command: "github.read.file",
    authority: authorityFor(),
  });
  assert.equal(noArgs.notes, "missing_or_invalid_argument");
  const blank = await adapter.execute({
    command: "github.read.file",
    args: { owner: "o", repo: "r", path: "   " },
    authority: authorityFor(),
  });
  assert.equal(blank.notes, "missing_or_invalid_argument");
});

test("unknown arguments deny (strict argument contract)", async () => {
  const { config } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  const r = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "o", repo: "r", sneaky: "x" },
    authority: authorityFor(),
  });
  assert.equal(r.notes, "unknown_argument");
});

test("the adapter builds and encodes the URL itself (path traversal encoded away)", async () => {
  const { config, transport } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  await adapter.execute({
    command: "github.read.file",
    args: { owner: "rem RADAR", repo: "RADARMatrix", path: "docs/a b.md" },
    authority: authorityFor(),
  });
  assert.equal(
    transport.calls[0].url,
    "https://api.github.com/repos/rem%20RADAR/RADARMatrix/contents/docs/a%20b.md",
  );
});

// ---------------------------------------------------------------------------
// Delegated authority enforcement (mandatory on every execution).
// ---------------------------------------------------------------------------
test("missing authority denies; malformed authority denies", async () => {
  const { config } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  const none = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "o", repo: "r" },
  });
  assert.equal(none.notes, "missing_authority");
  const malformed = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "o", repo: "r" },
    authority: { agent_id: "", workspace_id: W, grant: {} },
  });
  assert.equal(malformed.notes, "missing_authority");
});

test("agent mismatch and workspace mismatch deny", async () => {
  const { config } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  const agentMismatch = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "o", repo: "r" },
    authority: authorityFor({ agent_id: "someone_else" }),
  });
  assert.equal(agentMismatch.notes, "authority_denied");
  assert.equal(agentMismatch.stderr, "agent_mismatch");
  const wsMismatch = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "o", repo: "r" },
    authority: authorityFor({ workspace_id: "w_other" }),
  });
  assert.equal(wsMismatch.notes, "authority_denied");
  assert.equal(wsMismatch.stderr, "workspace_mismatch");
});

test("a grant that does not include the operation denies (scope not inherited)", async () => {
  const { config } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  const r = await adapter.execute({
    command: "github.read.commit",
    args: { owner: "o", repo: "r", sha: "abc123" },
    authority: authorityFor({
      grant: createM3Grant({ allowed_tools: ["github.read.file"] }),
    }),
  });
  assert.equal(r.notes, "authority_denied");
  assert.equal(r.stderr, "tool_not_allowed");
});

test("expired grant denies; use limit denies", async () => {
  // Adapter clock beyond the grant's expiry: the grant is expired.
  const expiredAdapter = createGitHubReadOnlyAdapter(okConfig({ now: NOW + 10_000 }).config);
  const expired = await expiredAdapter.execute({
    command: "github.read.branches",
    args: { owner: "o", repo: "r" },
    authority: authorityFor(),
  });
  assert.equal(expired.status, "denied");
  assert.equal(expired.stderr, "grant_expired");
  // A SECOND adapter at an in-window clock for the use-limit case.
  const limitedAdapter = createGitHubReadOnlyAdapter(okConfig().config);
  const exhausted = createM3Grant({ max_uses: 1 });
  // Atomically reserve the single allowed use, then attempt another.
  assert.ok(
    reserveGrantUse(exhausted, INTEGRITY, NOW).reserved,
  );
  const limitedResult = await limitedAdapter.execute({
    command: "github.read.branches",
    args: { owner: "o", repo: "r" },
    authority: authorityFor({ grant: exhausted }),
  });
  assert.equal(limitedResult.status, "denied");
  assert.equal(limitedResult.stderr, "use_limit_reached");
});

test("a valid execution consumes one grant use (max_uses=1: first ok, second denied)", async () => {
  const { config } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  const grant = createM3Grant({ max_uses: 1 });
  const authority = authorityFor({ grant });
  const first = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "o", repo: "r" },
    authority,
  });
  assert.equal(first.status, "executed");
  assert.equal(first.exitCode, 200);
  const second = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "o", repo: "r" },
    authority,
  });
  assert.equal(second.status, "denied");
  assert.equal(second.stderr, "use_limit_reached");
});

test("concurrent M3 executions reserve capacity before dispatch (one use means one request)", async () => {
  const { config, transport } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  const authority = authorityFor({ grant: createM3Grant({ max_uses: 1 }) });
  const request = {
    command: "github.read.branches",
    args: { owner: "remRADAR", repo: "RADARMatrix" },
    authority,
  };
  const results = await Promise.all([adapter.execute(request), adapter.execute(request)]);
  assert.equal(transport.calls.length, 1, "exactly one execution may reach the transport");
  assert.deepEqual(results.map((result) => result.status).sort(), ["denied", "executed"]);
  assert.equal(authority.grant.uses, 1, "the winning reservation is consumed once");
});

test("successful execution returns the body; credentials never leak into results", async () => {
  const { config, transport } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  const r = await adapter.execute({
    command: "github.read.file",
    args: { owner: "remRADAR", repo: "RADARMatrix", path: "package.json", ref: "main" },
    authority: authorityFor(),
  });
  assert.equal(r.status, "executed");
  assert.ok(r.stdout.includes("hello"));
  // Token in headers, never in any result field.
  assert.equal(transport.calls[0].init.headers.Authorization, "Bearer " + TOKEN);
  assert.ok(!r.stdout.includes(TOKEN));
  assert.ok(!r.stderr.includes(TOKEN));
  assert.ok(!(r.notes || "").includes(TOKEN));
});

// ---------------------------------------------------------------------------
// HTTP result mapping (never "executed" outside 2xx).
// ---------------------------------------------------------------------------
test("HTTP 401/403 deny; 404/422 deny; 5xx reports unavailable", async () => {
  for (const [status, expected, note] of [
    [401, "denied", "http_401"],
    [403, "denied", "http_403"],
    [404, "denied", "http_404"],
    [422, "denied", "http_422"],
    [500, "unavailable", "http_500"],
    [503, "unavailable", "http_503"],
  ]) {
    const { config } = okConfig({
      fetchImpl: stubTransport(jsonResponse(status, "boom")).impl,
    });
    const adapter = createGitHubReadOnlyAdapter(config);
    const r = await adapter.execute({
      command: "github.read.branches",
      args: { owner: "o", repo: "r" },
      authority: authorityFor(),
    });
    assert.equal(r.status, expected);
    assert.equal(r.notes, note);
  }
});

test("transport failure and timeout report unavailable (never executed)", async () => {
  const failing = stubTransport(async () => {
    throw new Error("ECONNRESET");
  });
  const { config } = okConfig({ fetchImpl: failing.impl });
  const adapter = createGitHubReadOnlyAdapter(config);
  const r = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "o", repo: "r" },
    authority: authorityFor(),
  });
  assert.equal(r.status, "unavailable");
  assert.equal(r.notes, "transport_failure");

  const aborting = stubTransport(async (_url, init) => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    if (init && init.signal && init.signal.addEventListener) {
      init.signal.addEventListener("abort", () => {}, { once: true });
    }
    throw err;
  });
  const { config: cfg2 } = okConfig({ fetchImpl: aborting.impl });
  const adapter2 = createGitHubReadOnlyAdapter(cfg2);
  const r2 = await adapter2.execute({
    command: "github.read.branches",
    args: { owner: "o", repo: "r" },
    authority: authorityFor(),
  });
  assert.equal(r2.status, "unavailable");
  assert.equal(r2.notes, "timeout");
});

test("oversized responses are truncated with an honest note", async () => {
  const big = "x".repeat(4096);
  const { config } = okConfig({
    maxResponseBytes: 1024,
    fetchImpl: stubTransport(jsonResponse(200, big)).impl,
  });
  const adapter = createGitHubReadOnlyAdapter(config);
  const r = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "o", repo: "r" },
    authority: authorityFor(),
  });
  assert.equal(r.status, "executed");
  assert.equal(Buffer.byteLength(r.stdout, "utf8"), 1024);
  assert.equal(r.notes, "response_truncated");
});

// ---------------------------------------------------------------------------
// Approval-gated operations (synthetic registry entry — proves the
// approval-token model is consumed by the adapter).
// ---------------------------------------------------------------------------
const APPROVAL_OPS = {
  "github.read.sensitive": {
    name: "github.read.sensitive",
    description: "Synthetic approval-gated read (tests only)",
    method: "GET",
    pathTemplate: "/repos/{owner}/{repo}/secrets",
    requiredParams: ["owner", "repo"],
    requiresApproval: true,
  },
};

const keys = generateEd25519KeyPair();

function approvalAdapter(redemption) {
  const { config, transport } = okConfig({
    operations: Object.assign({}, GITHUB_READONLY_OPERATIONS, APPROVAL_OPS),
    approvalVerifier: (token, check, now) =>
      verifyApproval(token, keys.publicKeyPem, check, redemption, now),
  });
  return { adapter: createGitHubReadOnlyAdapter(config), transport };
}

function sensitiveAuthority() {
  return authorityFor({
    grant: createM3Grant({ allowed_tools: ["github.read.sensitive"] }),
  });
}

test("approval-gated operation with no verifier configured denies", async () => {
  const { config } = okConfig({ operations: Object.assign({}, GITHUB_READONLY_OPERATIONS, APPROVAL_OPS) });
  const adapter = createGitHubReadOnlyAdapter(config);
  const r = await adapter.execute({
    command: "github.read.sensitive",
    args: { owner: "o", repo: "r" },
    authority: sensitiveAuthority(),
    approvalToken: "whatever",
  });
  assert.equal(r.notes, "approval_verifier_unavailable");
});

test("approval-gated operation without a token denies (approval_required)", async () => {
  const { adapter } = approvalAdapter(createRedemptionRecord());
  const r = await adapter.execute({
    command: "github.read.sensitive",
    args: { owner: "o", repo: "r" },
    authority: sensitiveAuthority(),
  });
  assert.equal(r.notes, "approval_required");
});

test("valid single-use approval executes exactly once; replay denies", async () => {
  const redemption = createRedemptionRecord();
  const { adapter, transport } = approvalAdapter(redemption);
  const authority = sensitiveAuthority();
  const resourcePath = "/repos/o/r/secrets";
  const issued = issueApproval(
    {
      action: "github.read.sensitive",
      resource_ids: [resourcePath],
      workspace_id: W,
      actor_id: ACTOR,
      grant_id: authority.grant.grant_id,
      ttl_seconds: 300,
      now: NOW,
    },
    keys.privateKeyPem,
  );
  assert.ok(issued, "approval must issue");
  const first = await adapter.execute({
    command: "github.read.sensitive",
    args: { owner: "o", repo: "r" },
    authority,
    approvalToken: issued.token,
  });
  assert.equal(first.status, "executed");
  assert.equal(transport.calls.length, 1);
  const replay = await adapter.execute({
    command: "github.read.sensitive",
    args: { owner: "o", repo: "r" },
    authority,
    approvalToken: issued.token,
  });
  assert.equal(replay.status, "denied");
  assert.equal(replay.notes, "replayed");
  assert.equal(replay.stderr, "");
  assert.equal(transport.calls.length, 1, "approval replay must not reach the transport");
});

test("approval minted for a DIFFERENT actor is denied (approvals are actor-bound)", async () => {
  const redemption = createRedemptionRecord();
  const { adapter, transport } = approvalAdapter(redemption);
  const authority = sensitiveAuthority();
  const issued = issueApproval(
    {
      action: "github.read.sensitive",
      resource_ids: ["/repos/o/r/secrets"],
      workspace_id: W,
      actor_id: "someone_else",
      ttl_seconds: 300,
      now: NOW,
    },
    keys.privateKeyPem,
  );
  const r = await adapter.execute({
    command: "github.read.sensitive",
    args: { owner: "o", repo: "r" },
    authority,
    approvalToken: issued.token,
  });
  assert.equal(r.status, "denied");
  assert.equal(r.notes, "actor_mismatch");
  assert.equal(r.stderr, "");
  assert.equal(authority.grant.uses, 1, "a failed approval follows the no-refund reservation policy");
  assert.equal(transport.calls.length, 0, "approval denial must happen before dispatch");
});

test("wrong-scope approval denies after reservation; the operation is not dispatched", async () => {
  const redemption = createRedemptionRecord();
  const { adapter, transport } = approvalAdapter(redemption);
  const authority = sensitiveAuthority();
  const issued = issueApproval(
    {
      action: "github.read.sensitive",
      resource_ids: ["/repos/other/repo/secrets"],
      workspace_id: W,
      actor_id: ACTOR,
      ttl_seconds: 300,
      now: NOW,
    },
    keys.privateKeyPem,
  );
  const r = await adapter.execute({
    command: "github.read.sensitive",
    args: { owner: "o", repo: "r" },
    authority,
    approvalToken: issued.token,
  });
  assert.equal(r.status, "denied");
  assert.equal(r.notes, "resource_mismatch");
  assert.equal(r.stderr, "");
  assert.equal(authority.grant.uses, 1, "a failed approval follows the no-refund reservation policy");
  assert.equal(transport.calls.length, 0, "approval denial must happen before dispatch");
});

// ---------------------------------------------------------------------------
// describe(): honest capability reporting.
// ---------------------------------------------------------------------------
test("describe() lists the exact allowlisted capabilities", () => {
  const { config } = okConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  const d = adapter.describe();
  assert.equal(d.id, "github-readonly");
  assert.equal(d.status, "connected");
  assert.deepEqual(d.capabilities, Object.keys(GITHUB_READONLY_OPERATIONS).sort());
});

// ---------------------------------------------------------------------------
// Harness (M1a/M2/M3 convention): failures propagate to the exit code.
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
  console.log("\nGitHub read-only runtime adapter tests: " + passed + " passed, " + failed + " failed");
  return { failed, passed };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const { failed } = await runAllTests();
  process.exit(failed > 0 ? 1 : 0);
}
