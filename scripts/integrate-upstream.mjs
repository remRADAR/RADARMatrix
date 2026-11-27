#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const upstream = resolve(root, '../radar-vibe-queue');
const skillsRoot = resolve(root, 'apps/agent-skills');
const sourceRoot = resolve(skillsRoot, 'source/radar-vibe-queue');
const upstreamCommit = 'e8262b19a71c8b0b3d338b69a81659ebc5a8980c';

const skillIds = [
  'frontier-router', 'radar-vibe-queue', 'radar-meta', 'universal-agent-architect',
  'application-engineering', 'web-development', 'lovable-vibecode', 'debug-incident',
  'market-intelligence', 'code-language', 'authorized-product-study', 'agent-continuation',
];
for (const id of skillIds) {
  const src = resolve(upstream, `skills/${id}`);
  const dst = resolve(skillsRoot, `skills/${id}`);
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
}
mkdirSync(resolve(skillsRoot, 'queues'), { recursive: true });
for (const name of ['00-router.md', 'agent-continuation.md', 'application-engineering.md', 'authorized-product-study.md', 'code-language.md', 'debug-incident.md', 'lovable-vibecode.md', 'market-intelligence.md', 'radar-release-portal.md', 'radarmeta-following-hygiene.md', 'radarmeta-intelligence-modes.md', 'radarmeta-monitoring-cycle.md', 'radarmeta-social-intelligence.md', 'universal-agent-architect.md', 'web-development.md']) {
  cpSync(resolve(upstream, `queues/${name}`), resolve(skillsRoot, `queues/${name}`));
}
for (const name of ['AGENTS.md', 'QUEUE.md', 'queue.json', 'SKILL-AUDIT.md', 'SOURCE_NOTES.md']) {
  cpSync(resolve(upstream, name), resolve(sourceRoot, name));
}
for (const rel of ['skills/radar-meta/references/following-hygiene.md', 'skills/radar-meta/references/intelligence-modes.md', 'skills/radar-meta/references/monitoring-workflow.md', 'skills/agent-continuation/templates/HANDOFF.template.md']) {
  const dst = resolve(sourceRoot, rel);
  mkdirSync(resolve(dst, '..'), { recursive: true });
  cpSync(resolve(upstream, rel), dst);
}

const registryPath = resolve(skillsRoot, 'registry.json');
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
registry.registryVersion = '0.3.0';
registry.sourcePack = {
  repository: 'https://github.com/remRADAR/radar-vibe-queue',
  branch: 'main',
  commit: upstreamCommit,
  adaptation: 'The 12 upstream packages and supporting source are vendored byte-for-byte. The RADAR Master Agent remains a separate Matrix-specific profile.',
};
for (const skill of registry.skills) {
  if (skillIds.includes(skill.id)) {
    skill.file = `skills/${skill.id}/SKILL.md`;
    skill.sourcePath = `skills/${skill.id}/SKILL.md`;
  }
}
registry.resources = {
  references: [
    'source/radar-vibe-queue/skills/radar-meta/references/following-hygiene.md',
    'source/radar-vibe-queue/skills/radar-meta/references/intelligence-modes.md',
    'source/radar-vibe-queue/skills/radar-meta/references/monitoring-workflow.md',
    'source/radar-vibe-queue/skills/agent-continuation/templates/HANDOFF.template.md',
  ],
  sourceDocuments: ['AGENTS.md', 'QUEUE.md', 'queue.json', 'SKILL-AUDIT.md', 'SOURCE_NOTES.md'].map((name) => `source/radar-vibe-queue/${name}`),
};
registry.resources.referenceBindings = { radar-meta: registry.resources.references.slice(0, 3), agent-continuation: [registry.resources.references[3]] };
writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

const indexPath = resolve(skillsRoot, 'knowledge-index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
index.indexVersion = '1.1.0';
index.generation = Math.max(index.generation || 0, 2);
index.upgradedAt = '2026-11-25T00:00:00.000Z';
index.upgradedFrom = 'complete upstream skill and supporting-source integration at e8262b19a71c8b0b3d338b69a81659ebc5a8980c';
for (const cue of index.cues || []) {
  if (typeof cue.file === 'string' && cue.file.startsWith('skills/')) {
    const id = cue.file.slice('skills/'.length).replace(/\.md$/, '');
    if (skillIds.includes(id)) cue.file = `skills/${id}/SKILL.md`;
  }
}
const additions = [
  ['reference-following-hygiene', 'repo-reference', registry.resources.references[0], 'RADARMeta following hygiene reference'],
  ['reference-intelligence-modes', 'repo-reference', registry.resources.references[1], 'RADARMeta intelligence modes reference'],
  ['reference-monitoring-workflow', 'repo-reference', registry.resources.references[2], 'RADARMeta monitoring workflow reference'],
  ['template-handoff', 'repo-template', registry.resources.references[3], 'Agent continuation handoff template'],
  ...registry.resources.sourceDocuments.map((file) => [`source-${file.split('/').pop().replace(/\.md$/, '')}`, 'repo-source', file, `Vendored upstream operating document: ${file.split('/').pop()}`]),
];
const existing = new Set((index.cues || []).map((cue) => cue.id));
for (const [id, type, file, summary] of additions) {
  if (!existing.has(id)) index.cues.push({ id, type, file, root: 'repo', tags: ['UPSTREAM', 'VERIFIED'], summary, version: '1.0.0' });
}
writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`Integrated ${skillIds.length} upstream skills from ${upstreamCommit}`);
