/**
 * RADARMatrix GitHub Read-Only Adapter — Phase 4.1 path-boundary tests.
 *
 * Focused adversarial suite for the URL construction boundary:
 *   apps/mcp-server/src/runtime/github-readonly.ts
 *
 * Every case asserts THREE things:
 *   1. the request is denied (never "executed"),
 *   2. the injected transport was NEVER invoked, and
 *   3. no delegated grant use was consumed.
 *
 * Positive cases prove legitimate nested paths, spaces, branch slashes and
 * declared query parameters still work.
 */

import assert from "node:assert/strict";

import {
  createGitHubReadOnlyAdapter,
  GITHUB_READONLY_OPERATIONS,
} from "../apps/mcp-server/src/runtime/github-readonly.ts";
import {
  createDelegatedGrant,
  createGrantIntegrityService,
  createTrustedActorContext,
} from "../apps/mcp-server/src/auth/delegation.ts";
import { setMembershipState } from "./server-authority.helper.mjs";

const W = "w_prod";
const AGENT = "agent_github_reader_1";
const ACTOR = "user_editor";
const NOW = 1_000_000;
const TOKEN = "gh_test_token_123";
const INTEGRITY = createGrantIntegrityService(
  "m3-github-readonly-test-integrity-secret-0123456789",
);
const TOOLS = Object.keys(GITHUB_READONLY_OPERATIONS);

function grant(overrides) {
  setMembershipState({ actor: ACTOR, workspace: W, role: "editor" });
  const actor = createTrustedActorContext({ caller_id: ACTOR, workspace_id: W });
  if (!actor) throw new Error("trusted test actor could not be minted");
  const g = createDelegatedGrant(
    Object.assign(
      {
        grant_id: "grant_p41_1",
        agent_id: AGENT,
        allowed_tools: TOOLS,
        allowed_actions: ["read"],
        ttl_seconds: 600,
        max_uses: 0,
        actor,
      },
      overrides || {},
    ),
    NOW,
    INTEGRITY,
  );
  if (!g) throw new Error("server-bound test authority rejected the grant fixture");
  return g;
}

function authority(overrides) {
  return Object.assign(
    { agent_id: AGENT, workspace_id: W, grant: grant() },
    overrides || {},
  );
}

function stubTransport() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { status: 200, text: async () => JSON.stringify({ ok: true }) };
  };
  return { impl, calls };
}

