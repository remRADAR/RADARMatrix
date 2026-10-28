const views = [...document.querySelectorAll('.view')];
const navItems = [...document.querySelectorAll('.nav-item')];
const breadcrumb = document.querySelector('#page-breadcrumb');
const toast = document.querySelector('#toast');
const labels = { overview: 'Overview', assets: 'Brand assets', content: 'Content queue', community: 'Community', agents: 'Agent operations', preview: 'Live preview', safety: 'Instagram safety', activity: 'Activity log' };

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

function showView(viewName) {
  const target = labels[viewName] ? viewName : 'overview';
  views.forEach((view) => view.classList.toggle('active-view', view.id === `view-${target}`));
  navItems.forEach((item) => item.classList.toggle('active', item.dataset.view === target));
  breadcrumb.textContent = labels[target];
  window.history.replaceState({}, '', `#${target}`);
  document.title = `RADARMatrix — ${labels[target]}`;
  if (target === 'agents') loadAgents();
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json();
  if (!response.ok || body.success === false) throw new Error(body.error?.message || 'Request failed');
  return body.data;
}

function updateMetric(label, value) {
  const card = [...document.querySelectorAll('.metric-card')].find((item) => item.textContent.includes(label));
  if (card) card.querySelector('.metric-value').textContent = value;
}

function renderWorkspace(workspace) {
  if (!workspace) return;
  updateMetric('CANONICAL ASSETS', workspace.assets.length);
  updateMetric('PENDING APPROVALS', workspace.content.filter((item) => item.status === 'IN_REVIEW').length.toString().padStart(2, '0'));
  updateMetric('COMMUNITY QUEUE', workspace.community.length.toString().padStart(2, '0'));
  const healthCard = [...document.querySelectorAll('.metric-card')].find((item) => item.textContent.includes('ACCOUNT HEALTH'));
  if (healthCard) healthCard.querySelector('.metric-value').innerHTML = `${workspace.safety.healthScore}<span class="metric-unit">%</span>`;
  const safetyHeading = document.querySelector('#view-safety .safety-status h2');
  if (safetyHeading) safetyHeading.textContent = workspace.safety.mutationPause ? 'Mutations paused' : 'Healthy · observe-only';
  const stopButton = document.querySelector('#emergency-stop');
  if (stopButton && workspace.safety.mutationPause) { stopButton.textContent = 'Mutations paused'; stopButton.disabled = true; }
}

async function hydrate() {
  try {
    const workspace = await api('/api/workspace');
    renderWorkspace(workspace.workspace || workspace);
    document.querySelector('.sync-state').innerHTML = '<i></i> Workspace synced';
  } catch (error) {
    document.querySelector('.sync-state').textContent = 'Local preview';
    showToast(`Workspace sync unavailable: ${error.message}`);
  }
}

function makeTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function renderAgentDirectory(directory) {
  const grid = document.querySelector('#agent-directory');
  const meta = document.querySelector('#agent-directory-meta');
  const categorySelect = document.querySelector('#task-category');
  if (!grid || !meta || !categorySelect) return;

  grid.replaceChildren();
  meta.textContent = `${directory.agents.length} profiles · registry ${directory.registryVersion} · source ${directory.sourcePack.commit.slice(0, 8)}`;
  const currentCategory = categorySelect.value || 'auto';
  categorySelect.replaceChildren(new Option('Auto-detect', 'auto'));
  directory.categories.forEach((category) => categorySelect.add(new Option(category.label, category.id)));
  categorySelect.value = currentCategory;
  if (categorySelect.value !== currentCategory) categorySelect.value = 'auto';

  directory.agents.forEach((agent, index) => {
    const card = document.createElement('article');
    card.className = 'agent-card';
    const top = document.createElement('div');
    top.className = 'agent-card-top';
    top.append(makeTextElement('span', 'agent-card-mark', agent.coordinator ? '↗' : ['◈', '⌘', '⌁', '▣', '✦', '!', '◎', '◇'][index % 8]));
    const title = document.createElement('div');
    title.append(makeTextElement('h4', '', agent.name));
    title.append(makeTextElement('small', '', agent.role));
    top.append(title);
    top.append(makeTextElement('span', 'plan-mode-chip', agent.coordinator ? 'ROUTER' : 'PLAN ONLY'));
    card.append(top);
    card.append(makeTextElement('p', '', agent.description));
    const skillList = document.createElement('div');
    skillList.className = 'agent-skill-list';
    (agent.skills || []).forEach((skill) => skillList.append(makeTextElement('span', '', skill.name)));
    (agent.optionalSkillIds || []).forEach((skillId) => skillList.append(makeTextElement('span', '', `${skillId} · optional`)));
    card.append(skillList);
    grid.append(card);
  });
}

async function loadAgents() {
  const grid = document.querySelector('#agent-directory');
  if (!grid) return;
  try {
    const directory = await api('/api/agents');
    renderAgentDirectory(directory);
  } catch (error) {
    grid.replaceChildren(makeTextElement('p', 'agent-directory-empty', `Directory unavailable: ${error.message}`));
  }
}


