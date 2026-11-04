/**
 * RADARMatrix Test Runner (M1a — fail-fast)
 *
 * Orchestrates all test suites and provides summary reporting.
 *
 * M1a change: the runner previously called process.exit(0)
 * unconditionally, which meant a green run proved nothing. Suites now
 * report failures as return values (or throw), and this runner exits
 * non-zero when ANY test fails. CI relies on this exit code; a
 * secondary output guard additionally rejects swallowed failure lines.
 *
 * M2.2 note: the runtime mode is fail-closed by default — the npm
 * test scripts set RADARMATRIX_RUNTIME_MODE=test explicitly. The
 * runner never relies on a mode default.
 *
 * Suites:
 * - v0.7-gateway.test.mjs (foundation gateway logic, self-contained)
 * - v0.8-chatgpt-contract.test.mjs (contract validation, self-contained)
 * - agent-routing.test.mjs (registry + deterministic router)
 * - brand-gateway-routing.test.mjs (brand gateway read-only routing)
 * - gateway-integration-security.test.mjs (M1a: exercises the REAL
 *   gateway implementation end-to-end)
 * - provider-esm-wrappers.test.mjs (M1a follow-up: ESM re-export
 *   wrappers verified against the .cjs implementations)
 * - production-auth-negative.test.mjs (M2: production authentication
 *   chain — token matrix, provider fail-closed paths, durable
 *   membership, gateway integration in production mode)
 * - delegation-approval.test.mjs (M2: delegated authority subset
 *   enforcement + single-use Ed25519 approval tokens — implemented,
 *   not yet wired to the gateway)
 * - m2-2-security-regressions.test.mjs (M2.2: fail-closed runtime
 *   modes + hardened approval claims/clock validation)
 */

import { runAllTests as runGatewayTests } from "./v0.7-gateway.test.mjs";
import { runAllTests as runContractTests } from "./v0.8-chatgpt-contract.test.mjs";
import { runAllTests as runAgentRoutingTests } from "./agent-routing.test.mjs";
import { runAllTests as runBrandGatewayRoutingTests } from "./brand-gateway-routing.test.mjs";
import { runAllTests as runGatewayIntegrationTests } from "./gateway-integration-security.test.mjs";
import { runAllTests as runProviderEsmWrapperTests } from "./provider-esm-wrappers.test.mjs";
import { runAllTests as runProductionAuthTests } from "./production-auth-negative.test.mjs";
import { runAllTests as runDelegationApprovalTests } from "./delegation-approval.test.mjs";
import { runAllTests as runM22SecurityRegressions } from "./m2-2-security-regressions.test.mjs";

console.log("\n");
console.log("╔═════════════════════════════════════════╗");
console.log("║   RADARMatrix Test Suite (v0.9 M2.2)    ║");
console.log("║   Foundation + Integration Tests        ║");
console.log("╚═════════════════════════════════════════╝");

const startTime = Date.now();

const suites = [
  { name: "▶ MCP Gateway Tests (v0.7 foundation)", run: runGatewayTests },
  { name: "▶ ChatGPT Contract Tests (v0.8 foundation)", run: runContractTests },
  { name: "▶ RADAR Agent Routing Tests", run: runAgentRoutingTests },
  { name: "▶ Brand Gateway Routing Tests", run: runBrandGatewayRoutingTests },
  { name: "▶ Gateway Integration Security Tests (M1a — real implementation)", run: runGatewayIntegrationTests },
  { name: "▶ Provider ESM Wrapper Tests (M1a follow-up)", run: runProviderEsmWrapperTests },
  { name: "▶ Production Authentication & Membership Tests (M2 — real implementation)", run: runProductionAuthTests },
  { name: "▶ Delegation & Approval Tests (M2 — implemented, not yet gateway-wired)", run: runDelegationApprovalTests },
  { name: "▶ M2.2 Security Regressions (runtime fail-closed + hardened approvals)", run: runM22SecurityRegressions },
];

const results = [];

for (const suite of suites) {
  console.log("\n" + suite.name + "\n");
  try {
    const result = await suite.run();
    const failed =
      typeof result === "number"
        ? result
        : result && typeof result === "object" && typeof result.failed === "number"
          ? result.failed
          : 0;
    results.push({ name: suite.name, failed, threw: null });
  } catch (error) {
    results.push({ name: suite.name, failed: null, threw: error && error.message ? error.message : String(error) });
  }
}

const failingSuites = results.filter((r) => (r.failed || 0) > 0 || r.threw !== null);
const totalFailures = results.reduce((sum, r) => sum + (r.failed || 0) + (r.threw !== null ? 1 : 0), 0);

const duration = Date.now() - startTime;
console.log("\n╔═════════════════════════════════════════╗");
console.log("║           Test Run Complete            ║");
console.log("║   Duration: " + duration + "ms");
console.log("║   Suites: " + results.length + ", failing: " + failingSuites.length);
if (failingSuites.length > 0) {
  console.log("║   FAILED SUITES:");
  for (const r of failingSuites) {
    const why = r.threw !== null ? " (threw: " + r.threw + ")" : " (" + r.failed + " test failure(s))";
    console.log("║   - " + r.name + why);
  }
}
console.log("╚═════════════════════════════════════════╝\n");

if (totalFailures > 0) {
  console.error("Test run FAILED: " + totalFailures + " failure(s) across " + failingSuites.length + " suite(s).");
  process.exit(1);
}

console.log("All test suites passed.");
process.exit(0);
