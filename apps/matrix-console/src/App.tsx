import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { HaloDesktop } from './HaloDesktop';

type Screen = 'overview' | 'chat' | 'agents' | 'skills' | 'knowledge' | 'tasks' | 'connections' | 'operator' | 'ide' | 'cloud' | 'halo';
type Status = 'Implemented' | 'Connected' | 'Planned' | 'Unavailable' | 'Demo only';

const nav: { id: Screen; label: string; icon: string; group: string }[] = [
  { id: 'overview', label: 'Overview', icon: '◈', group: 'Workspace' },
  { id: 'chat', label: 'RADAR Chat', icon: '✦', group: 'Workspace' },
  { id: 'agents', label: 'Agent Network', icon: '◎', group: 'Workspace' },
  { id: 'skills', label: 'Skills Library', icon: '⌘', group: 'Workspace' },
  { id: 'knowledge', label: 'Knowledge Centre', icon: '▤', group: 'Workspace' },
  { id: 'tasks', label: 'Task Centre', icon: '✓', group: 'Workspace' },
  { id: 'connections', label: 'Connections', icon: '⌁', group: 'System' },
  { id: 'operator', label: 'Operator Screen', icon: '◌', group: 'Future surfaces' },
  { id: 'ide', label: 'Matrix IDE', icon: '〉_', group: 'Future surfaces' },
  { id: 'cloud', label: 'Cloud Computer', icon: '▣', group: 'Future surfaces' },
  { id: 'halo', label: 'Halo OS', icon: '◉', group: 'Future surfaces' },
];

function screenFromLocation(): Screen {
  // The ES2022 at() method is unavailable on Chromium < 92, a realistic floor
  // on Android 7-era television browsers, and it previously threw on every
  // app load. Plain index access keeps identical behavior.
  const segments = window.location.pathname.split('/').filter(Boolean);
  const requested = new URLSearchParams(window.location.search).get('screen')
    ?? segments[segments.length - 1];
  return nav.find((item) => item.id === requested)?.id ?? 'overview';
}

const agents = [
  { name: 'RADAR Orchestrator', code: 'RM-00', role: 'Routing & review', skill: 'radar-vibe-queue', tone: 'gold', status: 'Plan-only' },
  { name: 'Web Engineer', code: 'WEB-04', role: 'Product implementation', skill: 'web-development', tone: 'blue', status: 'Available' },
  { name: 'Agent Architect', code: 'ARC-02', role: 'Tools & orchestration', skill: 'universal-agent-architect', tone: 'violet', status: 'Available' },
  { name: 'Debug Responder', code: 'DBG-06', role: 'Incidents & regressions', skill: 'debug-incident', tone: 'red', status: 'Available' },
  { name: 'Market Intelligence', code: 'MKT-07', role: 'Company & market research', skill: 'market-intelligence', tone: 'green', status: 'Available' },
  { name: 'Product Study Analyst', code: 'STU-08', role: 'Authorized product study', skill: 'authorized-product-study', tone: 'gold', status: 'Available' },
];

const skills = [
  ['radar-vibe-queue', 'Task router', 'Routes a request to the smallest useful specialist set.', 'Orchestrator'],
  ['web-development', 'Web engineering', 'Accessibility, security, performance and product implementation.', 'Web Engineer'],
  ['universal-agent-architect', 'Agent architecture', 'Designs tools, memory, approvals, evaluation and orchestration.', 'Agent Architect'],
  ['debug-incident', 'Debug & incident', 'Separates evidence, hypotheses, mitigations and follow-up.', 'Debug Responder'],
  ['market-intelligence', 'Market intelligence', 'Company, market and financial research workflows.', 'Market Intelligence'],
  ['authorized-product-study', 'Product study', 'Permitted study of product behavior and independent equivalents.', 'Product Study Analyst'],
];