function getBrowserBridge() {
  const bridge = window.RADAR_BROWSER_BRIDGE;
  return bridge && typeof bridge.connect === 'function' && typeof bridge.disconnect === 'function' ? bridge : null;
}

function refreshBrowserBridgeState() {
  const connect = document.querySelector('#browser-connect');
  const frame = document.querySelector('#preview-frame');
  const title = document.querySelector('#bridge-status-title');
  const copy = document.querySelector('#bridge-status-copy');
  if (!connect || !frame || !title || !copy) return;
  const available = Boolean(getBrowserBridge());
  const hasPreview = Boolean(frame.getAttribute('src'));
  connect.disabled = !available || !hasPreview;
  if (available) {
    title.textContent = hasPreview ? 'Trusted bridge ready' : 'Preview required before takeover';
    copy.textContent = hasPreview ? 'A host-provided bridge is available; take-over still requires your explicit confirmation.' : 'Load the development page the authenticated browser should open.';
  }
}

document.querySelector('#preview-load-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const field = document.querySelector('#preview-url');
  const error = document.querySelector('#preview-url-error');
  const frame = document.querySelector('#preview-frame');
  const placeholder = document.querySelector('#preview-placeholder');
  const status = document.querySelector('#preview-status');
  const newTab = document.querySelector('#preview-new-tab');
  error.hidden = true;
  error.textContent = '';
  try {
    if (!document.querySelector('#browser-disconnect').hidden) throw new Error('Return browser control before changing the preview target.');
    const url = new URL(field.value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an http or https development URL.');
    if (url.username || url.password) throw new Error('Credentials are not allowed in preview URLs.');
    if (window.location.protocol === 'https:' && url.protocol !== 'https:') throw new Error('Use https when this workspace is served securely.');
    frame.src = url.href;
    frame.hidden = false;
    placeholder.hidden = true;
    status.textContent = `Loading ${url.origin} in the isolated frame…`;
    newTab.href = url.href;
    newTab.hidden = false;
    refreshBrowserBridgeState();
  } catch (validationError) {
    error.textContent = validationError.message || 'Enter a valid http or https URL.';
    error.hidden = false;
  }
});

document.querySelector('#preview-frame')?.addEventListener('load', (event) => {
  const frame = event.currentTarget;
  if (!frame.getAttribute('src')) return;
  document.querySelector('#preview-status').textContent = 'Frame load event received; the target may restrict embedding with its own frame policy.';
});

document.querySelector('#browser-connect')?.addEventListener('click', async () => {
  const bridge = getBrowserBridge();
  const frame = document.querySelector('#preview-frame');
  const title = document.querySelector('#bridge-status-title');
  const copy = document.querySelector('#bridge-status-copy');
  const connect = document.querySelector('#browser-connect');
  const disconnect = document.querySelector('#browser-disconnect');
  if (!bridge || !frame.getAttribute('src')) return;
  if (!window.confirm('Connect the configured browser session to this preview? The provider will receive the preview URL.')) return;
  connect.disabled = true;
  title.textContent = 'Connecting…';
  copy.textContent = 'Waiting for the trusted host provider to confirm the session.';
  try {
    const result = await bridge.connect({ previewUrl: frame.src, requestedCapabilities: ['viewport', 'mouse', 'keyboard'] });
    if (!result || result.connected !== true) throw new Error('The browser provider did not confirm an active session.');
    title.textContent = 'Browser control connected';
    copy.textContent = result.operatorLabel ? `Control is available to ${result.operatorLabel}.` : 'The host provider confirmed an active session.';
    connect.hidden = true;
    disconnect.hidden = false;
  } catch (error) {
    title.textContent = 'Browser session not connected';
    copy.textContent = error.message || 'The host provider rejected the session request.';
    connect.hidden = false;
    refreshBrowserBridgeState();
  }
});

document.querySelector('#browser-disconnect')?.addEventListener('click', async () => {
  const bridge = getBrowserBridge();
  const connect = document.querySelector('#browser-connect');
  const disconnect = document.querySelector('#browser-disconnect');
  const title = document.querySelector('#bridge-status-title');
  const copy = document.querySelector('#bridge-status-copy');
  if (!bridge) return;
  disconnect.disabled = true;
  try {
    await bridge.disconnect();
    title.textContent = 'Browser control returned';
    copy.textContent = 'The host provider has ended the interactive control session.';
  } catch (error) {
    title.textContent = 'Could not end browser session';
    copy.textContent = error.message || 'The host provider could not confirm session termination.';
  } finally {
    disconnect.disabled = false;
    disconnect.hidden = true;
    connect.hidden = false;
    refreshBrowserBridgeState();
  }
});

