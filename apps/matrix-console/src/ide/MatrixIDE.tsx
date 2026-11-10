/**
 * Matrix IDE — the repository workbench surface.
 *
 * Layout: activity bar · explorer · editor (tabs) · terminal · status bar.
 *
 * Truth boundary: the workspace is browser-local and in-memory. The IDE never
 * claims a remote repository, a container, a process or persistence. That
 * boundary is stated in the status bar, the terminal banner and the docs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from './CodeEditor';
import {
  basename,
  createSeedWorkspace,
  dirname,
  languageFor,
  languageLabel,
  normalizePath,
  type TreeNode,
  type VirtualWorkspace,
} from './workspace';
import { runCommand, type TerminalResult } from './terminal';
import './ide.css';

interface Tab {
  path: string;
  /** Text as last saved to the workspace. */
  saved: string;
  /** Current buffer text. */
  draft: string;
}

interface TerminalLine {
  kind: 'input' | 'output' | 'error' | 'banner';
  text: string;
}

type PendingAction = { type: 'close-tab'; path: string } | { type: 'exit' };

const BANNER: TerminalLine[] = [
  { kind: 'banner', text: 'RADARMatrix · Matrix IDE terminal' },
  { kind: 'banner', text: 'Bound to the browser-local virtual workspace — no host process, no network, no persistence.' },
  { kind: 'banner', text: 'Type `help` for the command list.' },
];

function FileIcon({ name, kind }: { name: string; kind: 'file' | 'dir' }) {
  if (kind === 'dir') return <span className="ide-fi ide-fi-dir" aria-hidden="true">▸</span>;
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const tone =
    ext === 'tsx' || ext === 'ts' ? 'ts'
      : ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'jsx' ? 'js'
        : ext === 'json' ? 'json'
          : ext === 'md' ? 'md'
            : ext === 'css' ? 'css'
              : ext === 'html' ? 'html'
                : ext === 'sh' ? 'sh'
                  : 'txt';
  return <span className={`ide-fi ide-fi-${tone}`} aria-hidden="true">◆</span>;
}

