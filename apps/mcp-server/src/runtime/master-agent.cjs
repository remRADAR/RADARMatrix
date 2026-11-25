const { readFileSync, existsSync } = require('node:fs');
const { resolve, sep } = require('node:path');
const { createHash } = require('node:crypto');
const REGISTRY_ROOT = resolve(__dirname, '../../../agent-skills');
const REPO_ROOT = resolve(__dirname, '../../../..');
const REGISTRY_FILE = resolve(REGISTRY_ROOT, 'registry.json');
const KNOWLEDGE_FILE = resolve(REGISTRY_ROOT, 'knowledge-index.json');
const MANIFEST_FILE = resolve(REGISTRY_ROOT, 'skill-manifest.json');
const MASTER_AGENT_ID = 'radar_master_agent';
class MasterAgentLoadError extends Error { constructor(code, message, status = 400) { super(message); this.name = 'MasterAgentLoadError'; this.code = code; this.status = status; } }
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
function confinedPath(relativePath, base = REGISTRY_ROOT) {
  if (typeof relativePath !== 'string' || relativePath.includes('\0')) throw new MasterAgentLoadError('PATH_ESCAPE', 'A registry path escaped its root.');
  const root = resolve(base); const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new MasterAgentLoadError('PATH_ESCAPE', 'A registry path escaped its root.');
  return target;
}
function readConfined(relativePath, base = REGISTRY_ROOT) {
  const target = confinedPath(relativePath, base);
  if (!existsSync(target)) throw new MasterAgentLoadError('MISSING_FILE', `Registry file is missing: ${relativePath}`, 500);
  return readFileSync(target, 'utf8');
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';
function readRecord(workspace, dottedPath) { return String(dottedPath || '').split('.').filter(Boolean).reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), workspace); }
function getMasterAgent() { const registry = readJson(REGISTRY_FILE); const agent = (registry.agents || []).find((entry) => entry.id === MASTER_AGENT_ID); if (!agent) throw new MasterAgentLoadError('MASTER_AGENT_MISSING', 'The registry has no radar_master_agent entry.', 500); return { registry, agent }; }
function matchActivation(text) { const { agent } = getMasterAgent(); const haystack = ` ${normalize(text)} `; return (agent.activation?.phrases || []).find((phrase) => { const needle = normalize(phrase); return needle && haystack.includes(` ${needle} `); }) || null; }
function entryPath(entry) { return entry?.root === 'repo' ? confinedPath(entry.file, REPO_ROOT) : confinedPath(entry.file, REGISTRY_ROOT); }
function checkEntry(entry, label) {
  const unresolved = [];
  let text;
  try { const file = entryPath(entry); if (!existsSync(file)) { unresolved.push(`${label}: missing ${entry.file}`); return { unresolved }; } text = readFileSync(file, 'utf8'); }
  catch (error) { unresolved.push(`${label}: ${error.code || 'invalid'} ${entry.file} (${error.message})`); return { unresolved }; }
  if (entry.bytes !== undefined && Buffer.byteLength(text) !== entry.bytes) unresolved.push(`${label}: byte length mismatch for ${entry.file} (expected ${entry.bytes}, got ${Buffer.byteLength(text)})`);
  if (entry.sha256 && sha256(text) !== entry.sha256) unresolved.push(`${label}: SHA-256 mismatch for ${entry.file} (expected ${entry.sha256}, got ${sha256(text)})`);
  if (!text.trim()) unresolved.push(`${label}: empty ${entry.file}`);
  return { text, unresolved };
}
function verifyInventory() {
  const unresolved = [];
  let registry, manifest, index;
  try { registry = readJson(REGISTRY_FILE); } catch (e) { unresolved.push(`registry: ${e.message}`); return { complete: false, unresolved }; }
  try { manifest = readJson(MANIFEST_FILE); } catch (e) { unresolved.push(`manifest: ${e.message}`); return { complete: false, unresolved }; }
  try { index = readJson(KNOWLEDGE_FILE); } catch (e) { unresolved.push(`knowledge-index: ${e.message}`); return { complete: false, unresolved }; }
  const declared = new Map((registry.skills || []).map((s) => [s.id, s]));
  for (const skill of registry.skills || []) { const result = checkEntry({ ...skill, sha256: manifest.skills?.find((m) => m.id === skill.id)?.sha256, bytes: manifest.skills?.find((m) => m.id === skill.id)?.bytes }, `skill ${skill.id}`); unresolved.push(...result.unresolved); if (skill.id !== 'radar-master-agent' && skill.sourcePath !== skill.file) unresolved.push(`skill ${skill.id}: sourcePath must equal canonical file`); }
  for (const entry of manifest.workflows || []) unresolved.push(...checkEntry(entry, `workflow ${entry.id}`).unresolved);
  for (const category of ['references', 'sourceDocuments']) for (const entry of manifest[category] || []) unresolved.push(...checkEntry(entry, `${category} ${entry.file}`).unresolved);
  for (const id of getMasterAgent().agent.skillIds || []) if (!declared.has(id)) unresolved.push(`master agent: undeclared skill ${id}`);
  for (const cue of index.cues || []) if (cue.file) { try { if (!existsSync(entryPath(cue))) unresolved.push(`cue ${cue.id}: missing ${cue.file}`); } catch (e) { unresolved.push(`cue ${cue.id}: ${e.message}`); } }
  return { complete: unresolved.length === 0, unresolved, registry, manifest, index };
}
function resolveCues(index, workspace) {
  const assets = new Map((workspace?.assets || []).map((a) => [a.id, a]));
  return (index.cues || []).map((cue) => { let resolved = false; let detail = '';
    if (cue.type === 'workspace-asset') { const live = assets.get(cue.assetId); resolved = Boolean(live); detail = live ? `workspace asset ${live.id} v${live.version} — ${live.name}` : `workspace asset ${cue.assetId} not present in this workspace`; }
    else if (cue.type === 'workspace-record') { resolved = readRecord(workspace, cue.recordPath) != null; detail = resolved ? `workspace record ${cue.recordPath} present` : `workspace record ${cue.recordPath} not present in this workspace`; }
    else if (cue.type === 'external-source') { resolved = typeof cue.url === 'string' && cue.url.startsWith('https://'); detail = resolved ? `cited from ${cue.url}` : 'external source has no https URL'; }
    else if (cue.file) { try { resolved = existsSync(entryPath(cue)); detail = resolved ? `${cue.file} present` : `${cue.file} missing`; } catch (e) { detail = e.message; } }
    else if (typeof cue.summary === 'string' && cue.summary.trim()) { resolved = true; detail = 'inline knowledge'; }
    else detail = 'cue has no resolvable target';
    return { id: cue.id, type: cue.type, tags: cue.tags || [], resolved, detail };
  });
}
function loadSkillBundle(skillId) {
  const { registry } = getMasterAgent(); const skill = (registry.skills || []).find((entry) => entry.id === skillId); if (!skill) throw new MasterAgentLoadError('UNKNOWN_SKILL', 'Unknown skill id.', 404);
  const text = readConfined(skill.file); const manifest = readJson(MANIFEST_FILE); const record = manifest.skills?.find((entry) => entry.id === skillId); const bindings = registry.resources?.referenceBindings?.[skillId] || []; const references = (manifest.references || []).filter((entry) => bindings.includes(entry.file));
  const associatedReferences = references.map((entry) => ({ ...entry, content: readConfined(entry.file) }));
  return { skill: { ...skill, content: text, bytes: Buffer.byteLength(text), sha256: sha256(text), manifestSha256: record?.sha256 || null }, references: associatedReferences, metadata: { registryVersion: registry.registryVersion, sourceProvenance: registry.sourcePack }, fileHashes: { skill: sha256(text), references: associatedReferences.map((r) => ({ file: r.file, sha256: sha256(r.content) })) } };
}
function loadWorkflow(workflowId) { const manifest = readJson(MANIFEST_FILE); const entry = (manifest.workflows || []).find((item) => item.id === workflowId || item.file === workflowId || item.file === `queues/${workflowId}.md`); if (!entry) throw new MasterAgentLoadError('UNKNOWN_WORKFLOW', 'Unknown workflow id.', 404); const content = readConfined(entry.file); return { ...entry, content, matchesManifest: sha256(content) === entry.sha256 }; }
function loadSourceDocument(file) { const manifest = readJson(MANIFEST_FILE); const entry = [...(manifest.references || []), ...(manifest.sourceDocuments || [])].find((item) => item.file === file); if (!entry) throw new MasterAgentLoadError('UNKNOWN_RESOURCE', 'Unknown supporting resource.', 404); const content = readConfined(entry.file); return { ...entry, content, matchesManifest: sha256(content) === entry.sha256 }; }
function loadMasterAgent(options = {}) {
  const { registry, agent } = getMasterAgent(); const verification = verifyInventory(); const manifest = verification.manifest || readJson(MANIFEST_FILE); const index = verification.index || readJson(KNOWLEDGE_FILE); const skills = (agent.skillIds || []).flatMap((id) => { try { const bundle = loadSkillBundle(id); return [{ id, name: bundle.skill.name, file: bundle.skill.file, bytes: bundle.skill.bytes, sha256: bundle.skill.sha256, heading: bundle.skill.content.split('\n').find((line) => line.startsWith('# '))?.replace(/^#\s*/, '') || '', nonTrivial: bundle.skill.content.trim().length >= 200 }]; } catch (error) { return [{ id, name: id, file: null, bytes: 0, sha256: null, heading: '', nonTrivial: false, error: error.message }]; } });
  const workflows = (manifest.workflows || []).map((entry) => { try { const content = readConfined(entry.file); return { id: entry.id, file: entry.file, bytes: Buffer.byteLength(content), sha256: sha256(content), matchesManifest: sha256(content) === entry.sha256 }; } catch (error) { return { id: entry.id, file: entry.file, bytes: 0, sha256: null, matchesManifest: false, error: error.message }; } });
  const cues = resolveCues(index, options.workspace); const unresolved = [...verification.unresolved]; for (const cue of cues.filter((c) => !c.resolved)) unresolved.push(`cue ${cue.id}: ${cue.detail}`);
  const coverage = { skillsDeclared: agent.skillIds.length, skillsResolved: skills.filter((s) => s.nonTrivial).length, workflowsDeclared: workflows.length, workflowsResolved: workflows.filter((w) => w.matchesManifest).length, referencesDeclared: (manifest.references || []).length, referencesResolved: (manifest.references || []).filter((r) => { try { return checkEntry(r, 'reference').unresolved.length === 0; } catch { return false; } }).length, sourceDocumentsDeclared: (manifest.sourceDocuments || []).length, sourceDocumentsResolved: (manifest.sourceDocuments || []).filter((r) => checkEntry(r, 'source').unresolved.length === 0).length, cuesResolved: cues.filter((c) => c.resolved).length, cuesTotal: cues.length };
  return { agent: { id: agent.id, name: agent.name, role: agent.role, lead: Boolean(agent.lead), coordinator: Boolean(agent.coordinator), accessMode: agent.accessMode, allowedMcpTools: [...(agent.allowedMcpTools || [])] }, activation: { instruction: options.instruction || null, matchedPhrase: options.instruction ? matchActivation(options.instruction) : null, phrases: [...(agent.activation?.phrases || [])] }, registryVersion: registry.registryVersion, indexVersion: index.indexVersion, indexGeneration: index.generation, manifestVersion: manifest.manifestVersion, sourceProvenance: registry.sourcePack, coverage, complete: verification.complete && unresolved.length === 0, unresolvedItems: [...new Set(unresolved)], skills, workflows, cues, knowledgeIndex: agent.activation?.knowledgeIndex || 'knowledge-index.json', skillManifest: agent.activation?.skillManifest || 'skill-manifest.json', execution: { mode: 'plan_only', started: false, externalActionsPerformed: false, note: 'Load resolves and reports only. No agent, model, connector or external action was invoked.' } };
}
module.exports = { MASTER_AGENT_ID, MasterAgentLoadError, loadMasterAgent, loadSkillBundle, loadWorkflow, loadSourceDocument, verifyInventory, loadSkillText: (skillId) => loadSkillBundle(skillId).skill.content, matchActivation, getMasterAgent };
