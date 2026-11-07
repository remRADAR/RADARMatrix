import { useEffect, useMemo, useRef, useState } from 'react';
import './halo-os.css';

type AppId = 'matrix' | 'browser' | 'files' | 'gallery' | 'terminal' | 'settings' | 'network' | 'store' | 'about';
type DesktopApp = { id: AppId; label: string; glyph: string; tint: string; description: string };

const apps: DesktopApp[] = [
  { id: 'matrix', label: 'RADARMatrix', glyph: '◈', tint: 'gold', description: 'Your command environment for agents, skills and workflows.' },
  { id: 'browser', label: 'Browser', glyph: '◎', tint: 'blue', description: 'A browser surface reserved for a future connected browser session.' },
  { id: 'files', label: 'Files', glyph: '▰', tint: 'amber', description: 'A clean workspace for projects, files and shared resources.' },
  { id: 'gallery', label: 'Gallery', glyph: '▧', tint: 'violet', description: 'Your wallpapers, visual assets and creative references.' },
  { id: 'terminal', label: 'Terminal', glyph: '>_', tint: 'green', description: 'A terminal surface. No shell is connected in this preview.' },
  { id: 'network', label: 'Network', glyph: '⌁', tint: 'cyan', description: 'Connection status for the RADARMatrix environment.' },
  { id: 'settings', label: 'Settings', glyph: '⚙', tint: 'slate', description: 'Personalise the Halo desktop experience.' },
  { id: 'store', label: 'App Library', glyph: '▦', tint: 'pink', description: 'A future home for approved applications and extensions.' },
  { id: 'about', label: 'About Halo', glyph: '✧', tint: 'gold', description: 'Halo OS — an ambient desktop experience within RADARMatrix.' },
];

function getTime() {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date());
}
function getDate() {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
}

function isStandaloneDisplay() {
  const safariNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || safariNavigator.standalone === true;
}