const future: Record<string, { title: string; description: string; status: Status }> = {
  operator: { title: 'Operator Screen', description: 'A future surface for approval-aware operator workflows.', status: 'Planned' },
  ide: { title: 'Matrix IDE', description: 'A future surface for repository-aware implementation work.', status: 'Unavailable' },
  cloud: { title: 'Cloud Computer', description: 'No connected remote computer or terminal is exposed by this prototype.', status: 'Unavailable' },
  halo: { title: 'Halo OS', description: 'A future ambient workspace surface for RADAR operations.', status: 'Planned' },
};

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function App() {
  const [screen, setScreen] = useState<Screen>(screenFromLocation);
  const [query, setQuery] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<string[]>([]);
  const [taskFilter, setTaskFilter] = useState('All');
  const current = nav.find((item) => item.id === screen)!;

  useEffect(() => {
    const syncScreen = () => setScreen(screenFromLocation());
    window.addEventListener('popstate', syncScreen);
    return () => window.removeEventListener('popstate', syncScreen);
  }, []);

  const filteredSkills = useMemo(() => skills.filter((item) => item.join(' ').toLowerCase().includes(query.toLowerCase())), [query]);
  const filteredAgents = useMemo(() => agents.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()) || item.skill.includes(query.toLowerCase())), [query]);

  function go(next: Screen) {
    setScreen(next);
    const path = next === 'overview' ? '/' : `/${next}`;
    if (window.location.pathname !== path || window.location.search) window.history.pushState({}, '', path);
  }

  function sendChat(event: FormEvent) {
    event.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;
    setChatMessages((messages) => [...messages, trimmed]);
    setChatInput('');
  }

  if (screen === 'halo') return <HaloDesktop onExit={() => go('overview')} />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><div className="radar-mark"><i /><i /><i /><i /></div><div><strong>RADAR<span>MATRIX</span></strong><small>OPERATING ENVIRONMENT</small></div></div>
      <div className="workspace-card"><div className="status-ring" /><div><small>WORKSPACE</small><strong>RADARCharts / Demo</strong></div><span>⌄</span></div>
      <nav>{(['Workspace', 'System', 'Future surfaces'] as const).map((group) => <div className="nav-group" key={group}><p>{group}</p>{nav.filter((item) => item.group === group).map((item) => <button key={item.id} className={screen === item.id ? 'nav-item active' : 'nav-item'} onClick={() => go(item.id)}><b>{item.icon}</b><span>{item.label}</span>{item.id === 'tasks' && <em>03</em>}</button>)}</div>)}</nav>
      <div className="sidebar-foot"><div className="truth-note"><Badge tone="gold">DEMO MODE</Badge><p>Local presentation data only. No live agents, model, memory or integrations are attached.</p></div><div className="profile"><div className="avatar">RM</div><div><strong>RADARCharts</strong><small>Owner workspace</small></div><span>•••</span></div></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="crumb"><span>RADARMatrix</span><b>/</b><strong>{current.label}</strong></div><div className="top-actions"><span className="quiet-status"><i /> Local prototype</span><button className="top-icon" aria-label="Notifications">♢<sup>3</sup></button><button className="top-icon" aria-label="Help">?</button></div></header>
      <div className="content">
        {screen === 'overview' && <Overview go={go} />}
        {screen === 'chat' && <Chat input={chatInput} setInput={setChatInput} messages={chatMessages} onSubmit={sendChat} />}
        {screen === 'agents' && <Directory title="Agent Network" eyebrow="RADAR AGENT NETWORK" description="Specialist profiles and delegated capabilities. Routing is plan-only in this prototype." search={query} setSearch={setQuery} items={filteredAgents.map((agent) => <AgentCard key={agent.code} agent={agent} />)} />}
        {screen === 'skills' && <Directory title="Skills Library" eyebrow="NATIVE SKILL ENGINE" description="The Vibe Queue registry is presented as a discoverable local catalog." search={query} setSearch={setQuery} items={filteredSkills.map((skill) => <SkillCard key={skill[0]} skill={skill} />)} />}
        {screen === 'knowledge' && <Knowledge />}
        {screen === 'tasks' && <Tasks filter={taskFilter} setFilter={setTaskFilter} />}
        {screen === 'connections' && <Connections />}
        {future[screen] && <FutureScreen {...future[screen]} />}
      </div>
    </main>
  </div>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: ReactNode; description: string; action?: ReactNode }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow} <span>·</span> <b>LOCAL PROTOTYPE</b></div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Overview({ go }: { go: (s: Screen) => void }) {
  const modules = [['RADAR Intelligence', 'Workspace context and signal layer', 'Planned', 'gold'], ['RADAR Agent Network', 'Six local specialist profiles', 'Implemented', 'green'], ['RADAR Chat', 'Conversation and plan preview', 'Implemented', 'green'], ['RADAR Operator Screen', 'Approval-aware operator surface', 'Planned', 'gold'], ['RADAR Cloud Computer', 'No connected execution host', 'Unavailable', 'red'], ['RADAR IDE', 'Repository workbench surface', 'Unavailable', 'red'], ['RADAR Halo OS', 'Ambient operating layer', 'Planned', 'gold']];
  return <><PageHeader eyebrow="WORKSPACE OVERVIEW" title={<>The operating <em>surface</em></>} description="A truthful first interface for RADAR's intelligence, orchestration and approval-aware workspace." action={<Badge tone="gold">NO LIVE CONNECTIONS</Badge>} />
    <div className="notice"><span>i</span><div><strong>Prototype boundary</strong><p>All data on this screen is local demonstration data. Nothing here dispatches an agent, calls a model, persists memory or changes an external system.</p></div><button onClick={() => go('connections')}>Review status →</button></div>
    <section className="metric-grid"><Metric label="ACTIVE MODULES" value="02" detail="of 07 represented" tone="gold" /><Metric label="DEMO TASKS" value="03" detail="local records only" tone="violet" /><Metric label="SPECIALISTS" value="06" detail="plan-only directory" tone="blue" /><Metric label="CONNECTIONS" value="00" detail="none attached" tone="red" /></section>
    <div className="overview-grid"><section className="panel"><PanelHeading title="Architecture status" kicker="SEVEN PARTS" /><div className="module-list">{modules.map(([name, detail, status, tone]) => <div className="module-row" key={name}><span className={`module-icon ${tone}`}>◇</span><div><strong>{name}</strong><small>{detail}</small></div><Badge tone={tone}>{status}</Badge></div>)}</div></section><section className="panel"><PanelHeading title="Recent activity" kicker="DEMO RECORDS" /><div className="activity-list"><Activity code="RM" title="Prototype baseline verified" detail="main · 93c1dc18" time="today" /><Activity code="AI" title="Route plan preview opened" detail="Web Engineer · plan-only" time="2h" /><Activity code="KN" title="Workspace memory inspected" detail="persistence unavailable" time="yesterday" /></div><button className="panel-link" onClick={() => go('tasks')}>Open task centre <span>→</span></button></section></div>
    <section className="panel architecture-panel"><PanelHeading title="Operating model" kicker="AUTHORITY FIRST" /><div className="flow"><FlowItem n="01" label="Request" /><b>→</b><FlowItem n="02" label="Route" /><b>→</b><FlowItem n="03" label="Approve" muted /><b>→</b><FlowItem n="04" label="Execute" muted /><b>→</b><FlowItem n="05" label="Audit" muted /></div><p className="caption">The prototype exposes request and route preview only. Approval, execution and audit are future contracts—not simulated activity.</p></section>
  </>;
}

