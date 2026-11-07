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
 * M2.2.1 note: suites may export an async runAllTests (the delegation
 * and correction suites verify concurrent denial behavior with real
 * awaits); the runner awaits every suite.
 *
 * M2.2.2 note: the trusted membership provider and the canonical tool
 * registry are bound ONCE per process at import time through
 * ./server-authority.helper.mjs (the test process plays the trusted
 * server composition boundary — exactly the role gateway startup has
 * in production). All delegation-touching suites share that single
 * binding; request payloads cannot supply or replace it.
 *
 * M2.2.3 note: the composition capability moved OUT of the
 * general-purpose auth module into the trusted composition root
 * (apps/mcp-server/src/auth/server-composition.ts). The helper below
 * imports THAT module — the same module gateway startup will call.
 * First-initialization behavior is proven in FRESH child processes
 * (the m2-2-3 suite), because this process composes once at import.
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
 * - delegation-approval.test.mjs (M2/M2.2.1/M2.2.2: delegated authority
 *   subset enforcement, HMAC integrity seal, atomic reservation +
 *   single-use Ed25519 approval tokens, caller-supplied
 *   provider/registry rejection — implemented, not yet wired to the
 *   gateway)
 * - m2-2-security-regressions.test.mjs (M2.2: fail-closed runtime
 *   modes + hardened approval claims/clock validation)
 * - m2-2-1-security-corrections.test.mjs (M2.2.1: grant integrity
 *   mutation matrix, atomic grant-use reservation through the
 *   compatibility adapter, trusted-actor runtime provenance,
 *   approval ordering/replay, membership-file hardening)
 * - m2-2-2-provenance.test.mjs (M2.2.2: server-authority composition
 *   binding — fabricated providers/registries rejected, unbound
 *   authority fails closed, M2.2.1 HMAC/reservation protections
 *   re-asserted intact)
 * - m2-2-3-authority-hardening.test.mjs (M2.2.3: secure first
 *   initialization — the general-purpose auth module exports no
 *   initialization capability, only the trusted composition root
 *   (server-composition.ts) can establish authority (fresh-process
 *   child scenarios); protected membership adapter (post-binding
 *   method replacement has no effect, legitimate data updates flow)
 *   and validated, copied, deep-frozen registry snapshot (retained
 *   original references cannot mutate roles/write flags/identities;
 *   unknown tools denied))
 * - github-readonly.test.mjs (M3: deterministic read-only adapter
 *   contract, server-bound grants, HMAC integrity, atomic reservation,
 *   approval ordering, and fail-closed transport/result behavior)
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
import { runAllTests as runM221SecurityCorrections } from "./m2-2-1-security-corrections.test.mjs";
import { runAllTests as runM222Provenance } from "./m2-2-2-provenance.test.mjs";
import { runAllTests as runM223AuthorityHardening } from "./m2-2-3-authority-hardening.test.mjs";
import { runAllTests as runM224CompositionBoundary } from "./m2-2-4-composition-boundary.test.mjs";
import { runAllTests as runM231BoundaryContracts } from "./m2-3-1-boundary-contracts.test.mjs";
import { runAllTests as runM3GithubReadonly } from "./github-readonly.test.mjs";

console.log("\n");
console.log("╔═════════════════════════════════════════╗");
console.log("║   RADARMatrix Test Suite (v0.9 M3)      ║");
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
  { name: "▶ Delegation & Approval Tests (M2/M2.2.1/M2.2.2 — HMAC seal + atomic reservation)", run: runDelegationApprovalTests },
  { name: "▶ M2.2 Security Regressions (runtime fail-closed + hardened approvals)", run: runM22SecurityRegressions },
  { name: "▶ M2.2.1 Security Corrections (integrity, reservation, provenance, ordering, membership)", run: runM221SecurityCorrections },
  { name: "▶ M2.2.2 Provenance Tests (server-authority binding, fabricated provider/registry rejection)", run: runM222Provenance },
  { name: "▶ M2.2.3 Authority Hardening Tests (secure first initialization, immutable provider/registry binding)", run: runM223AuthorityHardening },
  { name: "▶ M2.2.4 Composition Boundary Tests (approved import graph and residual runtime threat)", run: runM224CompositionBoundary },
  { name: "▶ M2.3.1 RM-IEP/1 Boundary Contracts (schemas, sessions, NDJSON)", run: runM231BoundaryContracts },
  { name: "▶ M3 GitHub Read-Only Runtime Adapter Tests (HMAC grants + atomic reservation)", run: runM3GithubReadonly },
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