export function HaloDesktop({ onExit }: { onExit?: () => void }) {
  const [time, setTime] = useState(getTime);
  const [date, setDate] = useState(getDate);
  const [activeApp, setActiveApp] = useState<AppId | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [wifi, setWifi] = useState(true);
  const [volume, setVolume] = useState(68);
  const [brightness, setBrightness] = useState(82);
  const [notifications, setNotifications] = useState(true);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [pwaChecks, setPwaChecks] = useState({ secure: window.isSecureContext, manifest: false, serviceWorker: false, standalone: isStandaloneDisplay() });
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const tick = () => { setTime(getTime()); setDate(getDate()); };
    const id = window.setInterval(tick, 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const updateFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      setFullscreenAvailable(Boolean(document.fullscreenEnabled && shellRef.current?.requestFullscreen));
    };
    updateFullscreen();
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  useEffect(() => {
    let disposed = false;
    const checkInstallability = async () => {
      const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      let manifestAvailable = false;
      let workerReady = false;
      try {
        if (manifestLink) manifestAvailable = (await fetch(manifestLink.href)).ok;
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration('/');
          workerReady = Boolean(registration?.active);
        }
      } catch {
        // Failed checks are displayed without blocking the workspace.
      }
      if (!disposed) setPwaChecks({ secure: window.isSecureContext, manifest: manifestAvailable, serviceWorker: workerReady, standalone: isStandaloneDisplay() });
    };
    void checkInstallability();
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', checkInstallability);
    return () => {
      disposed = true;
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('controllerchange', checkInstallability);
    };
  }, []);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (installHelpOpen) setInstallHelpOpen(false);
        else if (quickOpen) setQuickOpen(false);
        else if (startOpen) setStartOpen(false);
        else if (activeApp) setActiveApp(null);
        else onExit?.();
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      if (!(event.target instanceof HTMLButtonElement)) return;
      const group = event.target.closest('.halo-icon-grid, .halo-start-apps, .halo-taskbar-apps, .halo-quick-toggles');
      if (!group) return;
      const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const currentIndex = buttons.indexOf(event.target);
      const style = getComputedStyle(group);
      const isGrid = style.display === 'grid';
      if (!isGrid && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) return;
      const columns = isGrid ? style.gridTemplateColumns.split(' ').length : buttons.length;
      const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns;
      const next = buttons[Math.max(0, Math.min(buttons.length - 1, currentIndex + offset))];
      if (next && next !== event.target) {
        event.preventDefault();
        next.focus();
      }
    };
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [activeApp, installHelpOpen, onExit, quickOpen, startOpen]);

  const filteredApps = useMemo(
    () => apps.filter((app) => `${app.label} ${app.description}`.toLowerCase().includes(search.toLowerCase())),
    [search],
  );
  const selected = apps.find((app) => app.id === activeApp);

  function openApp(id: AppId) {
    setActiveApp(id);
    setStartOpen(false);
    setQuickOpen(false);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (shellRef.current?.requestFullscreen) await shellRef.current.requestFullscreen();
    } catch {
      // Fullscreen is optional and may be refused by the browser or TV runtime.
    }
  }

  return (
    <main ref={shellRef} className="halo-shell" aria-label="Halo OS desktop">
      <div className="halo-wallpaper" />
      <div className="halo-wallpaper-shade" />
      <header className="halo-topbar">
        <div className="halo-top-brand"><span className="halo-brand-mark">✧</span><span>HALO</span><i>OS</i></div>
        <div className="halo-top-center"><span className="halo-live-dot" /> RADAR ECOSYSTEM <b>/</b> DESKTOP PREVIEW</div>
        <div className="halo-top-right">
          <span className="halo-top-date">{date}</span>
          <button className="halo-top-icon halo-install-check" onClick={() => { setInstallHelpOpen((v) => !v); setQuickOpen(false); setStartOpen(false); }} aria-label="Show PWA installability checks and iPhone instructions" aria-controls="halo-install-panel" aria-expanded={installHelpOpen}>＋</button>
          <button className="halo-top-icon" onClick={() => { setQuickOpen((v) => !v); setStartOpen(false); setInstallHelpOpen(false); }} aria-label="Open quick settings" aria-controls="halo-quick-panel" aria-expanded={quickOpen}>⌁</button>
          {fullscreenAvailable && <button className="halo-top-icon halo-fullscreen" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? 'Exit full screen presentation' : 'Enter full screen presentation'} title="Full screen presentation">⛶</button>}
          {onExit && <button className="halo-exit" onClick={onExit}>Exit desktop <span>↗</span></button>}
        </div>
      </header>

      {installHelpOpen && (
        <section id="halo-install-panel" className="halo-install-panel" role="dialog" aria-label="Halo PWA installation status">
          <div className="halo-quick-heading"><strong>Install Halo</strong><button aria-label="Close install help" onClick={() => setInstallHelpOpen(false)}>×</button></div>
          <p className="halo-quick-note">PWA readiness checks for this browser and origin.</p>
          <div className="halo-install-checks">
            <p><span>Secure HTTPS context</span><b className={pwaChecks.secure ? 'is-ready' : 'is-missing'}>{pwaChecks.secure ? 'Ready' : 'Required'}</b></p>
            <p><span>Web app manifest</span><b className={pwaChecks.manifest ? 'is-ready' : 'is-missing'}>{pwaChecks.manifest ? 'Available' : 'Unavailable'}</b></p>
            <p><span>Service worker</span><b className={pwaChecks.serviceWorker ? 'is-ready' : 'is-missing'}>{pwaChecks.serviceWorker ? 'Registered' : 'Not ready'}</b></p>
            <p><span>Home Screen mode</span><b className={pwaChecks.standalone ? 'is-ready' : ''}>{pwaChecks.standalone ? 'Installed' : 'Not installed'}</b></p>
          </div>
          <p className="halo-install-instructions">On iPhone, open this HTTPS page in Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. iOS uses this manual step instead of a browser install prompt.</p>
        </section>
      )}

      <section className="halo-desktop-area">
        <div className="halo-icon-grid" role="group" aria-label="Desktop applications">
          {apps.slice(0, 8).map((app) => (
            <button className="halo-desktop-icon" key={app.id} onClick={() => openApp(app.id)} aria-label={`Open ${app.label}`}>
              <span className={`halo-app-glyph ${app.tint}`}>{app.glyph}</span>
              <span>{app.label}</span>
            </button>
          ))}
        </div>

        <aside className="halo-widgets">
          <section className="halo-clock-widget">
            <span className="halo-widget-kicker">YOUR SPACE</span>
            <strong>{time}</strong>
            <span>{date}</span>
            <div className="halo-clock-rule" />
            <div className="halo-clock-footer"><span className="halo-live-dot" /> ALL SYSTEMS AT A GLANCE</div>
          </section>
          <section className="halo-status-widget">
            <div className="halo-widget-heading"><span>RADAR MATRIX</span><span className="halo-status-pill">PREVIEW</span></div>
            <div className="halo-status-row"><span>Desktop shell</span><b>Active</b></div>
            <div className="halo-status-row"><span>Agent services</span><b className="is-muted">Not connected</b></div>
            <div className="halo-status-row"><span>Cloud session</span><b className="is-muted">Unavailable</b></div>
          </section>
        </aside>

        {selected && (
          <section className="halo-window" role="dialog" aria-labelledby="halo-window-title">
            <div className="halo-window-titlebar">
              <div className="halo-window-app"><span className={`halo-window-glyph ${selected.tint}`}>{selected.glyph}</span><strong>{selected.label}</strong></div>
              <div className="halo-window-controls">
                <button aria-label="Minimise window" onClick={() => setActiveApp(null)}>−</button>
                <button aria-label="Close window" onClick={() => setActiveApp(null)}>×</button>
              </div>
            </div>
            <div className="halo-window-content">
              <span className="halo-window-eyebrow">HALO APPLICATION</span>
              <h2 id="halo-window-title">{selected.label}</h2>
              <p>{selected.description}</p>
              {selected.id === 'settings' ? (
                <div className="halo-settings-preview">
                  <label><span>Wallpaper</span><b>Gradient fallback</b></label>
                  <label><span>Interface</span><b>Glass · Dark</b></label>
                  <label><span>Taskbar</span><b>Compact · Floating</b></label>
                </div>
              ) : (
                <div className="halo-window-placeholder"><span>{selected.glyph}</span><div><b>Surface preview</b><small>This app is a visual shell only. Live services will be connected in a later integration phase.</small></div></div>
              )}
            </div>
          </section>
        )}
      </section>

      {startOpen && (
        <section id="halo-start-panel" className="halo-start-panel" role="dialog" aria-label="Start menu">
          <div className="halo-start-head"><div><small>WELCOME BACK</small><strong>Halo Workspace</strong></div><span className="halo-user-avatar">R</span></div>
          <label className="halo-search"><span aria-hidden="true">⌕</span><input aria-label="Search apps and workspace" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search apps and workspace…" /></label>
          <div className="halo-start-label">PINNED APPLICATIONS</div>
          <div className="halo-start-apps">
            {filteredApps.map((app) => <button key={app.id} onClick={() => openApp(app.id)}><span className={`halo-app-glyph ${app.tint}`}>{app.glyph}</span><span>{app.label}</span></button>)}
          </div>
          <div className="halo-start-footer"><span>RADARMatrix · Halo OS</span><button onClick={() => openApp('settings')}>⚙ Settings</button></div>
        </section>
      )}

      {quickOpen && (
        <section id="halo-quick-panel" className="halo-quick-panel" role="dialog" aria-label="Quick settings preview">
          <div className="halo-quick-heading"><strong>Quick settings</strong><button aria-label="Close quick settings" onClick={() => setQuickOpen(false)}>×</button></div>
          <p className="halo-quick-note">Preview only — these controls do not change device settings.</p>
          <div className="halo-quick-toggles">
            <button className={wifi ? 'enabled' : ''} aria-pressed={wifi} onClick={() => setWifi((v) => !v)}><span aria-hidden="true">⌁</span><b>Wi-Fi preview</b><small>{wifi ? 'On' : 'Off'}</small></button>
            <button className={notifications ? 'enabled' : ''} aria-pressed={notifications} onClick={() => setNotifications((v) => !v)}><span aria-hidden="true">♢</span><b>Focus preview</b><small>{notifications ? 'On' : 'Off'}</small></button>
          </div>
          <label className="halo-slider"><span>☼ <b>Brightness</b></span><input type="range" min="10" max="100" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} /></label>
          <label className="halo-slider"><span>◖ <b>Volume</b></span><input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} /></label>
          <div className="halo-quick-foot"><span>{date}</span><strong>{time}</strong></div>
        </section>
      )}

      <footer className="halo-taskbar">
        <button className={`halo-taskbar-start ${startOpen ? 'is-active' : ''}`} onClick={() => { setStartOpen((v) => !v); setQuickOpen(false); }} aria-label="Open Start menu" aria-controls="halo-start-panel" aria-expanded={startOpen}><span>✧</span></button>
        <div className="halo-taskbar-divider" />
        <div className="halo-taskbar-apps">
          {apps.slice(0, 7).map((app) => (
            <button key={app.id} className={`halo-taskbar-app ${activeApp === app.id ? 'is-running' : ''}`} onClick={() => openApp(app.id)} aria-label={app.label} title={app.label}>
              <span className={`halo-taskbar-glyph ${app.tint}`}>{app.glyph}</span>
              {activeApp === app.id && <i />}
            </button>
          ))}
        </div>
        <div className="halo-taskbar-spacer" />
        <button className="halo-tray" onClick={() => { setQuickOpen((v) => !v); setStartOpen(false); }} aria-label="System tray">
          <span className="halo-tray-network">{wifi ? '⌁' : '×'}</span><span>◖</span><span>▰</span>
        </button>
        <button className="halo-taskbar-clock" onClick={() => { setQuickOpen((v) => !v); setStartOpen(false); }}><strong>{time}</strong><small>{date}</small></button>
      </footer>
      <div className="halo-preview-mark">HALO OS · VISUAL PREVIEW</div>
    </main>
  );
}
