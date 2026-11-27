#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = resolve(ROOT, 'apps/agent-skills');
const MANIFEST = resolve(SKILLS_DIR, 'skill-manifest.json');
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const describe = (file, sourcePath = null) => ({ file, sourcePath, sha256: sha256(resolve(SKILLS_DIR, file)), bytes: statSync(resolve(SKILLS_DIR, file)).size });
const required = (registry, field) => (registry.resources?.[field] || []).map((file) => describe(file, file));
export function buildManifest() {
  const registry = JSON.parse(readFileSync(resolve(SKILLS_DIR, 'registry.json'), 'utf8'));
  const skills = registry.skills.map((s) => ({ id: s.id, name: s.name, file: s.file, sourcePath: s.sourcePath ?? null, sha256: sha256(resolve(SKILLS_DIR, s.file)), bytes: statSync(resolve(SKILLS_DIR, s.file)).size }));
  const workflowFiles = ['00-router.md', 'agent-continuation.md', 'application-engineering.md', 'authorized-product-study.md', 'code-language.md', 'debug-incident.md', 'lovable-vibecode.md', 'market-intelligence.md', 'radar-release-portal.md', 'radarmeta-following-hygiene.md', 'radarmeta-intelligence-modes.md', 'radarmeta-monitoring-cycle.md', 'radarmeta-social-intelligence.md', 'universal-agent-architect.md', 'web-development.md'];
  const workflows = workflowFiles.map((name) => ({ id: name.replace(/\.md$/, ''), ...describe(`queues/${name}`) }));
  const references = required(registry, 'references');
  const sourceDocuments = required(registry, 'sourceDocuments');
  const handoffTemplates = references.filter((entry) => entry.file.endsWith('.template.md'));
  return {
    schemaVersion: 1,
    manifestVersion: '2.0.0',
    description: 'Complete integrity inventory for the RADAR Master Agent knowledge library.',
    agent: 'radar_master_agent',
    provenance: { repository: registry.sourcePack.repository, commit: registry.sourcePack.commit, integration: 'Vendored source; hashes are computed from actual bytes on disk.' },
    counts: { skills: skills.length, workflows: workflows.length, references: references.length, handoffTemplates: handoffTemplates.length, sourceDocuments: sourceDocuments.length, total: skills.length + workflows.length + references.length + sourceDocuments.length },
    skills, workflows, references, handoffTemplates, sourceDocuments,
  };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const next = buildManifest();
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const current = JSON.stringify(JSON.parse(readFileSync(MANIFEST, 'utf8')), null, 2) + '\n';
    if (current !== serialized) { console.error('skill-manifest.json is stale — run: node scripts/rebuild-skill-manifest.mjs'); process.exit(1); }
    console.log(`skill-manifest.json is current (${next.counts.total} content entries).`);
  } else { writeFileSync(MANIFEST, serialized); console.log(`wrote skill-manifest.json — ${next.counts.skills} skills, ${next.counts.workflows} workflows, ${next.counts.references} references, ${next.counts.sourceDocuments} source documents`); }
}
