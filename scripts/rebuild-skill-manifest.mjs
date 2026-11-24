#!/usr/bin/env node
/**
 * Regenerate apps/agent-skills/skill-manifest.json from the registry and queue files.
 *
 * The manifest is the machine-readable inventory of everything integrated into
 * the RADAR Master Agent. It is generated, never hand-maintained: it hashes the
 * actual bytes on disk so the load path can prove the corpus is intact.
 *
 *   node scripts/rebuild-skill-manifest.mjs           # write the manifest
 *   node scripts/rebuild-skill-manifest.mjs --check   # exit 1 if it is stale
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = resolve(ROOT, 'apps/agent-skills');
const MANIFEST = resolve(SKILLS_DIR, 'skill-manifest.json');

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const bytes = (p) => statSync(p).size;

export function buildManifest() {
  const registry = JSON.parse(readFileSync(resolve(SKILLS_DIR, 'registry.json'), 'utf8'));

  const skills = registry.skills.map((s) => ({
    id: s.id,
    name: s.name,
    file: s.file,
    sourcePath: s.sourcePath ?? null,
    sha256: sha256(resolve(SKILLS_DIR, s.file)),
    bytes: bytes(resolve(SKILLS_DIR, s.file)),
  }));

  const queueDir = resolve(SKILLS_DIR, 'queues');
  const workflows = readdirSync(queueDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({
      id: f.replace(/\.md$/, ''),
      file: `queues/${f}`,
      sha256: sha256(resolve(queueDir, f)),
      bytes: bytes(resolve(queueDir, f)),
    }));

  return {
    schemaVersion: 1,
    manifestVersion: '1.0.0',
    description:
      'Complete inventory of every skill and workflow prompt integrated into the RADAR Master Agent, with content hashes so the load path can prove the corpus is intact.',
    agent: 'radar_master_agent',
    provenance: {
      repository: 'https://github.com/remRADAR/radar-vibe-queue',
      integration:
        'Vendored into apps/agent-skills so the master agent resolves all knowledge from the repository at runtime, with no external fetch at load.',
    },
    counts: { skills: skills.length, workflows: workflows.length, total: skills.length + workflows.length },
    skills,
    workflows,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const next = buildManifest();
  const serialized = `${JSON.stringify(next, null, 2)}\n`;

  if (process.argv.includes('--check')) {
    const current = JSON.stringify(JSON.parse(readFileSync(MANIFEST, 'utf8')), null, 2) + '\n';
    if (current !== serialized) {
      console.error('skill-manifest.json is stale — run: node scripts/rebuild-skill-manifest.mjs');
      process.exit(1);
    }
    console.log(`skill-manifest.json is current (${next.counts.total} entries).`);
  } else {
    writeFileSync(MANIFEST, serialized);
    console.log(
      `wrote skill-manifest.json — ${next.counts.skills} skills, ${next.counts.workflows} workflows, ${next.counts.total} total`,
    );
  }
}