function Chat({ input, setInput, messages, onSubmit }: { input: string; setInput: (v: string) => void; messages: string[]; onSubmit: (e: FormEvent) => void }) {
  return <><PageHeader eyebrow="RADAR CHAT" title={<>Think in <em>context.</em></>} description="A conversation surface with a visible plan preview. Model responses are not connected in this prototype." action={<Badge tone="violet">DEMO RESPONSE ONLY</Badge>} /><div className="chat-layout"><section className="panel chat-panel"><div className="chat-head"><div><strong>RADAR Chat</strong><small>Workspace: RADARCharts / Demo</small></div><Badge tone="red">MODEL OFFLINE</Badge></div><div className="conversation"><div className="message radar"><span className="message-avatar">R</span><div><small>RADAR · demonstration</small><p>What would you like to move through the Vibe Queue today?</p></div></div>{messages.map((message, index) => <div className="message user" key={`${message}-${index}`}><span className="message-avatar">RM</span><div><small>RADARCharts · local input</small><p>{message}</p></div></div>)}{messages.length > 0 && <div className="message radar"><span className="message-avatar">R</span><div><small>RADAR · demonstration</small><p>I can preview a route, but I cannot execute it or call a live model from this interface.</p></div></div>}</div><form className="chat-input" onSubmit={onSubmit}><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Describe an outcome to preview a route…" maxLength={4000} /><button type="submit">Send <span>↗</span></button></form></section><aside className="panel plan-panel"><PanelHeading title="Plan preview" kicker="PLAN-ONLY" /><div className="plan-empty"><div>✦</div><strong>{messages.length ? 'Route preview ready' : 'Your route will appear here'}</strong><p>Routing is deterministic and bounded to two specialists. No model, worker or external tool is attached.</p></div><div className="plan-rule"><span>Execution state</span><Badge tone="gold">PLAN_ONLY</Badge></div></aside></div></>;
}

