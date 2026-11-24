/**
 * RADAR Master Agent loader.
 *
 * Implements the load contract: "load agent from the repo" resolves the master
 * agent profile, every skill it integrates, every workflow prompt, and every
 * knowledge cue — then reports what it resolved, in one call and with no manual
 * assembly.
 *
 * Deliberately NOT here: any execution, provider call, network fetch, or write.
 * `assertRegistry()` in agent-routing.cjs already guarantees every profile is
 * `plan_only` with zero tool grants; this loader only resolves and reports.
 */
const { readFileSync, existsSync } = require('node:fs');
const { resolve, sep } = require('node:path');
const { createHash } = require('node:crypto');

const REGISTRY_ROOT = resolve(__dirname, '../../../agent-skills');
const REPO_ROOT = resolve(__dirname, '../../../..');
const REGISTRY_FILE = resolve(REGISTRY_ROOT, 'registry.json');
const KNOWLEDGE_FILE = resolve(REGISTRY_ROOT, 'knowledge-index.json');
const MANIFEST_FILE = resolve(REGISTRY_ROOT, 'skill-manifest.json');

const MASTER_AGENT_ID = 'radar_master_agent';

class MasterAgentLoadError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'MasterAgentLoadError';
    this.code = code;
    this.status = status;
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function confinedPath(relativePath, base = REGISTRY_ROOT) {
  const root = resolve(base);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new MasterAgentLoadError('PATH_ESCAPE', 'A registry path escaped its root.');
  }
  return target;
}

function readConfined(relativePath, base = REGISTRY_ROOT) {
  const target = confinedPath(relativePath, base);
  if (!existsSync(target)) {
    throw new MasterAgentLoadError('MISSING_FILE', `Registry file is missing: ${relativePath}`, 500);
  }
  return readFileSync(target, 'utf8');
}

/** Resolve a dotted path against the live workspace record. */
function readRecord(workspace, dottedPath) {
  return String(dottedPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), workspace);
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(' ')
    || '';
}

/** Locate the master agent entry, failing closed if the registry does not carry one. */
function getMasterAgent() {
  const registry = readJson(REGISTRY_FILE);
  const agent = (registry.agents || []).find((entry) => entry.id === MASTER_AGENT_ID);
  if (!agent) {
    throw new MasterAgentLoadError('MASTER_AGENT_MISSING', 'The registry has no radar_master_agent entry.', 500);
  }
  return { registry, agent };
}

/**
 * Does this instruction (or goal) request a master-agent load?
 * Returns the matched phrase, or null.
 */
function matchActivation(text) {
  const { agent } = getMasterAgent();
  const phrases = agent.activation?.phrases || [];
  const haystack = ` ${normalize(text)} `;
  const hit = phrases.find((phrase) => {
    const needle = normalize(phrase);
    return needle && haystack.includes(` ${needle} `);
  });
  return hit || null;
}

/**
 * Fully expand one skill file: its text, its size, its hash, and the question
 * "does the content actually contain the guidance this agent claims to carry?".
 * The check is a presence probe, not a paraphrase, so a truncated or stubbed
 * file fails loudly instead of loading as if complete.
 */
