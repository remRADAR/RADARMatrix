const { readFileSync } = require('node:fs');
const { resolve, sep } = require('node:path');

const REGISTRY_ROOT = resolve(__dirname, '../../../agent-skills');
const REGISTRY_FILE = resolve(REGISTRY_ROOT, 'registry.json');
const registry = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));

class TaskRoutingError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'TaskRoutingError';
    this.code = code;
    this.status = status;
  }
}

function assertRegistry() {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.agents) || !Array.isArray(registry.skills) || !Array.isArray(registry.routes)) {
    throw new Error('Agent registry schema is invalid');
  }
  const skillIds = new Set(registry.skills.map((skill) => skill.id));
  const agentIds = new Set();
  for (const agent of registry.agents) {
    if (!/^[a-z][a-z0-9_]*$/.test(agent.id) || agentIds.has(agent.id)) throw new Error('Agent registry contains an invalid or duplicate agent id');
    agentIds.add(agent.id);
    for (const skillId of [...(agent.skillIds || []), ...(agent.optionalSkillIds || [])]) {
      if (!skillIds.has(skillId)) throw new Error(`Agent registry references unknown skill: ${skillId}`);
    }
    if (agent.accessMode !== 'plan_only' || !Array.isArray(agent.allowedMcpTools) || agent.allowedMcpTools.length !== 0) {
      throw new Error(`Agent ${agent.id} must remain plan-only with no tool grants`);
    }
  }
  for (const route of registry.routes) {
    if (!agentIds.has(route.agentId) || !Array.isArray(route.keywords) || route.keywords.length === 0) throw new Error(`Invalid route configuration: ${route.category}`);
  }
  if (registry.limits.executionMode !== 'plan_only' || registry.limits.maxSpecialists > 2) throw new Error('Unsafe routing limits');
}

assertRegistry();

const skillsById = new Map(registry.skills.map((skill) => [skill.id, skill]));
const agentsById = new Map(registry.agents.map((agent) => [agent.id, agent]));
const routesByCategory = new Map(registry.routes.map((route) => [route.category, route]));

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';
}

function matchingTerms(normalizedText, keywords) {
  const paddedText = ` ${normalizedText} `;
  return keywords.filter((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    return normalizedKeyword && paddedText.includes(` ${normalizedKeyword} `);
  });
}

function validateCategory(category) {
  if (category === undefined || category === null || category === '' || category === 'auto') return null;
  if (typeof category !== 'string' || !routesByCategory.has(category)) {
    throw new TaskRoutingError('INVALID_CATEGORY', 'Choose auto or one of the configured routing categories.');
  }
  return category;
}

function validateGoal(goal) {
  if (typeof goal !== 'string') throw new TaskRoutingError('INVALID_TASK', 'A task goal is required.');
  const trimmed = goal.trim();
  if (!trimmed) throw new TaskRoutingError('INVALID_TASK', 'A task goal is required.');
  if (trimmed.length > registry.limits.maxTaskCharacters) {
    throw new TaskRoutingError('TASK_TOO_LONG', `Task goals must be ${registry.limits.maxTaskCharacters} characters or fewer.`, 413);
  }
  return trimmed;
}

function publicSkill(skillId) {
  const skill = skillsById.get(skillId);
  if (!skill) return null;
  return { id: skill.id, name: skill.name, sourcePath: skill.sourcePath };
}

function publicAgent(agent) {
  const skillIds = agent.skillIds || [];
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    description: agent.description,
    skillIds: [...skillIds],
    skills: skillIds.map(publicSkill).filter(Boolean),
    optionalSkillIds: [...(agent.optionalSkillIds || [])],
    categories: [...(agent.categories || [])],
    coordinator: Boolean(agent.coordinator),
    accessMode: agent.accessMode,
    allowedMcpTools: [...agent.allowedMcpTools],
  };
}

function getAgentDirectory(category) {
  const selectedCategory = validateCategory(category);
  const agents = registry.agents
    .filter((agent) => agent.coordinator || !selectedCategory || agent.categories.includes(selectedCategory))
    .map(publicAgent);
  return {
    registryVersion: registry.registryVersion,
    sourcePack: cloneJson(registry.sourcePack),
    executionMode: registry.limits.executionMode,
    agents,
    categories: registry.routes
      .slice()
      .sort((a, b) => b.priority - a.priority)
      .map(({ category: id, label }) => ({ id, label })),
  };
}