window.addEventListener('radar-browser-bridge-ready', refreshBrowserBridgeState);
function renderRoutePlan(plan) {
  const result = document.querySelector('#task-route-result');
  result.replaceChildren();
  const summary = document.createElement('div');
  summary.className = 'route-summary';
  summary.append(makeTextElement('strong', '', plan.status === 'planned' ? `Route preview · ${plan.selectedCategory.replaceAll('_', ' ')}` : 'More detail needed'));
  summary.append(makeTextElement('p', '', plan.execution.note));
  result.append(summary);

  if (plan.assignments.length === 0) {
    plan.clarifyingQuestions.forEach((question) => result.append(makeTextElement('p', 'agent-directory-empty', question)));
    return;
  }

  plan.assignments.forEach((assignment) => {
    const card = document.createElement('article');
    card.className = 'route-assignment';
    card.append(makeTextElement('h4', '', `${assignment.sequence}. ${assignment.agent.name}`));
    card.append(makeTextElement('p', '', assignment.rationale));
    card.append(makeTextElement('p', '', `Skills: ${assignment.skillIds.join(', ')}`));
    result.append(card);
  });

  const steps = document.createElement('div');
  steps.className = 'route-assignment';
  steps.append(makeTextElement('h4', '', 'Proposed handoff sequence'));
  plan.pipeline.forEach((step) => {
    const row = document.createElement('div');
    row.className = 'route-step';
    row.append(makeTextElement('b', '', String(step.sequence).padStart(2, '0')));
    const detail = document.createElement('div');
    detail.append(makeTextElement('strong', '', step.stage.replaceAll('_', ' ')));
    detail.append(makeTextElement('small', '', `${step.owner} · ${step.description}`));
    row.append(detail);
    steps.append(row);
  });
  result.append(steps);
  result.append(makeTextElement('p', 'agent-directory-empty', 'Nothing was executed or saved. Any future external side effect requires explicit human approval.'));
}

document.querySelectorAll('[data-view], [data-view-target]').forEach((control) => control.addEventListener('click', () => showView(control.dataset.view || control.dataset.viewTarget)));

document.querySelector('#refresh-agents')?.addEventListener('click', loadAgents);
document.querySelector('#task-routing-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const result = document.querySelector('#task-route-result');
  submit.disabled = true;
  result.replaceChildren(makeTextElement('p', 'agent-directory-empty', 'Calculating a deterministic route…'));
  try {
    const goal = document.querySelector('#task-goal').value;
    const category = document.querySelector('#task-category').value;
    const plan = await api('/api/task-routing/plan', { method: 'POST', body: JSON.stringify({ goal, category }) });
    renderRoutePlan(plan);
  } catch (error) {
    result.replaceChildren(makeTextElement('p', 'agent-directory-empty', `Route preview failed: ${error.message}`));
  } finally {
    submit.disabled = false;
  }
});

refreshBrowserBridgeState();

document.querySelector('#new-brief')?.addEventListener('click', () => { showView('content'); showToast('New brief workspace opened — nothing has been published.'); });
document.querySelector('#add-asset')?.addEventListener('click', async () => {
  try {
    await api('/api/assets', { method: 'POST', body: JSON.stringify({ name: 'New canonical note', type: 'NOTE', description: 'Draft asset awaiting editorial review.', tags: ['DRAFT'], approval: { approved: true } }) });
    showToast('Asset saved to the durable workspace.');
    await hydrate();
  } catch (error) { showToast(`Asset not saved: ${error.message}`); }
});
document.querySelector('#new-content')?.addEventListener('click', async () => {
  try {
    await api('/api/content', { method: 'POST', body: JSON.stringify({ title: 'New content brief', format: 'Brief', channel: 'INTERNAL', approval: { approved: true } }) });
    showToast('Draft saved — approval is still required before execution.');
    await hydrate();
  } catch (error) { showToast(`Draft not saved: ${error.message}`); }
});
document.querySelector('#community-rules')?.addEventListener('click', () => { showView('assets'); showToast('Community policy is stored in canonical brand assets.'); });
document.querySelector('#export-log')?.addEventListener('click', () => showToast('Activity export is available after durable audit storage is connected to a file or database sink.'));
document.querySelector('#safety-details')?.addEventListener('click', () => showToast('Safety controls: signed webhooks, rate budgets, circuit breakers, and human approval.'));

document.querySelector('#emergency-stop')?.addEventListener('click', async (event) => {
  if (!window.confirm('Pause all Instagram mutations? Read-only health monitoring will remain active.')) return;
  try {
    await api('/api/emergency-stop', { method: 'POST', body: JSON.stringify({ reason: 'Operator emergency stop from Brand Studio' }) });
    event.currentTarget.textContent = 'Mutations paused';
    event.currentTarget.disabled = true;
    showToast('Emergency stop persisted — Instagram mutations are paused.');
    await hydrate();
  } catch (error) { showToast(`Emergency stop failed: ${error.message}`); }
});

document.querySelectorAll('.filter-tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.filter-tab').forEach((item) => item.classList.remove('active'));
  tab.classList.add('active');
  showToast(`Showing ${tab.textContent.replace(/\d/g, '').trim().toLowerCase()} assets.`);
}));
document.querySelector('.search-field input')?.addEventListener('input', (event) => {
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll('.asset-row').forEach((row) => { row.hidden = Boolean(query && !row.textContent.toLowerCase().includes(query)); });
});

showView(labels[window.location.hash.replace('#', '')] ? window.location.hash.replace('#', '') : 'overview');
hydrate();
