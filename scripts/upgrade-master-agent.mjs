#!/usr/bin/env node
/**
 * RADAR Master Agent — self-upgrade.
 *
 * The agent improves itself from each prompt. This script is the whole
 * mechanism: it captures what a run taught, reconciles it against the knowledge
 * index, versions the result, and writes a change record.
 *
 *   node scripts/upgrade-master-agent.mjs "the prompt that was handled"
 *   node scripts/upgrade-master-agent.mjs --input '{"prompt":"...","skills":[...]}'
 *   node scripts/upgrade-master-agent.mjs --from-file run.json
 *   node scripts/upgrade-master-agent.mjs "prompt" --skill id:Name:summary \
 *        --cue id:summary --revise id:new-summary --question "open question"
 *   node scripts/upgrade-master-agent.mjs "prompt" --dry-run
 *   node scripts/upgrade-master-agent.mjs --verify
 *
 * Behaviour, end to end:
 *   CAPTURE   prompt + skills + cues + revisions + open questions
 *   RECONCILE match by id; identical content is de-duplicated, different
 *             content is a revision (the prior version is preserved in the log)
 *   VERSION   bump `generation` and the index semver; stamp each entry
 *   RECORD    append one entry to docs/KNOWLEDGE-CHANGELOG.md
 *
 * Eager by design: run it at the end of any prompt that produced durable
 * knowledge. A run that learned nothing writes nothing and says so.
 *
 * It never touches permissions, tool grants, or the registry's plan-only
 * invariants. It only grows knowledge.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_FILE = resolve(ROOT, 'apps/agent-skills/knowledge-index.json');
const MANIFEST_FILE = resolve(ROOT, 'apps/agent-skills/skill-manifest.json');
const CHANGELOG_FILE = resolve(ROOT, 'docs/KNOWLEDGE-CHANGELOG.md');

const now = () => new Date().toISOString();

// --------------------------------------------------------------------------
// capture
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { prompt: null, input: null, fromFile: null, dryRun: false, verify: false,
    skills: [], cues: [], revisions: [], questions: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--input') out.input = next();
    else if (arg === '--from-file') out.fromFile = next();
    else if (arg === '--skill') out.skills.push(next());
    else if (arg === '--cue') out.cues.push(next());
    else if (arg === '--revise') out.revisions.push(next());
    else if (arg === '--question') out.questions.push(next());
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--verify') out.verify = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (!arg.startsWith('--')) rest.push(arg);
  }
  if (rest.length) out.prompt = rest.join(' ');
  return out;
}

/** "id:Name:summary" | "id:summary" | "id" */
function parseTriple(value, kind) {
  const parts = String(value).split(':').map((p) => p.trim());
  const [id, a, b] = parts;
  if (!id) throw new Error(`--${kind} needs an id`);
  if (kind === 'skill') {
    return { id, name: a || id, summary: b || a || '' };
  }
  return { id, summary: a || '' };
}

function capture(args) {
  let payload = {};
  if (args.fromFile) payload = JSON.parse(readFileSync(resolve(process.cwd(), args.fromFile), 'utf8'));
  else if (args.input) payload = JSON.parse(args.input);

  const prompt = args.prompt || payload.prompt || '';
  const skills = [...(payload.skills || []), ...args.skills.map((s) => parseTriple(s, 'skill'))];
  const cues = [...(payload.cues || []), ...args.cues.map((c) => parseTriple(c, 'cue'))];
  const revisions = [...(payload.revisions || []), ...args.revisions.map((r) => parseTriple(r, 'revise'))];
  const questions = [...(payload.questions || []), ...args.questions];

  return { prompt, skills, cues, revisions, questions };
}

// --------------------------------------------------------------------------
// reconcile
// --------------------------------------------------------------------------
const normalize = (value) => String(value || '')
  .normalize('NFKC').toLocaleLowerCase('en-US')
  .match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';