function makeConfig(overrides) {
  const transport = stubTransport();
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

// ---------------------------------------------------------------------------
// A. Path validation — traversal, encoding, separators, controls.
// ---------------------------------------------------------------------------

test("traversal in every encoding is denied before transport and consumes no grant", async () => {
  const badPaths = [
    ".",
    "..",
    "./secret",
    "../secret",
    "a/../secret",
    "a/./secret",
    "%2e",
    "%2e%2e",
    "%2e%2e%2fsecret",
    "%252e%252e",
    "%252e%252e%252fsecret",
    "%25252e%25252e",
    "a\\..\\secret",
    "a?ref=main",
    "a#fragment",
    "%3fref%3dmain",
    "%2523fragment",
    "%00secret",
    "%0d%0aHeader",
    "%",
    "%zz",
    "a//b",
  ];
  for (const path of badPaths) {
    const { config, transport } = makeConfig();
    const adapter = createGitHubReadOnlyAdapter(config);
    const auth = authority();
    const result = await adapter.execute({
      command: "github.read.file",
      args: { owner: "remRADAR", repo: "RADARMatrix", path },
      authority: auth,
    });
    assert.equal(result.status, "denied", `path ${JSON.stringify(path)}`);
    assert.equal(result.notes, "unsafe_path_parameter", `path ${JSON.stringify(path)}`);
    assert.equal(transport.calls.length, 0, `path ${JSON.stringify(path)} reached transport`);
    assert.equal(auth.grant.uses, 0, `path ${JSON.stringify(path)} consumed a grant`);
  }
});

test("owner, repository, branch, commit and pull-number manipulation is denied", async () => {
  const cases = [
    ["github.read.branches", { owner: "..", repo: "RADARMatrix" }],
    ["github.read.branches", { owner: "remRADAR", repo: "%252e%252e" }],
    ["github.read.branches", { owner: "rem%2fRADAR", repo: "RADARMatrix" }],
    ["github.read.branches", { owner: "rem RADAR", repo: "RADARMatrix" }],
    ["github.read.branch", { owner: "remRADAR", repo: "RADARMatrix", branch: "feature/../main" }],
    ["github.read.branch", { owner: "remRADAR", repo: "RADARMatrix", branch: "feature%252f%252e%252e%252fmain" }],
    ["github.read.branch", { owner: "remRADAR", repo: "RADARMatrix", branch: "a?x=1" }],
    ["github.read.commit", { owner: "remRADAR", repo: "RADARMatrix", sha: "abc123/../../x" }],
    ["github.read.commit", { owner: "remRADAR", repo: "RADARMatrix", sha: "?query" }],
    ["github.read.pull_request", { owner: "remRADAR", repo: "RADARMatrix", pull_number: "1%2f.." }],
    ["github.read.pull_request", { owner: "remRADAR", repo: "RADARMatrix", pull_number: "0" }],
  ];
  for (const [command, args] of cases) {
    const { config, transport } = makeConfig();
    const adapter = createGitHubReadOnlyAdapter(config);
    const result = await adapter.execute({ command, args, authority: authority() });
    assert.equal(result.status, "denied", `${command}: ${JSON.stringify(args)}`);
    assert.equal(result.notes, "unsafe_path_parameter", `${command}: ${JSON.stringify(args)}`);
    assert.equal(transport.calls.length, 0, `${command} reached transport`);
  }
});

// ---------------------------------------------------------------------------
// B. Base URL validation and trusted-origin pinning.
// ---------------------------------------------------------------------------

test("invalid base URLs are rejected before transport", async () => {
  const invalidBases = [
    "http://api.github.com",
    "https://user:pass@api.github.com",
    "https://api.github.com?x=1",
    "https://api.github.com#fragment",
    "https://ghe.example.com/api/../v3",
    "https://ghe.example.com/api/%2e%2e/v3",
    "https://ghe.example.com/api/%252e%252e/v3",
    "https://ghe.example.com/api/%zz",
    "https://ghe.example.com/api\\..\\v3",
    "",
  ];
  for (const baseUrl of invalidBases) {
    const { config, transport } = makeConfig({ baseUrl });
    const adapter = createGitHubReadOnlyAdapter(config);
    assert.equal(adapter.status, "unavailable", JSON.stringify(baseUrl));
    const result = await adapter.execute({
      command: "github.read.branches",
      args: { owner: "remRADAR", repo: "RADARMatrix" },
      authority: authority(),
    });
    assert.equal(result.status, "unavailable", JSON.stringify(baseUrl));
    assert.equal(result.notes, "invalid_api_base_url", JSON.stringify(baseUrl));
    assert.equal(transport.calls.length, 0, `${baseUrl} reached transport`);
  }
});

test("an origin outside the explicit allowlist is rejected before transport", async () => {
  const untrusted = [
    "https://attacker.example.com",
    "https://api.github.com.attacker.example.com",
    "https://ghe.example.com",
  ];
  for (const baseUrl of untrusted) {
    const { config, transport } = makeConfig({
      baseUrl,
      trustedOrigins: ["https://api.github.com"],
    });
    const adapter = createGitHubReadOnlyAdapter(config);
    assert.equal(adapter.status, "unavailable", baseUrl);
    const result = await adapter.execute({
      command: "github.read.branches",
      args: { owner: "remRADAR", repo: "RADARMatrix" },
      authority: authority(),
    });
    assert.equal(result.notes, "invalid_api_base_url", baseUrl);
    assert.equal(transport.calls.length, 0, `${baseUrl} reached transport`);
  }
});

// ---------------------------------------------------------------------------
// C. Query parameters — declared surface, no injection, never dropped.
// ---------------------------------------------------------------------------

test("declared query parameters are sent encoded and are never silently dropped", async () => {
  const { config, transport } = makeConfig();
  const adapter = createGitHubReadOnlyAdapter(config);
  const result = await adapter.execute({
    command: "github.read.file",
    args: { owner: "remRADAR", repo: "RADARMatrix", path: "docs/a b.md", ref: "release/v2" },
    authority: authority(),
  });
  assert.equal(result.status, "executed");
  assert.equal(
    transport.calls[0].url,
    "https://api.github.com/repos/remRADAR/RADARMatrix/contents/docs/a%20b.md?ref=release%2Fv2",
  );
});

test("query values cannot inject parameters, fragments or traversal", async () => {
  const badRefs = [
    "main&admin=1",
    "main#fragment",
    "main?x=1",
    "..",
    "../main",
    "%2e%2e",
    "%252e%252e",
    "a\\b",
    "main%00",
    "main\n",
  ];
  for (const ref of badRefs) {
    const { config, transport } = makeConfig();
    const adapter = createGitHubReadOnlyAdapter(config);
    const auth = authority();
    const result = await adapter.execute({
      command: "github.read.file",
      args: { owner: "remRADAR", repo: "RADARMatrix", path: "README.md", ref },
      authority: auth,
    });
    assert.equal(result.status, "denied", `ref ${JSON.stringify(ref)}`);
    assert.equal(result.notes, "unsafe_path_parameter", `ref ${JSON.stringify(ref)}`);
    assert.equal(transport.calls.length, 0, `ref ${JSON.stringify(ref)} reached transport`);
    assert.equal(auth.grant.uses, 0, `ref ${JSON.stringify(ref)} consumed a grant`);
  }
});

// ---------------------------------------------------------------------------
// D. Operation-definition integrity.
// ---------------------------------------------------------------------------

test("operation definitions with unresolved, duplicate or unused slots are rejected", async () => {
  const invalidOps = [
    { name: "github.read.bad", method: "GET", pathTemplate: "/repos/{owner}/{repo}/contents/{path}", requiredParams: ["owner", "repo"], requiresApproval: false },
    { name: "github.read.bad", method: "GET", pathTemplate: "/repos/{owner}/{repo}/contents/{path}/{path}", requiredParams: ["owner", "repo", "path"], multiSegmentParams: ["path"], requiresApproval: false },
    { name: "github.read.bad", method: "GET", pathTemplate: "/repos/{owner}/{repo}/contents/{path}", requiredParams: ["owner", "repo", "path"], optionalParams: ["ref"], multiSegmentParams: ["path"], requiresApproval: false },
    { name: "github.read.bad", method: "GET", pathTemplate: "/repos/{owner}/{repo}/contents/{path}", requiredParams: ["owner", "repo", "path"], multiSegmentParams: ["path"], queryParams: ["path"], requiresApproval: false },
    { name: "github.read.bad", method: "GET", pathTemplate: "/repos/{owner}/{repo}/contents/{path}", requiredParams: ["owner", "repo", "path"], multiSegmentParams: ["path"], queryParams: ["undeclared"], requiresApproval: false },
  ];
  for (const op of invalidOps) {
    const { config, transport } = makeConfig({ operations: { [op.name]: op } });
    const adapter = createGitHubReadOnlyAdapter(config);
    const result = await adapter.execute({
      command: op.name,
      args: { owner: "acme", repo: "widgets", path: "README.md" },
      authority: authority(),
    });
    assert.equal(result.status, "denied", op.pathTemplate);
    assert.equal(result.notes, "invalid_operation_definition", op.pathTemplate);
    assert.equal(transport.calls.length, 0, `${op.pathTemplate} reached transport`);
  }
});

// ---------------------------------------------------------------------------
// E. Positive cases — legitimate requests still work.
// ---------------------------------------------------------------------------

test("legitimate nested paths, spaces and branch slashes are preserved", async () => {
  const cases = [
    ["github.read.file", { owner: "rem-RADAR", repo: "RADARMatrix", path: "docs/a b.md" },
      "https://api.github.com/repos/rem-RADAR/RADARMatrix/contents/docs/a%20b.md"],
    ["github.read.file", { owner: "remRADAR", repo: "RADARMatrix", path: "src/deep/nested/file.ts" },
      "https://api.github.com/repos/remRADAR/RADARMatrix/contents/src/deep/nested/file.ts"],
    ["github.read.branch", { owner: "remRADAR", repo: "RADARMatrix", branch: "release/v2" },
      "https://api.github.com/repos/remRADAR/RADARMatrix/branches/release%2Fv2"],
    ["github.read.branches", { owner: "remRADAR", repo: "RADARMatrix" },
      "https://api.github.com/repos/remRADAR/RADARMatrix/branches"],
    ["github.read.commit", { owner: "remRADAR", repo: "RADARMatrix", sha: "9c25002a15aadbe9cf40688411f7f5a7100a885c" },
      "https://api.github.com/repos/remRADAR/RADARMatrix/commits/9c25002a15aadbe9cf40688411f7f5a7100a885c"],
  ];
  for (const [command, args, expected] of cases) {
    const { config, transport } = makeConfig();
    const adapter = createGitHubReadOnlyAdapter(config);
    const result = await adapter.execute({ command, args, authority: authority() });
    assert.equal(result.status, "executed", `${command}: ${JSON.stringify(args)}`);
    assert.equal(transport.calls[0].url, expected, `${command}: ${JSON.stringify(args)}`);
    assert.equal(transport.calls[0].init.method, "GET");
  }
});

test("a validated GitHub Enterprise origin and /api/v3 prefix are preserved", async () => {
  const { config, transport } = makeConfig({
    baseUrl: "https://ghe.example.com/api/v3/",
    trustedOrigins: ["https://ghe.example.com"],
  });
  const adapter = createGitHubReadOnlyAdapter(config);
  const result = await adapter.execute({
    command: "github.read.branch",
    args: { owner: "acme", repo: "widgets", branch: "release/v2" },
    authority: authority(),
  });
  assert.equal(result.status, "executed");
  assert.equal(
    transport.calls[0].url,
    "https://ghe.example.com/api/v3/repos/acme/widgets/branches/release%2Fv2",
  );
});

// ---------------------------------------------------------------------------
// B2. Phase 4.1.1 — a configured baseUrl is NEVER auto-trusted.
//
// Regression for the MEDIUM finding: the default trusted set must be the
// public API origin ONLY. A custom baseUrl (look-alike domain, attacker host,
// undeclared Enterprise host) must be rejected unless the composing server
// explicitly lists its origin in trustedOrigins.
// ---------------------------------------------------------------------------

test("a look-alike baseUrl is rejected when trustedOrigins is absent", async () => {
  const { config, transport } = makeConfig({ baseUrl: "https://api.github.com.evil.com" });
  assert.equal(config.trustedOrigins, undefined, "fixture must omit trustedOrigins");
  const adapter = createGitHubReadOnlyAdapter(config);
  assert.equal(adapter.status, "unavailable");
  const auth = authority();
  const result = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "remRADAR", repo: "RADARMatrix" },
    authority: auth,
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.notes, "invalid_api_base_url");
  assert.equal(transport.calls.length, 0, "untrusted origin reached transport");
  assert.equal(auth.grant.uses, 0, "untrusted origin consumed a grant use");
});

