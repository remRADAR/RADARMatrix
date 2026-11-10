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
      <div className="ide-tree-branch">
        <button
          type="button"
          className="ide-tree-row ide-tree-dir"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => onToggle(node.path)}
          aria-expanded={isOpen}
        >
          <span className={`ide-caret ${isOpen ? 'open' : ''}`} aria-hidden="true">▸</span>
          <FileIcon name={node.name} kind="dir" />
          <span className="ide-tree-label">{node.name}</span>
        </button>
        {isOpen && node.children.map((child) => (
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
    );
  }
  return (
    <button
      type="button"
      className={`ide-tree-row ide-tree-file ${isActive ? 'active' : ''}`}
      style={{ paddingLeft: `${8 + depth * 12 + 14}px` }}
      onClick={() => onOpen(node.path)}
      title={node.path}
    >
      <FileIcon name={node.name} kind="file" />
      <span className="ide-tree-label">{node.name}</span>
    </button>
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');

  const terminalScroll = useRef<HTMLDivElement | null>(null);
  const terminalInput = useRef<HTMLInputElement | null>(null);

  const tree = useMemo(() => workspace.tree('/workspace'), [workspace, treeVersion]);
  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
  const dirty = tabs.filter((tab) => tab.draft !== tab.saved);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2200);
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
    flash(`Saved ${basename(activeTab.path)} to the virtual workspace`);
  }, [activeTab, workspace, flash]);

  const closeTab = useCallback(
    (path: string) => {
      setTabs((current) => {
        const index = current.findIndex((tab) => tab.path === path);
        const next = current.filter((tab) => tab.path !== path);
        if (activePath === path) {
          const fallback = next[Math.min(index, next.length - 1)];
          setActivePath(fallback ? fallback.path : null);
        }
        return next;
      });
    },
    [activePath],
  );

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
      setTreeVersion((value) => value + 1);
    },
    [workspace, cwd, history, appendTerminal],
  );

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

  return (
    <div className="ide-root" data-surface="matrix-ide">
      <div className="ide-activity" role="toolbar" aria-label="IDE activity bar">
        <div className="ide-activity-brand" aria-hidden="true">◈</div>
        <button type="button" className="ide-activity-btn active" aria-label="Explorer" title="Explorer" onClick={() => setSidebarOpen(true)}>▤</button>
        <button type="button" className="ide-activity-btn" aria-label="Search files" title="Search files (Ctrl/Cmd+P)" onClick={() => { setPaletteOpen(true); setPaletteQuery(''); }}>⌕</button>
        <button type="button" className="ide-activity-btn" aria-label="Terminal" title="Toggle terminal (Ctrl/Cmd+`)" onClick={() => setTerminalOpen((value) => !value)}>▸_</button>
        <div className="ide-activity-spacer" />
        {onExit && (
          <button type="button" className="ide-activity-btn" aria-label="Exit to console" title="Exit to console" onClick={onExit}>⏻</button>
        )}
      </div>

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
          <div className="ide-tree" role="tree" aria-label="Workspace files">
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
        <div className="ide-tabs" role="tablist" aria-label="Open editors">
          {tabs.length === 0 && <div className="ide-tabs-empty">No open editors — pick a file in the explorer.</div>}
          {tabs.map((tab) => {
            const isDirty = tab.draft !== tab.saved;
            return (
              <div
                key={tab.path}
                className={`ide-tab ${tab.path === activePath ? 'active' : ''}`}
                role="tab"
                aria-selected={tab.path === activePath}
              >
                <button type="button" className="ide-tab-label" onClick={() => setActivePath(tab.path)} title={tab.path}>
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

        <div className="ide-editor-area">
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
          <div className="ide-palette" role="dialog" aria-label="Quick open" onClick={(event) => event.stopPropagation()}>
            <input
              autoFocus
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

      {toast && <div className="ide-toast" role="status">{toast}</div>}
    </div>
  );
}