function bumpSemver(version, level = 'minor') {
  const [major, minor, patch] = String(version || '1.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`;
  return `${major}.${minor + 1}.0`;
}

/**
 * Merge captured knowledge into the index.
 * Returns a report; does not write.
 */
export function reconcile(index, captured) {
  const cues = index.cues.map((cue) => ({ ...cue }));
  const byId = new Map(cues.map((cue) => [cue.id, cue]));
  const stamp = now();

  const added = [];
  const revised = [];
  const deduped = [];
  const addedSkills = [];

  for (const skill of captured.skills) {
    if (byId.has(skill.id)) {
      const existing = byId.get(skill.id);
      if (normalize(existing.summary) === normalize(skill.summary)) deduped.push({ id: skill.id, kind: 'skill' });
      else {
        revised.push({ id: skill.id, kind: 'skill', from: existing.summary, to: skill.summary });
        existing.summary = skill.summary;
        existing.version = bumpSemver(existing.version, 'patch');
        existing.updatedAt = stamp;
      }
      continue;
    }
    const entry = {
      id: skill.id,
      type: 'learned-skill',
      tags: ['LEARNED'],
      summary: skill.summary,
      use: `Learned from a run: ${skill.name || skill.id}.`,
      version: '1.0.0',
      updatedAt: stamp,
      learnedAt: stamp,
    };
    cues.push(entry);
    byId.set(entry.id, entry);
    addedSkills.push(entry);
    added.push({ id: entry.id, kind: 'skill' });
  }

  for (const cue of captured.cues) {
    if (byId.has(cue.id)) {
      const existing = byId.get(cue.id);
      if (normalize(existing.summary) === normalize(cue.summary)) deduped.push({ id: cue.id, kind: 'cue' });
      else {
        revised.push({ id: cue.id, kind: 'cue', from: existing.summary, to: cue.summary });
        existing.summary = cue.summary;
        existing.version = bumpSemver(existing.version, 'patch');
        existing.updatedAt = stamp;
      }
      continue;
    }
    const entry = {
      id: cue.id,
      type: 'learned-cue',
      tags: ['LEARNED'],
      summary: cue.summary,
      use: 'Learned from a run; cite by id.',
      version: '1.0.0',
      updatedAt: stamp,
      learnedAt: stamp,
    };
    cues.push(entry);
    byId.set(entry.id, entry);
    added.push({ id: entry.id, kind: 'cue' });
  }

  for (const revision of captured.revisions) {
    const existing = byId.get(revision.id);
    if (!existing) {
      // A revision of something unknown is an addition, not a silent no-op.
      const entry = {
        id: revision.id, type: 'learned-cue', tags: ['LEARNED'],
        summary: revision.summary, use: 'Learned from a run; cite by id.',
        version: '1.0.0', updatedAt: stamp, learnedAt: stamp,
      };
      cues.push(entry);
      byId.set(entry.id, entry);
      added.push({ id: entry.id, kind: 'cue' });
      continue;
    }
    if (normalize(existing.summary) === normalize(revision.summary)) {
      deduped.push({ id: revision.id, kind: 'revision' });
      continue;
    }
    revised.push({ id: revision.id, kind: 'revision', from: existing.summary, to: revision.summary });
    existing.summary = revision.summary;
    existing.version = bumpSemver(existing.version, 'patch');
    existing.updatedAt = stamp;
  }

  const changed = added.length > 0 || revised.length > 0;
  const nextIndex = {
    ...index,
    indexVersion: changed ? bumpSemver(index.indexVersion, revised.length ? 'patch' : 'minor') : index.indexVersion,
    generation: changed ? (index.generation || 0) + 1 : index.generation,
    upgradedAt: changed ? stamp : index.upgradedAt,
    upgradedFrom: changed ? (captured.prompt || index.upgradedFrom) : index.upgradedFrom,
    cues,
  };

  return {
    index: nextIndex,
    changed,
    added,
    addedSkills,
    revised,
    deduped,
    questions: captured.questions,
    promptDigest: captured.prompt ? createHash('sha256').update(captured.prompt).digest('hex').slice(0, 12) : null,
  };
}

// --------------------------------------------------------------------------
// record
// --------------------------------------------------------------------------
function changelogEntry(report, captured) {
  const lines = [];
  lines.push(`## Generation ${report.index.generation} — ${report.index.indexVersion}`);
  lines.push('');
  lines.push(`- **When:** ${now()}`);
  lines.push(`- **Prompt digest:** \`${report.promptDigest || 'none'}\``);
  if (captured.prompt) lines.push(`- **Prompt:** ${captured.prompt.slice(0, 300)}${captured.prompt.length > 300 ? '…' : ''}`);
  lines.push(`- **Added:** ${report.added.length ? report.added.map((a) => `\`${a.id}\` (${a.kind})`).join(', ') : 'none'}`);
  lines.push(`- **Revised:** ${report.revised.length ? report.revised.map((r) => `\`${r.id}\``).join(', ') : 'none'}`);
  lines.push(`- **De-duplicated:** ${report.deduped.length ? report.deduped.map((d) => `\`${d.id}\``).join(', ') : 'none'}`);
  if (report.questions.length) {
    lines.push(`- **Open questions:**`);
    for (const q of report.questions) lines.push(`  - ${q}`);
  }
  lines.push(`- **Index now:** ${report.index.cues.length} cues, generation ${report.index.generation}, version ${report.index.indexVersion}`);
  lines.push('');
  for (const r of report.revised) {
    lines.push(`  - \`${r.id}\` was: ${String(r.from).slice(0, 200)}`);
    lines.push(`  - \`${r.id}\` now: ${String(r.to).slice(0, 200)}`);
  }
  if (report.revised.length) lines.push('');
  return lines.join('\n');
}

