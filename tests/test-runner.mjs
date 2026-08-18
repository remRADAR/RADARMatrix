/**
 * RADARMatrix Test Runner
 * 
 * Orchestrates all test suites and provides summary reporting.
 * Runs:
 * - v0.7-gateway.test.mjs
 * - v0.8-chatgpt-contract.test.mjs
 */

import { runAllTests as runGatewayTests } from "./v0.7-gateway.test.mjs";
import { runAllTests as runContractTests } from "./v0.8-chatgpt-contract.test.mjs";

console.log("\n");
console.log("╔════════════════════════════════════════╗");
console.log("║   RADARMatrix Test Suite (v0.8)      ║");
console.log("║   Foundation Implementation Tests     ║");
console.log("╚════════════════════════════════════════╝\n");

const startTime = Date.now();

// Run gateway tests
console.log("▶ Running MCP Gateway Tests (v0.7)...\n");
runGatewayTests();

// Run contract tests
console.log("▶ Running ChatGPT Contract Tests (v0.8)...\n");
runContractTests();

// Summary
const duration = Date.now() - startTime;
console.log("\n╔════════════════════════════════════════╗");
console.log("║           Test Run Complete            ║");
console.log(`║   Duration: ${duration}ms                      ║`);
console.log("║   All foundation tests executed       ║");
console.log("╚════════════════════════════════════════╝\n");

process.exit(0);