test("a look-alike baseUrl is rejected when trustedOrigins is an empty array", async () => {
  const { config, transport } = makeConfig({
    baseUrl: "https://api.github.com.evil.com",
    trustedOrigins: [],
  });
  const adapter = createGitHubReadOnlyAdapter(config);
  assert.equal(adapter.status, "unavailable");
  const auth = authority();
  const result = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "remRADAR", repo: "RADARMatrix" },
    authority: auth,
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.notes, "invalid_api_base_url");
  assert.equal(transport.calls.length, 0, "empty allowlist still trusted the baseUrl");
  assert.equal(auth.grant.uses, 0, "empty allowlist consumed a grant use");
});

test("arbitrary default origins are rejected without explicit authorization", async () => {
  const untrusted = [
    "https://attacker.example.com",
    "https://api.github.com.attacker.example.com",
    "https://ghe.example.com",
    "https://ghe.example.com/api/v3",
    "https://github.com",
  ];
  for (const baseUrl of untrusted) {
    const { config, transport } = makeConfig({ baseUrl });
    const adapter = createGitHubReadOnlyAdapter(config);
    assert.equal(adapter.status, "unavailable", `${baseUrl} was auto-trusted`);
    const auth = authority();
    const result = await adapter.execute({
      command: "github.read.branches",
      args: { owner: "remRADAR", repo: "RADARMatrix" },
      authority: auth,
    });
    assert.equal(result.status, "unavailable", baseUrl);
    assert.equal(result.notes, "invalid_api_base_url", baseUrl);
    assert.equal(transport.calls.length, 0, `${baseUrl} reached transport`);
    assert.equal(auth.grant.uses, 0, `${baseUrl} consumed a grant use`);
  }
});

