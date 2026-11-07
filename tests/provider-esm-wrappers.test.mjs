/**
 * RADARMatrix Provider ESM Wrapper Tests (M1a follow-up — Finding C)
 *
 * The integration security suite imports the .cjs implementations
 * directly. These tests independently verify the .js ESM re-export
 * wrappers:
 *
 * - Each wrapper imports successfully under the repository's
 *   "type": "module" configuration.
 * - Every expected named export exists.
 * - The wrappers re-export the intended .cjs implementation
 *   (identity comparison — a duplicate implementation could never
 *   satisfy it).
 * - No duplicate implementation has been reintroduced (source-level
 *   checks: wrappers must re-export, must not assign module.exports,
 *   must not declare classes).
 * - Fail-closed semantics remain unchanged through the wrappers.
 *
 * Failures are counted and returned to tests/test-runner.mjs, which
 * exits non-zero when any test fails. Standalone runs exit non-zero.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const cjsImplementations = {
  authentication: require("../apps/mcp-server/src/providers/authentication.cjs"),
  authorization: require("../apps/mcp-server/src/providers/authorization.cjs"),
  membership: require("../apps/mcp-server/src/providers/membership.cjs"),
};

const wrappers = {
  authentication: await import("../apps/mcp-server/src/providers/authentication.js"),
  authorization: await import("../apps/mcp-server/src/providers/authorization.js"),
  membership: await import("../apps/mcp-server/src/providers/membership.js"),
};

function readWrapperSource(name) {
  return readFileSync(
    fileURLToPath(new URL("../apps/mcp-server/src/providers/" + name, import.meta.url)),
    "utf8",
  );
}

const wrapperSources = {
  authentication: readWrapperSource("authentication.js"),
  authorization: readWrapperSource("authorization.js"),
  membership: readWrapperSource("membership.js"),
};

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("authentication.js ESM wrapper imports under type:module with every expected named export", () => {
  assert.equal(typeof wrappers.authentication.DevelopmentAuthenticationProvider, "function");
  assert.equal(typeof wrappers.authentication.normalizePrincipals, "function");
  assert.equal(typeof wrappers.authentication.defaultDevelopmentPrincipals, "function");
});

test("authorization.js ESM wrapper imports under type:module with every expected named export", () => {
  assert.equal(typeof wrappers.authorization.DefaultAuthorizationProvider, "function");
});

test("membership.js ESM wrapper imports under type:module with every expected named export", () => {
  assert.equal(typeof wrappers.membership.DevelopmentMembershipProvider, "function");
  assert.equal(typeof wrappers.membership.normalizeMembers, "function");
  assert.equal(typeof wrappers.membership.defaultDevelopmentMembership, "function");
});

test("wrappers re-export the intended .cjs implementation (identity, not duplicates)", () => {
  assert.equal(
    wrappers.authentication.DevelopmentAuthenticationProvider,
    cjsImplementations.authentication.DevelopmentAuthenticationProvider,
  );
  assert.equal(
    wrappers.authorization.DefaultAuthorizationProvider,
    cjsImplementations.authorization.DefaultAuthorizationProvider,
  );
  assert.equal(
    wrappers.membership.DevelopmentMembershipProvider,
    cjsImplementations.membership.DevelopmentMembershipProvider,
  );
  assert.equal(
    wrappers.membership.defaultDevelopmentMembership,
    cjsImplementations.membership.defaultDevelopmentMembership,
  );
});

test("no duplicate implementation has been reintroduced in the .js wrappers", () => {
  const expectedRefs = {
    authentication: 'from "./authentication.cjs"',
    authorization: 'from "./authorization.cjs"',
    membership: 'from "./membership.cjs"',
  };
  for (const [name, ref] of Object.entries(expectedRefs)) {
    assert.ok(wrapperSources[name].includes("export {"), name + ".js must be an ESM re-export wrapper");
    assert.ok(wrapperSources[name].includes(ref), name + ".js must re-export from its .cjs implementation");
    assert.ok(!wrapperSources[name].includes("module.exports ="), name + ".js must not assign module.exports");
    assert.ok(!wrapperSources[name].includes("class "), name + ".js must not declare an implementation class");
  }
});

test("fail-closed semantics remain unchanged through the wrappers", () => {
  const AuthenticationProvider = wrappers.authentication.DevelopmentAuthenticationProvider;
  const auth = new AuthenticationProvider();
  assert.equal(
    auth.authenticate({ context: { caller_id: "attacker_999", workspace_id: "w_dev" } }),
    null,
    "unknown caller must not authenticate",
  );
  const devPrincipal = auth.authenticate({ context: { caller_id: "admin_123", workspace_id: "w_dev" } });
  assert.ok(devPrincipal && devPrincipal.caller_id === "admin_123", "development fixture identity must still work in dev mode");
  assert.ok(Array.isArray(devPrincipal.roles));

  const MembershipProvider = wrappers.membership.DevelopmentMembershipProvider;
  const emptyMembership = new MembershipProvider();
  assert.equal(emptyMembership.isMember("admin_123", "w_dev"), false, "default membership must stay fail-closed (empty explicit map)");
  const fixtureMembership = new MembershipProvider({ members: wrappers.membership.defaultDevelopmentMembership() });
  assert.equal(fixtureMembership.isMember("admin_123", "w_dev"), true);
  assert.equal(fixtureMembership.isMember("admin_123", "w_other"), false, "membership must not leak across workspaces");

  const AuthorizationProvider = wrappers.authorization.DefaultAuthorizationProvider;
  const authz = new AuthorizationProvider();
  const registry = {
    "t.read": { required_role: "viewer" },
    "t.write": { required_role: "editor" },
  };
  assert.equal(authz.isAuthorized({ caller_id: "u", roles: ["viewer"], workspace_id: "w" }, registry, "t.read"), true);
  assert.equal(authz.isAuthorized({ caller_id: "u", roles: ["viewer"], workspace_id: "w" }, registry, "t.write"), false, "RBAC must enforce the role hierarchy");
  assert.equal(authz.isAuthorized({ caller_id: "u", roles: ["superuser"], workspace_id: "w" }, registry, "t.read"), false, "unknown roles must not authorize anything");
});

test("wrapper default fixtures match the .cjs implementations", () => {
  assert.deepEqual(
    wrappers.authentication.defaultDevelopmentPrincipals(),
    cjsImplementations.authentication.defaultDevelopmentPrincipals(),
  );
  assert.deepEqual(
    wrappers.membership.defaultDevelopmentMembership(),
    cjsImplementations.membership.defaultDevelopmentMembership(),
  );
});

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
  console.log("\nProvider ESM wrapper tests: " + passed + " passed, " + failed + " failed");
  return { failed, passed };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const { failed } = await runAllTests();
  process.exit(failed > 0 ? 1 : 0);
}
