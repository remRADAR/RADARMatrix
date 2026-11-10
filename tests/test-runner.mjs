/**
 * RADARMatrix Test Runner
 *
 * Orchestrates every suite and — critically — exits non-zero on ANY failure.
 *
 * History: this file used to end with an unconditional `process.exit(0)`, and
 * the suites print "✗ <name>: <message>" from a catch block and continue. So
 * `npm test` exited 0 while printing failures: anything built on that exit code
 * (CI, a review gate) was meaningless.
 *
 * How failures are now counted, without touching the suite bodies:
 *   Each suite reports a failure by printing a line beginning with "✗". That is
 *   the signal that was previously discarded. While a suite runs, this runner
 *   temporarily wraps console.log/console.error, forwards every line unchanged
 *   to the real console, and feeds any failure marker into the shared counter in
 *   ./harness.mjs. A suite that throws is also a suite-level failure.
 *
 *   This keeps one counter for the whole process, needs no edit inside the
 *   ~3400 lines of suite bodies, and automatically covers suites added later.
 *
 * Exit codes: 0 = every suite ran and recorded no failure. 1 = any recorded
 * failure or a thrown suite.
 */

import { recordFailure, getFailureCount, getFailures, resetFailures } from "./harness.mjs";

import { runAllTests as runGatewayTests } from "./v0.7-gateway.test.mjs";
import { runAllTests as runContractTests } from "./v0.8-chatgpt-contract.test.mjs";
import { runAllTests as runAgentRoutingTests } from "./agent-routing.test.mjs";
import { runAllTests as runBrandGatewayRoutingTests } from "./brand-gateway-routing.test.mjs";
import { runAllTests as runBrowserBridgeTests } from "./browser-bridge.test.mjs";

const FAILURE_MARKER = "✗";
const PASS_MARKER = "✓";

const SUITES = [
  { name: "MCP Gateway (v0.7)", run: () => runGatewayTests() },
  { name: "ChatGPT Contract (v0.8)", run: () => runContractTests() },
  { name: "RADAR Agent Routing", run: () => runAgentRoutingTests() },
  { name: "Brand Gateway Routing", run: () => runBrandGatewayRoutingTests() },
  { name: "Browser Bridge Contract", run: () => runBrowserBridgeTests() },
];

/**
 * Run `fn` with console.log/console.error tapped so failure markers in the
 * suite's own output are counted. Output is never suppressed or reordered.
 */
async function runTapped(fn) {
  const realLog = console.log;
  const realError = console.error;
  const counter = { passes: 0, markers: 0 };

  const tap = (...args) => {
    const line = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
    const trimmed = line.trimStart();
    if (trimmed.startsWith(FAILURE_MARKER)) {
      counter.markers += 1;
      recordFailure(trimmed.replace(/^✗\s*/, ""));
    } else if (trimmed.startsWith(PASS_MARKER)) {
      counter.passes += 1;
    }
    realLog(...args);
  };

  console.log = tap;
  console.error = tap;
  try {
    await fn();
  } finally {
    console.log = realLog;
    console.error = realError;
  }
  return counter;
}

console.log("\n");
console.log("╔════════════════════════════════════════╗");
console.log("║   RADARMatrix Test Suite (v0.8)        ║");
console.log("║   Foundation Implementation Tests      ║");
console.log("╚════════════════════════════════════════╝\n");

const startTime = Date.now();
const suiteResults = [];
const allFailures = [];

for (const suite of SUITES) {
  resetFailures();
  console.log(`▶ Running ${suite.name}...\n`);
  let threw = null;
  let counter = { passes: 0, markers: 0 };
  try {
    counter = await runTapped(suite.run);
  } catch (error) {
    threw = error;
    console.log(`  ✗ suite threw: ${error instanceof Error ? error.message : String(error)}`);
  }

  const failures = getFailureCount();
  const failed = Boolean(threw) || failures > 0;
  allFailures.push(...getFailures());
  suiteResults.push({
    name: suite.name,
    passes: counter.passes,
    failures,
    threw: Boolean(threw),
    failed,
    detail: threw ? (threw instanceof Error ? threw.message : String(threw)) : null,
  });
  console.log(
    `\n◀ ${suite.name}: ${failed ? "FAIL" : "PASS"} — ${counter.passes} passed, ${failures} failed\n`,
  );
}

const duration = Date.now() - startTime;
const failedSuites = suiteResults.filter((s) => s.failed);
const totalPasses = suiteResults.reduce((n, s) => n + s.passes, 0);
const totalFailures = suiteResults.reduce((n, s) => n + s.failures, 0);

console.log("╔════════════════════════════════════════╗");
console.log("║           Test Run Complete            ║");
console.log("╚════════════════════════════════════════╝");
console.log(`  Duration:            ${duration}ms`);
console.log(`  Suites:              ${suiteResults.length} run, ${failedSuites.length} failed`);
console.log(`  Checks passed:       ${totalPasses}`);
console.log(`  Checks failed:       ${totalFailures}`);

// Two of the suites are assert-based: they call assert.equal/ok and throw on
// failure instead of printing per-check lines. A pass therefore produces no ✓
// output, and a failure is caught above as a thrown suite. "No checks printed"
// is only meaningful for the marker-printing suites, so it is reported as
// information rather than treated as a failure — treating it as a failure would
// wrongly fail these two suites, which is the opposite of fail-closed.
const silent = suiteResults.filter(
  (s) => s.passes === 0 && s.failures === 0 && !s.threw,
);
for (const s of silent) {
  console.log(`  · ${s.name} is assert-based (throws on failure); no per-check markers`);
}

if (failedSuites.length > 0) {
  console.log("\nFAILING SUITES:");
  for (const s of failedSuites) {
    console.log(
      `  ✗ ${s.name} — ${s.threw ? `threw: ${s.detail}` : `${s.failures} failed check(s)`}`,
    );
  }
  if (allFailures.length > 0) {
    console.log("\nFAILED CHECKS:");
    for (const f of allFailures) console.log(`  ✗ ${f}`);
  }
  console.log("\nRESULT: FAILED");
  process.exit(1);
}

console.log("\nRESULT: PASSED (all suites green, zero recorded failures)");
process.exit(0);
