/**
 * RADAR Master Agent — load contract and self-upgrade tests.
 *
 * These assert the two things the brief actually promises:
 *   1. "load agent from the repo" resolves the master agent with every skill,
 *      every workflow prompt and every knowledge cue integrated — in one call,
 *      with no manual assembly, and without executing anything.
 *   2. The upgrade script captures, reconciles, versions and records knowledge,
 *      and is idempotent on repeat input.
 *
 * The upgrade tests run against the committed index in memory only; reconcile()
 * is pure, so a test run never mutates the knowledge base.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const { loadMasterAgent, matchActivation, MASTER_AGENT_ID } = require('../apps/mcp-server/src/runtime/master-agent.cjs');
const { reconcile } = await import('../scripts/upgrade-master-agent.mjs');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const workspace = {
  id: 'w_dev',
  assets: [
    { id: 'asset_voice', name: 'Voice & tone', version: '0.4' },
    { id: 'asset_visual', name: 'Visual language', version: '0.3' },
    { id: 'asset_community', name: 'Community policy', version: '0.2' },
    { id: 'asset_pillars', name: 'Content pillars', version: '0.6' },
  ],
  policy: { version: '0.4' },
  safety: { accountState: 'HEALTHY_OBSERVE_ONLY' },
};

// ---------------------------------------------------------------------------
// load contract
// ---------------------------------------------------------------------------
test('L1: "load agent from the repo" activates the master agent', () => {
  assert.equal(matchActivation('load agent from the repo'), 'load agent from the repo');
  assert.equal(matchActivation('Please LOAD AGENT FROM THE REPO now.'), 'load agent from the repo');
  assert.equal(matchActivation('load the master agent'), 'load the master agent');
  assert.equal(matchActivation('what is the weather'), null);
});

test('L2: the load resolves every declared skill, workflow and cue', () => {
  const load = loadMasterAgent({ instruction: 'load agent from the repo', workspace });
  assert.equal(load.agent.id, MASTER_AGENT_ID);
  assert.equal(load.agent.lead, true);
  assert.equal(load.agent.accessMode, 'plan_only');
  assert.deepEqual(load.agent.allowedMcpTools, []);
  assert.equal(load.activation.matchedPhrase, 'load agent from the repo');

  assert.equal(load.coverage.skillsResolved, load.coverage.skillsDeclared);
  assert.ok(load.coverage.skillsDeclared >= 13, 'master agent must integrate the full skill set');
  assert.equal(load.coverage.workflowsResolved, load.workflows.length);
  assert.ok(load.workflows.length >= 15, 'all workflow prompts must be integrated');
  assert.equal(load.coverage.cuesResolved, load.coverage.cuesTotal);
  assert.equal(load.complete, true);
});

test('L3: every resolved skill is real content, not a stub', () => {
  const load = loadMasterAgent({ workspace });
  for (const skill of load.skills) {
    assert.ok(skill.nonTrivial, `${skill.id} is too small to be real guidance`);
    assert.ok(skill.heading.length > 0, `${skill.id} has no heading`);
    assert.match(skill.sha256, /^[0-9a-f]{64}$/);
  }
  const ids = load.skills.map((s) => s.id);
  for (const required of ['radar-master-agent', 'frontier-router', 'radar-meta', 'universal-agent-architect']) {
    assert.ok(ids.includes(required), `missing required skill: ${required}`);
  }
});

test('L4: workflow prompts match their manifest hashes', () => {
  const load = loadMasterAgent({ workspace });
  for (const wf of load.workflows) {
    assert.ok(wf.matchesManifest, `${wf.id} does not match its manifest hash`);
  }
});

test('L5: knowledge cues resolve against the live workspace', () => {
  const load = loadMasterAgent({ workspace });
  const byId = new Map(load.cues.map((c) => [c.id, c]));
  for (const id of ['voice-tone', 'visual-language', 'community-policy', 'content-pillars']) {
    assert.equal(byId.get(id).resolved, true, `${id} should resolve from the workspace`);
  }
  assert.equal(byId.get('skill-radar-meta').resolved, true);
  assert.equal(byId.get('workflow-monitoring-cycle').resolved, true);
});

test('L6: a cue whose asset is absent reports unresolved rather than pretending', () => {
  const load = loadMasterAgent({ workspace: { id: 'w_dev', assets: [] } });
  const voice = load.cues.find((c) => c.id === 'voice-tone');
  assert.equal(voice.resolved, false);
  assert.equal(load.complete, false, 'an incomplete load must not claim completeness');
});

test('L7: the load performs no execution', () => {
  const load = loadMasterAgent({ instruction: 'load agent from the repo', workspace });
  assert.equal(load.execution.mode, 'plan_only');
  assert.equal(load.execution.started, false);
  assert.equal(load.execution.externalActionsPerformed, false);
});

// ---------------------------------------------------------------------------
// self-upgrade
// ---------------------------------------------------------------------------
const baseIndex = () => JSON.parse(readFileSync(resolve(ROOT, 'apps/agent-skills/knowledge-index.json'), 'utf8'));

test('U1: a new cue is added and the generation/version advance', () => {
  const index = baseIndex();
  const before = { gen: index.generation, ver: index.indexVersion, n: index.cues.length };
  const report = reconcile(index, {
    prompt: 'test prompt', skills: [], cues: [{ id: 'cue-test-new', summary: 'A newly learned fact.' }],
    revisions: [], questions: [],
  });
  assert.equal(report.changed, true);
  assert.equal(report.index.generation, before.gen + 1);
  assert.notEqual(report.index.indexVersion, before.ver);
  assert.equal(report.index.cues.length, before.n + 1);
  assert.ok(report.index.cues.find((c) => c.id === 'cue-test-new'));
});

test('U2: identical knowledge is de-duplicated, not duplicated', () => {
  const index = baseIndex();
  const existing = index.cues[0];
  const report = reconcile(index, {
    prompt: 'repeat', skills: [], cues: [{ id: existing.id, summary: existing.summary }],
    revisions: [], questions: [],
  });
  assert.equal(report.changed, false);
  assert.equal(report.deduped.length, 1);
  assert.equal(report.index.cues.length, index.cues.length);
  assert.equal(report.index.generation, index.generation);
});

test('U3: a revision replaces the summary and preserves the prior text in the report', () => {
  const index = baseIndex();
  const target = index.cues.find((c) => c.id === 'voice-tone');
  const report = reconcile(index, {
    prompt: 'revise', skills: [], cues: [],
    revisions: [{ id: 'voice-tone', summary: 'Direct, culturally literate, never over-explained, never ironic.' }],
    questions: [],
  });
  assert.equal(report.changed, true);
  assert.equal(report.revised.length, 1);
  assert.equal(report.revised[0].from, target.summary);
  const updated = report.index.cues.find((c) => c.id === 'voice-tone');
  assert.match(updated.summary, /never ironic/);
  assert.notEqual(updated.version, target.version, 'a revision must bump the entry version');
});

test('U4: a revision of an unknown id becomes an addition, never a silent no-op', () => {
  const index = baseIndex();
  const report = reconcile(index, {
    prompt: 'revise unknown', skills: [], cues: [],
    revisions: [{ id: 'cue-never-seen', summary: 'Something new.' }], questions: [],
  });
  assert.equal(report.changed, true);
  assert.ok(report.index.cues.find((c) => c.id === 'cue-never-seen'));
});

test('U5: a learned skill is recorded as inline knowledge, not a dangling file path', () => {
  const index = baseIndex();
  const report = reconcile(index, {
    prompt: 'learn a skill', skills: [{ id: 'skill-test-new', name: 'Test Skill', summary: 'A new method.' }],
    cues: [], revisions: [], questions: [],
  });
  const entry = report.index.cues.find((c) => c.id === 'skill-test-new');
  assert.ok(entry);
  assert.equal(entry.type, 'learned-skill');
  assert.equal(entry.file, undefined, 'learned knowledge must not point at a file that does not exist');
  assert.equal(entry.summary, 'A new method.');
});

test('U8: learned knowledge resolves inline at load time', () => {
  const index = baseIndex();
  const report = reconcile(index, {
    prompt: 'learn', skills: [], cues: [{ id: 'cue-inline-test', summary: 'A fact learned at runtime.' }],
    revisions: [], questions: [],
  });
  const learned = report.index.cues.find((c) => c.id === 'cue-inline-test');
  assert.equal(learned.type, 'learned-cue');
  assert.ok(learned.summary.trim().length > 0, 'inline knowledge must carry its own text');
});

test('U6: reconcile never mutates the input index', () => {
  const index = baseIndex();
  const snapshot = JSON.stringify(index);
  reconcile(index, {
    prompt: 'x', skills: [{ id: 'skill-mut', name: 'M', summary: 's' }],
    cues: [{ id: 'cue-mut', summary: 's' }], revisions: [{ id: 'voice-tone', summary: 'changed' }], questions: [],
  });
  assert.equal(JSON.stringify(index), snapshot, 'reconcile must be pure');
});

test('U7: the committed knowledge index is well-formed', () => {
  const index = baseIndex();
  assert.equal(index.schemaVersion, 1);
  const ids = new Set();
  for (const cue of index.cues) {
    assert.ok(cue.id && cue.version, `cue ${cue.id} must carry id and version`);
    assert.ok(!ids.has(cue.id), `duplicate cue id ${cue.id}`);
    ids.add(cue.id);
  }
});

// ---------------------------------------------------------------------------
export async function runAllTests() {
  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`  \u2713 ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  \u2717 ${name}: ${error?.message || String(error)}`);
    }
  }
  console.log(`\nMaster agent tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { failed } = await runAllTests();
  process.exit(failed > 0 ? 1 : 0);
}
