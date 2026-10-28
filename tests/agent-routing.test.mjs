import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getAgentDirectory, planTask, loadSkillText, getRegistrySummary } = require('../apps/mcp-server/src/runtime/agent-routing.cjs');

export function runAllTests() {
  const summary = getRegistrySummary();
  assert.equal(summary.version, '0.1.0');
  assert.equal(summary.agentCount, 9);
  assert.equal(summary.skillCount, 11);

  const directory = getAgentDirectory();
  assert.equal(directory.executionMode, 'plan_only');
  assert.equal(directory.agents.length, 9);
  assert.ok(directory.agents.every((agent) => agent.allowedMcpTools.length === 0));
  assert.ok(directory.agents.some((agent) => agent.id === 'radar_orchestrator' && agent.coordinator));

  const social = planTask('Analyze RADARCharts Instagram community and audience trends for African artists.');
  assert.equal(social.status, 'planned');
  assert.equal(social.assignments[0].agent.id, 'radar_social_intelligence');
  assert.equal(social.execution.started, false);
  assert.equal(social.execution.providerConfigured, false);
  assert.equal(social.approvalGate.sideEffectsPerformed, false);

  const incident = planTask('Debug the production outage and fix the regression in the API.');
  assert.equal(incident.assignments[0].agent.id, 'debug_incident_responder');
  assert.ok(incident.assignments.length <= 2);

  const productStudy = planTask('Study this product UI behavior and compare its user flow.');
  assert.equal(productStudy.assignments[0].agent.id, 'product_study_analyst');

  const architectureAndCode = planTask('Implement the agent skill registry and MCP task routing pipeline in the repository.');
  assert.equal(architectureAndCode.assignments[0].agent.id, 'agent_architect');
  assert.ok(architectureAndCode.assignments.some((assignment) => assignment.agent.id === 'application_engineer'));
  assert.ok(architectureAndCode.pipeline.length >= architectureAndCode.assignments.length + 2);

  const explicitRoute = planTask('Review this request.', 'market_intelligence');
  assert.equal(explicitRoute.requestedCategory, 'market_intelligence');
  assert.equal(explicitRoute.assignments[0].agent.id, 'market_analyst');

  const unmatched = planTask('Can you help with this?');
  assert.equal(unmatched.status, 'needs_clarification');
  assert.equal(unmatched.assignments.length, 0);
  assert.equal(unmatched.clarifyingQuestions.length, 1);

  const sideEffect = planTask('Publish this announcement to Instagram.');
  assert.ok(sideEffect.approvalGate.matchedSideEffectSignals.includes('publish'));
  assert.equal(sideEffect.approvalGate.sideEffectsPerformed, false);

  assert.throws(() => planTask('   '), (error) => error.code === 'INVALID_TASK');
  assert.throws(() => planTask('x'.repeat(4001)), (error) => error.code === 'TASK_TOO_LONG' && error.status === 413);
  assert.throws(() => planTask('A request', 'not-configured'), (error) => error.code === 'INVALID_CATEGORY');
  assert.throws(() => getAgentDirectory('../private'), (error) => error.code === 'INVALID_CATEGORY');
  assert.ok(loadSkillText('radar-meta').includes('Missing evidence is UNKNOWN'));
  assert.throws(() => loadSkillText('../../package.json'), (error) => error.code === 'UNKNOWN_SKILL');

  console.log('agent routing tests passed: registry, deterministic routing, limits, explicit category, and plan-only behavior');
}

if (import.meta.url === `file://${process.argv[1]}`) runAllTests();