function ensureChangelog() {
  if (existsSync(CHANGELOG_FILE)) return;
  mkdirSync(dirname(CHANGELOG_FILE), { recursive: true });
  writeFileSync(CHANGELOG_FILE, [
    '# Knowledge Changelog',
    '',
    'Every accepted self-upgrade of the RADAR Master Agent appends one entry here.',
    'Written by `scripts/upgrade-master-agent.mjs`; do not hand-edit.',
    '',
    'Each entry records the generation, the index version, the prompt digest, what was',
    'added, what was revised (with the prior text preserved), what was de-duplicated,',
    'and any open questions the run left behind.',
    '',
    '---',
    '',
  ].join('\n'));
}

// --------------------------------------------------------------------------
// verify
// --------------------------------------------------------------------------
function verify() {
  const problems = [];
  const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  if (index.schemaVersion !== 1) problems.push('knowledge-index schemaVersion must be 1');
  if (!Array.isArray(index.cues)) problems.push('knowledge-index cues must be an array');
  const ids = new Set();
  for (const cue of index.cues || []) {
    if (!cue.id) problems.push('a cue has no id');
    if (ids.has(cue.id)) problems.push(`duplicate cue id: ${cue.id}`);
    ids.add(cue.id);
    if (!cue.version) problems.push(`cue ${cue.id} has no version`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
  for (const skill of manifest.skills || []) {
    const file = resolve(ROOT, 'apps/agent-skills', skill.file);
    if (!existsSync(file)) problems.push(`manifest skill file missing: ${skill.file}`);
  }
  for (const wf of manifest.workflows || []) {
    const file = resolve(ROOT, 'apps/agent-skills', wf.file);
    if (!existsSync(file)) problems.push(`manifest workflow file missing: ${wf.file}`);
  }
  return { problems, index, manifest };
}

// --------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    return 0;
  }

  if (args.verify) {
    const { problems, index, manifest } = verify();
    if (problems.length) {
      console.error('Knowledge index verification FAILED:');
      for (const p of problems) console.error(`  - ${p}`);
      return 1;
    }
    console.log(`Knowledge index OK — ${index.cues.length} cues, generation ${index.generation}, version ${index.indexVersion}`);
    console.log(`Manifest OK — ${manifest.counts.skills} skills, ${manifest.counts.workflows} workflows`);
    return 0;
  }

  const captured = capture(args);
  if (!captured.prompt && !captured.skills.length && !captured.cues.length && !captured.revisions.length) {
    console.error('Nothing to capture. Pass a prompt and/or --skill/--cue/--revise items.');
    return 2;
  }

  const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  const report = reconcile(index, captured);

  if (!report.changed) {
    console.log(`No knowledge change — ${report.deduped.length} item(s) already known. Index unchanged at generation ${index.generation}.`);
    return 0;
  }

  if (args.dryRun) {
    console.log(`[dry-run] would write generation ${report.index.generation} (${report.index.indexVersion})`);
    console.log(`  added: ${report.added.map((a) => a.id).join(', ') || 'none'}`);
    console.log(`  revised: ${report.revised.map((r) => r.id).join(', ') || 'none'}`);
    console.log(`  deduped: ${report.deduped.map((d) => d.id).join(', ') || 'none'}`);
    return 0;
  }

  writeFileSync(INDEX_FILE, `${JSON.stringify(report.index, null, 2)}\n`);
  ensureChangelog();
  writeFileSync(CHANGELOG_FILE, `${changelogEntry(report, captured)}\n`, { flag: 'a' });

  console.log(`Upgraded to generation ${report.index.generation} (index ${report.index.indexVersion})`);
  console.log(`  added: ${report.added.map((a) => a.id).join(', ') || 'none'}`);
  console.log(`  revised: ${report.revised.map((r) => r.id).join(', ') || 'none'}`);
  console.log(`  deduped: ${report.deduped.map((d) => d.id).join(', ') || 'none'}`);
  console.log(`  cues now: ${report.index.cues.length}`);
  console.log(`  changelog: docs/KNOWLEDGE-CHANGELOG.md`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