function planTask(goal, category) {
  const task = validateGoal(goal);
  const requestedCategory = validateCategory(category);
  const normalizedGoal = normalizeText(task);
  let candidates = registry.routes
    .map((route) => ({ route, matches: matchingTerms(normalizedGoal, route.keywords) }))
    .filter((candidate) => candidate.matches.length > 0)
    .sort((a, b) => b.matches.length - a.matches.length || b.route.priority - a.route.priority);

  if (requestedCategory) {
    const preferred = routesByCategory.get(requestedCategory);
    const preferredCandidate = candidates.find((candidate) => candidate.route.category === requestedCategory);
    candidates = [
      { route: preferred, matches: preferredCandidate?.matches || [] },
      ...candidates.filter((candidate) => candidate.route.category !== requestedCategory),
    ];
  }

  const hasRoute = candidates.length > 0;
  const primary = hasRoute ? candidates[0] : null;
  const selected = primary
    ? candidates
      .filter((candidate, index) => index === 0 || candidate.matches.length >= Math.max(1, Math.ceil(primary.matches.length / 2)))
      .slice(0, registry.limits.maxSpecialists)
    : [];
  const coordinator = publicAgent(agentsById.get('radar_orchestrator'));
  const assignments = selected.map(({ route, matches }, index) => {
    const agent = agentsById.get(route.agentId);
    const skillIds = [...(agent.skillIds || [])];
    if (agent.id === 'application_engineer' && /\b(runtime|semantics|typescript|node\.js|migration|language version)\b/i.test(task) && agent.optionalSkillIds?.includes('code-language')) {
      skillIds.push('code-language');
    }
    return {
      sequence: index + 1,
      agent: publicAgent({ ...agent, skillIds }),
      category: route.category,
      rationale: matches.length
        ? `Matched task signals: ${matches.join(', ')}.`
        : `Selected from the explicit category: ${route.label}.`,
      skillIds,
    };
  });

  const sideEffectTerms = matchingTerms(normalizedGoal, [
    'publish', 'post', 'send', 'delete', 'remove', 'block', 'message', 'purchase', 'trade', 'deploy', 'change permissions', 'production write',
  ]);
  const execution = {
    mode: 'plan_only',
    started: false,
    providerConfigured: false,
    note: 'This repository has no agent execution provider or worker wired to the planner; no agent/model call or external action was made.',
  };

  return {
    status: hasRoute ? 'planned' : 'needs_clarification',
    workspaceScoped: true,
    requestedCategory: requestedCategory || 'auto',
    selectedCategory: primary?.route.category || null,
    coordinator: { id: coordinator.id, name: coordinator.name, skillIds: coordinator.skillIds },
    assignments,
    pipeline: [
      { sequence: 1, stage: 'intake', owner: coordinator.id, description: 'Validate bounded task input and preserve its authorized workspace scope.' },
      ...(assignments.length ? assignments.map((assignment, index) => ({ sequence: index + 2, stage: 'specialist_handoff', owner: assignment.agent.id, description: `Prepare work for ${assignment.agent.name}; required skills: ${assignment.skillIds.join(', ')}.` })) : []),
      { sequence: assignments.length + 2, stage: 'synthesis_and_review', owner: coordinator.id, description: 'Return evidence, assumptions, unknowns, recommendations, and approval needs; do not imply work was executed.' },
    ],
    clarifyingQuestions: hasRoute ? [] : ['What outcome and subject should the specialist cover? The request did not match a configured specialist route.'],
    approvalGate: {
      requiredBeforeAnyExternalSideEffect: true,
      matchedSideEffectSignals: sideEffectTerms,
      sideEffectsPerformed: false,
    },
    execution,
  };
}

function loadSkillText(skillId) {
  const skill = skillsById.get(skillId);
  if (!skill) throw new TaskRoutingError('UNKNOWN_SKILL', 'Unknown skill id.', 404);
  const file = resolve(REGISTRY_ROOT, skill.file);
  if (!file.startsWith(`${REGISTRY_ROOT}${sep}`)) throw new Error('Skill path escaped the registry root');
  return readFileSync(file, 'utf8');
}

module.exports = {
  TaskRoutingError,
  getAgentDirectory,
  planTask,
  loadSkillText,
  getRegistrySummary: () => ({ version: registry.registryVersion, skillCount: registry.skills.length, agentCount: registry.agents.length }),
};
