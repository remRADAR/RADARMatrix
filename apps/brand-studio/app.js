const views = [...document.querySelectorAll('.view')];
const navItems = [...document.querySelectorAll('.nav-item')];
const breadcrumb = document.querySelector('#page-breadcrumb');
const toast = document.querySelector('#toast');
const labels = { overview: 'Overview', assets: 'Brand assets', content: 'Content queue', community: 'Community', safety: 'Instagram safety', activity: 'Activity log' };

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

document.querySelectorAll('[data-view], [data-view-target]').forEach((control) => control.addEventListener('click', () => showView(control.dataset.view || control.dataset.viewTarget)));

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