function Directory({ title, eyebrow, description, search, setSearch, items }: { title: string; eyebrow: string; description: string; search: string; setSearch: (v: string) => void; items: ReactNode[] }) {
  return <><PageHeader eyebrow={eyebrow} title={title} description={description} /><div className="toolbar"><div className="search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search registry…" /></div><span className="result-count">{items.length} records</span></div><div className="card-grid">{items.length ? items : <div className="empty panel">No local records match that search.</div>}</div></>;
}
function AgentCard({ agent }: { agent: typeof agents[number] }) { return <article className="agent-card panel"><div className="card-top"><div className={`agent-avatar ${agent.tone}`}>{agent.code.slice(0, 2)}</div><Badge tone={agent.tone}>{agent.status}</Badge></div><h3>{agent.name}</h3><p>{agent.role}</p><div className="card-meta"><span>{agent.code}</span><span>{agent.skill}</span></div><button className="card-link">View profile <span>↗</span></button></article>; }
function SkillCard({ skill }: { skill: string[] }) { return <article className="skill-card panel"><div className="card-top"><Badge tone="gold">SKILL</Badge><span className="skill-code">VQ / LOCAL</span></div><h3>{skill[1]}</h3><p>{skill[2]}</p><div className="card-meta"><span>{skill[0]}</span><span>{skill[3]}</span></div><button className="card-link">Inspect association <span>↗</span></button></article>; }
function Knowledge() { return <><PageHeader eyebrow="KNOWLEDGE CENTRE" title={<>Context with <em>provenance.</em></>} description="Workspace context, decisions and reference records—without claiming durable persistence." /><div className="notice muted-notice"><span>i</span><div><strong>Persistence is unavailable</strong><p>This screen presents local examples only. No durable memory layer, database or vector store is connected.</p></div><Badge tone="red">NOT PERSISTED</Badge></div><div className="knowledge-grid"><InfoPanel title="Workspace context" kicker="DEMO RECORD"><div className="context-lines"><p><span>Workspace</span><strong>RADARCharts / Demo</strong></p><p><span>Scope</span><strong>Owner workspace</strong></p><p><span>Source</span><strong>Local fixture</strong></p></div></InfoPanel><InfoPanel title="Decision records" kicker="0 SAVED"><div className="empty-state"><b>◇</b><strong>No durable decisions</strong><p>Decision records will appear when a real storage contract exists.</p></div></InfoPanel><InfoPanel title="Memory categories" kicker="LOCAL INDEX"><div className="tag-cloud"><Badge tone="blue">Workspace context</Badge><Badge tone="violet">Reference</Badge><Badge tone="gold">Decisions</Badge><Badge tone="neutral">Agent notes</Badge></div></InfoPanel></div></>; }
function Tasks({ filter, setFilter }: { filter: string; setFilter: (v: string) => void }) { const tasks = [['RM-031', 'Review the Matrix boundary contract', 'Approval pending', 'Review'], ['RM-030', 'Preview a web implementation route', 'Plan only', 'Plan'], ['RM-029', 'Inspect workspace context', 'Unavailable', 'Blocked']]; const shown = filter === 'All' ? tasks : tasks.filter((task) => task[3] === filter); return <><PageHeader eyebrow="TASK CENTRE" title={<>Work, with <em>gates.</em></>} description="Planning, approval and execution states are presented as demo records only." action={<Badge tone="gold">DEMO RECORDS ONLY</Badge>} /><div className="task-summary"><Metric label="PLANNING" value="02" detail="preview states" tone="violet" /><Metric label="APPROVAL" value="01" detail="human gate" tone="gold" /><Metric label="EXECUTION" value="00" detail="not available" tone="red" /><Metric label="AUDIT" value="00" detail="no persistence" tone="blue" /></div><div className="filter-row">{['All', 'Plan', 'Review', 'Blocked'].map((value) => <button className={filter === value ? 'filter active' : 'filter'} key={value} onClick={() => setFilter(value)}>{value}</button>)}</div><section className="panel task-table"><div className="task-head"><span>Task</span><span>State</span><span>Record</span></div>{shown.map((task) => <div className="task-row" key={task[0]}><div><small>{task[0]}</small><strong>{task[1]}</strong></div><Badge tone={task[3] === 'Blocked' ? 'red' : task[3] === 'Review' ? 'gold' : 'violet'}>{task[2]}</Badge><span className="demo-label">LOCAL DEMO</span></div>)}</section></>; }
function Connections() { const rows = [['GitHub', 'Repository connector', 'Unavailable', 'No app connection'], ['Cloudflare', 'Staging Worker target', 'Unavailable', 'Account not attached to UI'], ['Model provider', 'Conversation responses', 'Unavailable', 'No live model'], ['MCP gateway', 'Tool contracts', 'Planned', 'Existing backend preserved'], ['Storage', 'Memory and decisions', 'Unavailable', 'No database or vector store'], ['Browser / execution', 'Operator actions', 'Unavailable', 'No takeover or terminal']]; return <><PageHeader eyebrow="SYSTEM CONNECTIONS" title={<>Know what is <em>real.</em></>} description="Connection states are explicit and never fabricated by the prototype." /><section className="panel connections"><PanelHeading title="Provider status" kicker="READ-ONLY VIEW" />{rows.map((row) => <div className="connection-row" key={row[0]}><div className="connection-icon">⌁</div><div><strong>{row[0]}</strong><small>{row[1]}</small></div><Badge tone={row[2] === 'Unavailable' ? 'red' : row[2] === 'Planned' ? 'gold' : 'green'}>{row[2]}</Badge><span>{row[3]}</span><button onClick={() => window.alert(`${row[0]} is not connected in this prototype.`)}>Details</button></div>)}</section><div className="settings-note"><span>⌁</span><p>These controls inspect local truth only. They do not initiate OAuth, create credentials, change account security or connect external systems.</p></div></>; }
function FutureScreen({ title, description, status }: { title: string; description: string; status: Status }) { return <><PageHeader eyebrow="FUTURE MODULE SURFACE" title={<>{title} <em>preview.</em></>} description={description} /><div className="future-hero panel"><div className="future-symbol">◌</div><Badge tone={status === 'Unavailable' ? 'red' : 'gold'}>{status}</Badge><h2>This surface is not operational yet.</h2><p>RADARMatrix keeps unfinished capabilities visible without presenting a simulated terminal, live agent, authenticated browser or connected operating system.</p><div className="future-line"><span>Implementation status</span><strong>{status}</strong></div></div></>; }
function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small><i className={tone} /></div>; }
function PanelHeading({ title, kicker }: { title: string; kicker: string }) { return <div className="panel-heading"><h2>{title}</h2><span>{kicker}</span></div>; }
function InfoPanel({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) { return <section className="panel"><PanelHeading title={title} kicker={kicker} />{children}</section>; }
function Activity({ code, title, detail, time }: { code: string; title: string; detail: string; time: string }) { return <div className="activity"><span>{code}</span><div><strong>{title}</strong><small>{detail}</small></div><time>{time}</time></div>; }
function FlowItem({ n, label, muted = false }: { n: string; label: string; muted?: boolean }) { return <div className={`flow-item ${muted ? 'muted' : ''}`}><small>{n}</small><strong>{label}</strong></div>; }
export { App };