function TreeRow({
  node,
  depth,
  activePath,
  expanded,
  onToggle,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  const isActive = activePath === node.path;
  if (node.kind === 'dir') {
    return (
      <div
        className="ide-tree-branch"
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={isOpen}
        tabIndex={-1}
        data-path={node.path}
        onClick={(event) => { event.stopPropagation(); onToggle(node.path); }}
      >
        <div className="ide-tree-row ide-tree-dir" style={{ paddingLeft: `${8 + depth * 12}px` }}>
          <span className={`ide-caret ${isOpen ? 'open' : ''}`} aria-hidden="true">▸</span>
          <FileIcon name={node.name} kind="dir" />
          <span className="ide-tree-label">{node.name}</span>
        </div>
        {isOpen && (
          <div role="group">
            {node.children.map((child) => (
              <TreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                expanded={expanded}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      className={`ide-tree-row ide-tree-file ${isActive ? 'active' : ''}`}
      style={{ paddingLeft: `${8 + depth * 12 + 14}px` }}
      onClick={(event) => { event.stopPropagation(); onOpen(node.path); }}
      title={node.path}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isActive}
      tabIndex={-1}
      data-path={node.path}
    >
      <FileIcon name={node.name} kind="file" />
      <span className="ide-tree-label">{node.name}</span>
    </div>
  );
}

export interface MatrixIDEProps {
  /** Return to the console shell. */
  onExit?: () => void;
}

export function MatrixIDE({ onExit }: MatrixIDEProps) {
  const workspaceRef = useRef<VirtualWorkspace | null>(null);
  if (!workspaceRef.current) workspaceRef.current = createSeedWorkspace();
  const workspace = workspaceRef.current;

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['/workspace', '/workspace/src', '/workspace/src/ide', '/workspace/docs']),
  );
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>(BANNER);
  const [cwd, setCwd] = useState('/workspace');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [command, setCommand] = useState('');
  const [treeVersion, setTreeVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches,
  );
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window === 'undefined' ? true : !window.matchMedia('(max-width: 720px)').matches,
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [sessionModified, setSessionModified] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const terminalScroll = useRef<HTMLDivElement | null>(null);
  const terminalInput = useRef<HTMLInputElement | null>(null);
  const paletteInput = useRef<HTMLInputElement | null>(null);
  const pendingActionTrigger = useRef<HTMLElement | null>(null);
  const toastTimer = useRef<number | null>(null);

  const tree = useMemo(() => workspace.tree('/workspace'), [workspace, treeVersion]);
  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
  const dirty = tabs.filter((tab) => tab.draft !== tab.saved);

  const flash = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, 2200);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)');
    const syncBreakpoint = () => {
      setIsMobile(media.matches);
      setSidebarOpen(!media.matches);
    };
    media.addEventListener('change', syncBreakpoint);
    return () => media.removeEventListener('change', syncBreakpoint);
  }, []);

  const openFile = useCallback(
    (path: string) => {
      const target = normalizePath(path);
      const content = workspace.read(target);
      if (content === null) {
        flash(`${target} is not a file in this workspace`);
        return;
      }
      setTabs((current) => {
        if (current.some((tab) => tab.path === target)) return current;
        return [...current, { path: target, saved: content, draft: content }];
      });
      setActivePath(target);
      // Reveal the file in the tree.
      const parts = target.split('/').filter(Boolean);
      setExpanded((current) => {
        const next = new Set(current);
        let acc = '';
        for (const part of parts.slice(0, -1)) {
          acc += `/${part}`;
          next.add(acc);
        }
        return next;
      });
    },
    [workspace, flash],
  );

  const saveActive = useCallback(() => {
    if (!activeTab) return;
    workspace.write(activeTab.path, activeTab.draft);
    setTabs((current) =>
      current.map((tab) => (tab.path === activeTab.path ? { ...tab, saved: tab.draft } : tab)),
    );
    setTreeVersion((value) => value + 1);
    setSessionModified(true);
    flash(`Saved ${basename(activeTab.path)} to the virtual workspace`);
  }, [activeTab, workspace, flash]);

  const closeTabNow = useCallback((path: string) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.path === path);
      const next = current.filter((tab) => tab.path !== path);
      if (activePath === path) {
        const fallback = next[Math.min(index, next.length - 1)];
        setActivePath(fallback ? fallback.path : null);
      }
      return next;
    });
  }, [activePath]);

  const closeTab = useCallback((path: string) => {
    const tab = tabs.find((item) => item.path === path);
    if (tab && tab.draft !== tab.saved) setPendingAction({ type: 'close-tab', path });
    else closeTabNow(path);
  }, [tabs, closeTabNow]);

  const requestExit = useCallback(() => {
    if (dirty.length || sessionModified) {
      pendingActionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingAction({ type: 'exit' });
    } else onExit?.();
  }, [dirty.length, sessionModified, onExit]);

  const saveAndClosePendingTab = useCallback(() => {
    if (pendingAction?.type !== 'close-tab') return;
    const tab = tabs.find((item) => item.path === pendingAction.path);
    if (tab) {
      workspace.write(tab.path, tab.draft);
      setTabs((current) => current.map((item) => item.path === tab.path ? { ...item, saved: item.draft } : item));
      setTreeVersion((value) => value + 1);
      setSessionModified(true);
      closeTabNow(tab.path);
    }
    setPendingAction(null);
  }, [pendingAction, tabs, workspace, closeTabNow]);

  const discardPendingAction = useCallback(() => {
    if (!pendingAction) return;
    if (pendingAction.type === 'close-tab') closeTabNow(pendingAction.path);
    else onExit?.();
    setPendingAction(null);
  }, [pendingAction, closeTabNow, onExit]);

  const updateDraft = useCallback(
    (value: string) => {
      if (!activePath) return;
      setTabs((current) =>
        current.map((tab) => (tab.path === activePath ? { ...tab, draft: value } : tab)),
      );
    },
    [activePath],
  );

  const appendTerminal = useCallback((result: TerminalResult) => {
    setTerminalLines((current) => {
      const base = result.clear ? [] : current;
      const next: TerminalLine[] = [...base];
      for (const line of result.lines) {
        next.push({ kind: result.exitCode === 0 ? 'output' : 'error', text: line });
      }
      return next;
    });
    setCwd(result.cwd);
    if (result.openPath) openFile(result.openPath);
  }, [openFile]);

  const submitCommand = useCallback(
    (raw: string) => {
      const input = raw.trim();
      if (!input) return;
      setTerminalLines((current) => [...current, { kind: 'input', text: `${cwd} $ ${input}` }]);
      setHistory((current) => [...current, input]);
      setHistoryIndex(null);
      const workspaceBefore = JSON.stringify([workspace.snapshot(), workspace.tree()]);
      const result = runCommand(
        {
          workspace,
          cwd,
          history,
          onRun: (task) => {
            if (task === 'test') {
              return [
                '> node tests/test-runner.mjs',
                '',
                '  ✓ gateway contract',
                '  ✓ agent routing',
                '  ✓ matrix console smoke',
                '  ✓ matrix ide workspace',
                '',
                '4 suites passed (simulated — no process was spawned)',
              ];
            }
            return [
              '> npm run build:matrix-console',
              '',
              'vite v7 building for production…',
              '✓ 42 modules transformed.',
              'dist/index.html                  0.62 kB',
              'dist/assets/index-*.css         18.4 kB',
              'dist/assets/index-*.js         214.7 kB',
              '',
              'built in 1.84s (simulated — no process was spawned)',
            ];
          },
        },
        input,
      );
      appendTerminal(result);
      if (workspaceBefore !== JSON.stringify([workspace.snapshot(), workspace.tree()])) setSessionModified(true);
      setTreeVersion((value) => value + 1);
    },
    [workspace, cwd, history, appendTerminal],
  );

  useEffect(() => {
    if (!paletteOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    paletteInput.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPaletteOpen(false);
      } else if (event.key === 'Tab') {
        const dialog = paletteInput.current?.closest('[role="dialog"]');
        const focusable = dialog?.querySelectorAll<HTMLElement>('input, button:not([disabled]), [tabindex="0"]');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [paletteOpen]);

  useEffect(() => {
    if (!pendingAction) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPendingAction(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector<HTMLElement>('.ide-confirm[role="alertdialog"]');
      const focusable = dialog?.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (pendingActionTrigger.current?.isConnected) pendingActionTrigger.current.focus();
      else document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    };
  }, [pendingAction]);

  // Keep the terminal pinned to the bottom.
  useEffect(() => {
    const node = terminalScroll.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [terminalLines, terminalOpen]);

  // Global shortcuts: Ctrl/Cmd+S save, Ctrl/Cmd+P palette, Ctrl/Cmd+` terminal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveActive();
      } else if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        setPaletteQuery('');
      } else if (event.key === '`') {
        event.preventDefault();
        setTerminalOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveActive]);

  const paletteResults = useMemo(() => {
    const needle = paletteQuery.trim().toLowerCase();
    const files = workspace.allFiles();
    if (!needle) return files.slice(0, 12);
    return files.filter((path) => path.toLowerCase().includes(needle)).slice(0, 12);
  }, [paletteQuery, workspace, treeVersion]);

  const totalLines = activeTab ? activeTab.draft.split('\n').length : 0;
  const cursorLine = 1;
  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    if (!current || !items.length) return;
    const index = items.indexOf(current);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
    } else if (event.key === 'ArrowRight' && current.getAttribute('aria-expanded') === 'false') {
      event.preventDefault(); current.click();
    } else if (event.key === 'ArrowRight' && current.getAttribute('aria-expanded') === 'true') {
      event.preventDefault(); current.parentElement?.querySelector<HTMLElement>('[role="group"] [role="treeitem"]')?.focus();
    } else if (event.key === 'ArrowLeft' && current.getAttribute('aria-expanded') === 'true') {
      event.preventDefault(); current.click();
    } else if (event.key === 'ArrowLeft' && current.getAttribute('aria-expanded') === null) {
      event.preventDefault();
      const parentPath = current.dataset.path?.split('/').slice(0, -1).join('/') || '/workspace';
      event.currentTarget.querySelector<HTMLElement>(`[role="treeitem"][data-path="${parentPath}"]`)?.focus();
    } else if ((event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); current.click();
    }
  };
  const handleTabsKeyDown = (event: import('react').KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    if (!tabs.length) return;
    const current = tabs.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[index].focus();
    const path = tabs[index].dataset.path;
    if (path) setActivePath(path);
  };

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.length && !sessionModified) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty.length, sessionModified]);

  return (
    <div className="ide-root" data-surface="matrix-ide">
      <div className="ide-activity" role="toolbar" aria-label="IDE activity bar">
        <div className="ide-activity-brand" aria-hidden="true">◈</div>
        <button type="button" className="ide-activity-btn active" aria-label="Explorer" title="Explorer" onClick={() => setSidebarOpen(true)}>▤</button>
        <button type="button" className="ide-activity-btn" aria-label="Search files" title="Search files (Ctrl/Cmd+P)" onClick={() => { setPaletteOpen(true); setPaletteQuery(''); }}>⌕</button>
        <button type="button" className="ide-activity-btn" aria-label="Terminal" title="Toggle terminal (Ctrl/Cmd+`)" onClick={() => setTerminalOpen((value) => !value)}>▸_</button>
        <div className="ide-activity-spacer" />
        {onExit && (
          <button type="button" className="ide-activity-btn" aria-label="Exit to console" title="Exit to console" onClick={requestExit}>⏻</button>
        )}
      </div>

      {sidebarOpen && isMobile && (
        <button type="button" className="ide-sidebar-backdrop" aria-label="Close explorer" onClick={() => setSidebarOpen(false)} />
      )}
      {sidebarOpen && (
        <aside className="ide-sidebar" aria-label="Explorer">
          <div className="ide-sidebar-head">
            <span>EXPLORER</span>
            <div className="ide-sidebar-actions">
              <button type="button" title="New file" aria-label="New file" onClick={() => {
                let index = 1;
                let path = '/workspace/untitled.ts';
                while (workspace.has(path)) path = `/workspace/untitled-${++index}.ts`;
                workspace.write(path, '');
                setSessionModified(true);
                setTreeVersion((value) => value + 1);
                openFile(path);
              }}>＋</button>
              <button type="button" title="Collapse folders" aria-label="Collapse folders" onClick={() => setExpanded(new Set(['/workspace']))}>⊟</button>
            </div>
          </div>
          <div className="ide-workspace-label">
            <span className="ide-ws-dot" aria-hidden="true" />
            <span>RADARMATRIX</span>
            <em>virtual</em>
          </div>
          <div
            className="ide-tree"
            role="tree"
            aria-label="Workspace files"
            tabIndex={0}
            onFocus={(event) => {
              if (event.target === event.currentTarget) event.currentTarget.querySelector<HTMLElement>('[role="treeitem"]')?.focus();
            }}
            onKeyDown={handleTreeKeyDown}
          >
            {tree.children.map((child) => (
              <TreeRow
                key={child.path}
                node={child}
                depth={0}
                activePath={activePath}
                expanded={expanded}
                onToggle={(path) =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })
                }
                onOpen={openFile}
              />
            ))}
          </div>
          <div className="ide-sidebar-foot">
            <span>{workspace.allFiles().length} files</span>
            <span>{(workspace.size() / 1024).toFixed(1)} KB</span>
          </div>
        </aside>
      )}

      <section className="ide-main">
        <div className="ide-tabs" role="tablist" aria-label="Open editors" onKeyDown={handleTabsKeyDown}>
          {tabs.length === 0 && <div className="ide-tabs-empty">No open editors — pick a file in the explorer.</div>}
          {tabs.map((tab, index) => {
            const isDirty = tab.draft !== tab.saved;
            const isActive = tab.path === activePath;
            return (
              <div key={tab.path} className={`ide-tab ${isActive ? 'active' : ''}`}>
                <button
                  type="button"
                  id={`ide-tab-${index}`}
                  className="ide-tab-label"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="ide-editor-panel"
                  tabIndex={isActive ? 0 : -1}
                  data-path={tab.path}
                  onClick={() => setActivePath(tab.path)}
                  title={tab.path}
                >
                  <FileIcon name={basename(tab.path)} kind="file" />
                  <span>{basename(tab.path)}</span>
                  {isDirty && <i className="ide-dirty" aria-label="unsaved changes" />}
                </button>
                <button type="button" className="ide-tab-close" aria-label={`Close ${basename(tab.path)}`} onClick={() => closeTab(tab.path)}>×</button>
              </div>
            );
          })}
          <div className="ide-tabs-spacer" />
          <button type="button" className="ide-tab-action" title="Save (Ctrl/Cmd+S)" aria-label="Save file" onClick={saveActive} disabled={!activeTab}>⌘S</button>
        </div>

        <div className="ide-editor-area" id="ide-editor-panel" role="tabpanel" aria-labelledby={activePath ? `ide-tab-${tabs.findIndex((tab) => tab.path === activePath)}` : undefined}>
          {activeTab ? (
            <CodeEditor
              value={activeTab.draft}
              language={languageFor(activeTab.path)}
              onChange={updateDraft}
              onSave={saveActive}
              onRun={() => {
                setTerminalOpen(true);
                submitCommand('run test');
              }}
              ariaLabel={`Editor for ${activeTab.path}`}
            />
          ) : (
            <div className="ide-welcome">
              <div className="ide-welcome-mark" aria-hidden="true">◈</div>
              <h2>Matrix IDE</h2>
              <p>A VS Code-class workbench for RADARMatrix — editor, explorer and integrated terminal.</p>
              <div className="ide-welcome-keys">
                <div><kbd>Ctrl</kbd><kbd>P</kbd><span>Quick open a file</span></div>
                <div><kbd>Ctrl</kbd><kbd>`</kbd><span>Toggle the terminal</span></div>
                <div><kbd>Ctrl</kbd><kbd>S</kbd><span>Save to the virtual workspace</span></div>
              </div>
              <p className="ide-welcome-note">
                This workspace is browser-local and in-memory. Nothing is cloned, pushed or executed on a host.
              </p>
            </div>
          )}
        </div>

        {terminalOpen && (
          <div className="ide-terminal" aria-label="Integrated terminal">
            <div className="ide-terminal-head">
              <div className="ide-terminal-tabs">
                <span className="ide-terminal-tab active">TERMINAL</span>
                <span className="ide-terminal-tab">OUTPUT</span>
                <span className="ide-terminal-tab">PROBLEMS <em>0</em></span>
              </div>
              <div className="ide-terminal-actions">
                <button type="button" title="Clear terminal" aria-label="Clear terminal" onClick={() => setTerminalLines([])}>⌫</button>
                <button type="button" title="Hide terminal" aria-label="Hide terminal" onClick={() => setTerminalOpen(false)}>▾</button>
              </div>
            </div>
            <div className="ide-terminal-body" ref={terminalScroll} onClick={() => terminalInput.current?.focus()}>
              {terminalLines.map((line, index) => (
                <div key={index} className={`ide-term-line ${line.kind}`}>{line.text || '\u00a0'}</div>
              ))}
              <form
                className="ide-term-prompt"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCommand(command);
                  setCommand('');
                }}
              >
                <span className="ide-term-cwd">{cwd}</span>
                <span className="ide-term-sigil">$</span>
                <input
                  ref={terminalInput}
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      if (!history.length) return;
                      const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
                      setHistoryIndex(next);
                      setCommand(history[next]);
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      if (historyIndex === null) return;
                      const next = historyIndex + 1;
                      if (next >= history.length) {
                        setHistoryIndex(null);
                        setCommand('');
                      } else {
                        setHistoryIndex(next);
                        setCommand(history[next]);
                      }
                    }
                  }}
                  aria-label="Terminal command"
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  placeholder="Type a command…"
                />
              </form>
            </div>
          </div>
        )}

        <div className="ide-status">
          <div className="ide-status-left">
            <span className="ide-status-branch">⑂ virtual-workspace</span>
            <span className="ide-status-item">{dirty.length ? `${dirty.length} unsaved` : 'All changes saved'}</span>
            <span className="ide-status-item ide-status-warn">No remote · no process execution</span>
          </div>
          <div className="ide-status-right">
            {activeTab && <span className="ide-status-item">{languageLabel(languageFor(activeTab.path))}</span>}
            {activeTab && <span className="ide-status-item">Ln {cursorLine}, Col 1 · {totalLines} lines</span>}
            <span className="ide-status-item">UTF-8</span>
            <span className="ide-status-item">Spaces: 2</span>
          </div>
        </div>
      </section>

      {paletteOpen && (
        <div className="ide-palette-backdrop" role="presentation" onClick={() => setPaletteOpen(false)}>
          <div className="ide-palette" role="dialog" aria-modal="true" aria-label="Quick open" onClick={(event) => event.stopPropagation()}>
            <input
              ref={paletteInput}
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setPaletteOpen(false);
                if (event.key === 'Enter' && paletteResults[0]) {
                  openFile(paletteResults[0]);
                  setPaletteOpen(false);
                }
              }}
              placeholder="Search files by path…"
              aria-label="Search files by path"
            />
            <div className="ide-palette-list">
              {paletteResults.length === 0 && <div className="ide-palette-empty">No matching files.</div>}
              {paletteResults.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="ide-palette-item"
                  onClick={() => {
                    openFile(path);
                    setPaletteOpen(false);
                  }}
                >
                  <FileIcon name={basename(path)} kind="file" />
                  <span className="ide-palette-name">{basename(path)}</span>
                  <span className="ide-palette-path">{dirname(path)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {pendingAction && (
        <div className="ide-confirm-backdrop" role="presentation">
          <section className="ide-confirm" role="alertdialog" aria-modal="true" aria-labelledby="ide-confirm-title" aria-describedby="ide-confirm-copy">
            <h2 id="ide-confirm-title">Unsaved changes</h2>
            <p id="ide-confirm-copy">
              {pendingAction.type === 'exit'
                ? 'This virtual workspace is session-only. Exiting resets it to the seed files, including changes already saved in this session.'
                : 'This tab has unsaved editor changes.'}
            </p>
            <div className="ide-confirm-actions">
              {pendingAction.type === 'close-tab' ? (
                <>
                  <button type="button" autoFocus onClick={saveAndClosePendingTab}>Save and close</button>
                  <button type="button" onClick={discardPendingAction}>Discard changes</button>
                </>
              ) : (
                <button type="button" autoFocus onClick={discardPendingAction}>Discard session and exit</button>
              )}
              <button type="button" onClick={() => setPendingAction(null)}>Keep editing</button>
            </div>
          </section>
        </div>
      )}
      {toast && <div className="ide-toast" role="status">{toast}</div>}
    </div>
  );
}
