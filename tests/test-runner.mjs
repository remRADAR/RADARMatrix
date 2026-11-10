/**
 * RADARMatrix test runner. Every suite must propagate assertion failures.
 */

import { runAllTests as runGatewayTests } from "./v0.7-gateway.test.mjs";
import { runAllTests as runContractTests } from "./v0.8-chatgpt-contract.test.mjs";
import { runAllTests as runAgentRoutingTests } from "./agent-routing.test.mjs";
import { runAllTests as runBrandGatewayRoutingTests } from "./brand-gateway-routing.test.mjs";
import { runAllTests as runMatrixIdeTests } from "./matrix-ide.test.mjs";

console.log("\nRADARMatrix test suite\n");
const startTime = Date.now();
let failures = 0;

for (const [name, run] of [
  ["MCP Gateway", runGatewayTests],
  ["ChatGPT Contract", runContractTests],
  ["Agent Routing", runAgentRoutingTests],
]) {
  console.log(`▶ Running ${name} tests...\n`);
  const result = run();
  if (typeof result === "number") failures += result;
}

console.log("▶ Running Brand Gateway Routing tests...\n");
await runBrandGatewayRoutingTests();

console.log("▶ Running Matrix IDE tests...\n");
const ideResult = await runMatrixIdeTests();
failures += ideResult.failed;

console.log(`\nTest run complete in ${Date.now() - startTime}ms: ${failures} failed assertion(s).`);
if (failures > 0) process.exitCode = 1;