test("an explicitly authorized GitHub Enterprise origin still works", async () => {
  const { config, transport } = makeConfig({
    baseUrl: "https://ghe.example.com/api/v3",
    trustedOrigins: ["https://api.github.com", "https://ghe.example.com"],
  });
  const adapter = createGitHubReadOnlyAdapter(config);
  assert.equal(adapter.status, "connected");
  const result = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "acme", repo: "widgets" },
    authority: authority(),
  });
  assert.equal(result.status, "executed");
  assert.equal(
    transport.calls[0].url,
    "https://ghe.example.com/api/v3/repos/acme/widgets/branches",
  );
});

test("the public api.github.com default still works with no trustedOrigins", async () => {
  const { config, transport } = makeConfig({ baseUrl: undefined });
  const adapter = createGitHubReadOnlyAdapter(config);
  assert.equal(adapter.status, "connected");
  const result = await adapter.execute({
    command: "github.read.branches",
    args: { owner: "remRADAR", repo: "RADARMatrix" },
    authority: authority(),
  });
  assert.equal(result.status, "executed");
  assert.equal(
    transport.calls[0].url,
    "https://api.github.com/repos/remRADAR/RADARMatrix/branches",
  );
});

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

export async function runAllTests() {
  let failed = 0;
  let passed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log("  \u2713 " + name);
    } catch (error) {
      failed += 1;
      console.log("  \u2717 " + name + ": " + (error && error.message ? error.message : String(error)));
    }
  }
  console.log("\nGitHub read-only path-boundary tests: " + passed + " passed, " + failed + " failed");
  return { failed, passed };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const { failed } = await runAllTests();
  process.exit(failed > 0 ? 1 : 0);
}
