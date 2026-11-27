/**
 * RADARMatrix M2.2.4 Trusted Composition Boundary Tests.
 *
 * These tests deliberately distinguish three guarantees:
 * 1. delegation.ts exposes no initialization capability;
 * 2. the supported source architecture is protected by an executable
 *    import-graph policy; and
 * 3. unrestricted malicious code in the same Node process can still
 *    import source modules directly, because ESM does not authenticate
 *    the importer. The third result is recorded as a residual risk,
 *    never mislabeled as prevented.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(HERE, "m2224-boundary-child.mjs");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function childScenario(scenario) {
  const run = spawnSync(process.execPath, [CHILD, scenario], {
    env: { ...process.env, RADARMATRIX_RUNTIME_MODE: "test" },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, `child ${scenario} exited non-zero: ${run.stderr || ""}`);
  const line = (run.stdout || "").split("\n").find((value) => value.startsWith("RESULT:"));
  assert.ok(line, `child ${scenario} emitted no RESULT line`);
  return JSON.parse(line.slice("RESULT:".length));
}

test("A1: the request-facing authorization module exposes no initializer", async () => {
  const delegation = await import("../apps/mcp-server/src/auth/delegation.ts");
  assert.equal(typeof delegation.initializeServerAuthority, "undefined");
  assert.equal(typeof delegation.composeServerAuthority, "undefined");
});

test("A2: the approved import-graph policy passes", () => {
  const run = spawnSync(process.execPath, ["scripts/check-authority-boundary.mjs"], {
    cwd: path.join(HERE, ".."),
    env: process.env,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("A3: direct composition import remains possible only as a documented residual same-process threat", () => {
  const result = childScenario("composition-attack");
  assert.equal(result.composed, true);
  assert.equal(result.forgedContextMinted, true);
  assert.equal(result.forgedAdminRole, true);
  assert.equal(result.forgedWriteGrantMinted, true);
});

test("A4: direct state-writer import remains possible only as a documented residual same-process threat", () => {
  const result = childScenario("state-writer-attack");
  assert.equal(result.bound, true);
  assert.equal(result.forgedContextMinted, true);
  assert.equal(result.forgedWriteGrantMinted, true);
});

test("A5: request-shaped dependency injection remains rejected", async () => {
  const { composeServerAuthority } = await import("../apps/mcp-server/src/auth/server-composition.ts");
  assert.equal(composeServerAuthority(JSON.parse(JSON.stringify({
    membershipProvider: { isMember: "always true", getRole: "admin" },
    toolRegistry: { "forged.write": { required_role: "admin", is_write_operation: true } },
  }))), false);
});

test("A6: pure derivation is explicitly separate from the server-bound grant path", async () => {
  const delegation = await import("../apps/mcp-server/src/auth/delegation.ts");
  assert.equal(typeof delegation.deriveActorAuthority, "function");
  assert.equal(typeof delegation.createDelegatedGrant, "function");
});

export async function runAllTests() {
  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  ✗ ${name}: ${error?.message || String(error)}`);
    }
  }
  console.log(`\nM2.2.4 composition-boundary tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { failed } = await runAllTests();
  process.exit(failed > 0 ? 1 : 0);
}