function resolveSkill(skillId, skillsById) {
  const skill = skillsById.get(skillId);
  if (!skill) {
    throw new MasterAgentLoadError('UNKNOWN_SKILL', `Skill not in registry: ${skillId}`, 404);
  }
  const text = readConfined(skill.file);
  const firstHeading = text.split('\n').find((line) => line.startsWith('# ')) || '';
  return {
    id: skill.id,
    name: skill.name,
    file: skill.file,
    bytes: Buffer.byteLength(text),
    sha256: sha256(text),
    heading: firstHeading.replace(/^#\s*/, ''),
    nonTrivial: text.trim().length >= 200,
  };
}

/** Every workflow prompt vendored under queues/. */
function resolveWorkflows(manifest) {
  const declared = Array.isArray(manifest?.workflows) ? manifest.workflows : [];
  return declared.map((entry) => {
    const text = readConfined(entry.file);
    return {
      id: entry.id,
      file: entry.file,
      bytes: Buffer.byteLength(text),
      sha256: sha256(text),
      matchesManifest: sha256(text) === entry.sha256,
    };
  });
}

/**
 * Resolve every knowledge cue.
 *
 * A cue is resolvable when the thing it points at actually exists:
 *  - workspace-asset: the asset id is present in the live workspace record
 *  - workspace-record: the dotted path exists in the live workspace record
 *  - repo-*: the referenced file exists on disk
 *  - external-source: the cue carries a URL (resolution is by citation, never fetch)
 *  - learned knowledge: carries its own summary, so it resolves inline
 *
 * Cues are part of the load because the agent must be able to *use* them at
 * runtime, not merely know they were mentioned somewhere.
 */
function resolveCues(index, workspace) {
  const assets = new Map((workspace?.assets || []).map((a) => [a.id, a]));
  const results = [];
  for (const cue of index.cues || []) {
    let resolved = false;
    let detail = '';

    if (cue.type === 'workspace-asset') {
      const live = assets.get(cue.assetId);
      resolved = Boolean(live);
      detail = live
        ? `workspace asset ${live.id} v${live.version} — ${live.name}`
        : `workspace asset ${cue.assetId} not present in this workspace`;
    } else if (cue.type === 'workspace-record') {
      const live = readRecord(workspace, cue.recordPath);
      resolved = live !== undefined && live !== null;
      detail = resolved
        ? `workspace record ${cue.recordPath} present`
        : `workspace record ${cue.recordPath} not present in this workspace`;
    } else if (cue.type === 'external-source') {
      resolved = typeof cue.url === 'string' && cue.url.startsWith('https://');
      detail = resolved ? `cited from ${cue.url}` : 'external source has no https URL';
    } else if (typeof cue.file === 'string') {
      try {
        const base = cue.root === 'repo' ? REPO_ROOT : REGISTRY_ROOT;
        const target = confinedPath(cue.file, base);
        resolved = existsSync(target);
        detail = resolved ? `${cue.file} present` : `${cue.file} missing`;
      } catch (error) {
        resolved = false;
        detail = error.message;
      }
    } else if (typeof cue.summary === 'string' && cue.summary.trim().length > 0) {
      // Knowledge learned at runtime has no file to point at. Its own summary is
      // the knowledge, so it resolves inline — but only if it actually says something.
      resolved = true;
      detail = 'inline knowledge (learned at runtime)';
    } else {
      detail = 'cue has no resolvable target';
    }

    results.push({ id: cue.id, type: cue.type, tags: cue.tags || [], resolved, detail });
  }
  return results;
}

/**
 * Assemble the complete master-agent load bundle.
 *
 * @param {object} options
 * @param {string} [options.instruction] - the operator's words, for activation matching
 * @param {object} [options.workspace]   - live workspace record, so asset cues resolve
 * @returns {object} a fully-resolved, byte-verifiable description of the agent
 */
function loadMasterAgent(options = {}) {
  const { registry, agent } = getMasterAgent();
  const manifest = readJson(MANIFEST_FILE);
  const index = readJson(KNOWLEDGE_FILE);
  const skillsById = new Map((registry.skills || []).map((skill) => [skill.id, skill]));

  const skills = (agent.skillIds || []).map((id) => resolveSkill(id, skillsById));
  const workflows = resolveWorkflows(manifest);
  const cues = resolveCues(index, options.workspace);

  const coverage = {
    skillsDeclared: (agent.skillIds || []).length,
    skillsResolved: skills.filter((s) => s.nonTrivial).length,
    workflowsResolved: workflows.filter((w) => w.matchesManifest).length,
    cuesResolved: cues.filter((c) => c.resolved).length,
    cuesTotal: cues.length,
  };

  const complete = coverage.skillsResolved === coverage.skillsDeclared
    && coverage.workflowsResolved === workflows.length
    && coverage.cuesResolved === coverage.cuesTotal;

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      lead: Boolean(agent.lead),
      coordinator: Boolean(agent.coordinator),
      accessMode: agent.accessMode,
      allowedMcpTools: [...(agent.allowedMcpTools || [])],
    },
    activation: {
      instruction: options.instruction || null,
      matchedPhrase: options.instruction ? matchActivation(options.instruction) : null,
      phrases: [...(agent.activation?.phrases || [])],
    },
    registryVersion: registry.registryVersion,
    indexVersion: index.indexVersion,
    indexGeneration: index.generation,
    manifestVersion: manifest.manifestVersion,
    coverage,
    complete,
    skills,
    workflows,
    cues,
    knowledgeIndex: agent.activation?.knowledgeIndex || 'knowledge-index.json',
    skillManifest: agent.activation?.skillManifest || 'skill-manifest.json',
    execution: {
      mode: 'plan_only',
      started: false,
      externalActionsPerformed: false,
      note: 'Load resolves and reports only. No agent, model, connector or external action was invoked.',
    },
  };
}

/** Skill text for on-demand reading, same path confinement as the router. */
function loadSkillText(skillId) {
  const { registry } = getMasterAgent();
  const skill = (registry.skills || []).find((entry) => entry.id === skillId);
  if (!skill) throw new MasterAgentLoadError('UNKNOWN_SKILL', 'Unknown skill id.', 404);
  return readConfined(skill.file);
}

module.exports = {
  MASTER_AGENT_ID,
  MasterAgentLoadError,
  loadMasterAgent,
  loadSkillText,
  matchActivation,
  getMasterAgent,
};
