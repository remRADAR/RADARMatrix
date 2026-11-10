/**
 * Matrix IDE — virtual workspace.
 *
 * This is an in-memory, browser-local file system. It is deliberately NOT a
 * connection to a real repository, a remote host or a container: nothing here
 * reads or writes the user's disk, and nothing is persisted across reloads.
 * The IDE surface states that boundary in the UI; this module must never
 * pretend otherwise.
 *
 * The module is dependency-free and side-effect-free so it can be unit tested
 * directly (see tests/matrix-ide.test.mjs).
 */

export const WORKSPACE_ROOT = '/workspace';

export type EntryKind = 'file' | 'dir';

export interface WorkspaceEntry {
  path: string;
  name: string;
  kind: EntryKind;
}

export interface TreeNode {
  name: string;
  path: string;
  kind: EntryKind;
  children: TreeNode[];
}

function resolveWithinWorkspace(input: string, cwd: string): string {
  const raw = (input ?? '').trim();
  const parts = (raw.startsWith('/') ? [] : cwd.split('/').filter(Boolean));
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length <= 1) {
        throw new Error(`EPERM: path escapes ${WORKSPACE_ROOT}`);
      }
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (parts[0] !== 'workspace') {
    throw new Error(`EPERM: path must remain inside ${WORKSPACE_ROOT}`);
  }
  return `/${parts.join('/')}`;
}

/** Resolve against `cwd`, refusing traversal outside the virtual workspace. */
export function normalizePath(input: string, cwd: string = WORKSPACE_ROOT): string {
  const normalizedCwd = resolveWithinWorkspace(cwd, WORKSPACE_ROOT);
  if (!(normalizedCwd === WORKSPACE_ROOT || normalizedCwd.startsWith(`${WORKSPACE_ROOT}/`))) {
    throw new Error(`EPERM: current directory must remain inside ${WORKSPACE_ROOT}`);
  }
  return resolveWithinWorkspace(input || normalizedCwd, normalizedCwd);
}

export function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '/';
}

export function dirname(path: string): string {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
}

/** Map a file name to a CodeMirror language id. */
export function languageFor(path: string): string {
  const name = basename(path).toLowerCase();
  if (name.endsWith('.tsx')) return 'tsx';
  if (name.endsWith('.ts')) return 'ts';
  if (name.endsWith('.jsx')) return 'jsx';
  if (name.endsWith('.mjs') || name.endsWith('.cjs') || name.endsWith('.js')) return 'js';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.md')) return 'markdown';
  if (name.endsWith('.css')) return 'css';
  if (name.endsWith('.html')) return 'html';
  if (name.endsWith('.py')) return 'python';
  if (name.endsWith('.sh') || name.endsWith('.bash')) return 'shell';
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'yaml';
  return 'text';
}

export function languageLabel(language: string): string {
  switch (language) {
    case 'tsx':
      return 'TypeScript React';
    case 'ts':
      return 'TypeScript';
    case 'jsx':
      return 'JavaScript React';
    case 'js':
      return 'JavaScript';
    case 'json':
      return 'JSON';
    case 'markdown':
      return 'Markdown';
    case 'css':
      return 'CSS';
    case 'html':
      return 'HTML';
    case 'python':
      return 'Python';
    case 'shell':
      return 'Shell';
    case 'yaml':
      return 'YAML';
    default:
      return 'Plain text';
  }
}

export class VirtualWorkspace {
  private readonly files = new Map<string, string>();
  private readonly dirs = new Set<string>([WORKSPACE_ROOT]);
  cwd: string = WORKSPACE_ROOT;

  constructor(seed?: Record<string, string>) {
    if (seed) {
      for (const [path, content] of Object.entries(seed)) {
        this.write(path, content);
      }
    }
  }

  has(path: string): boolean {
    const target = normalizePath(path);
    return this.files.has(target) || this.dirs.has(target);
  }

  isFile(path: string): boolean {
    return this.files.has(normalizePath(path));
  }

  isDir(path: string): boolean {
    return this.dirs.has(normalizePath(path));
  }

  read(path: string): string | null {
    const value = this.files.get(normalizePath(path));
    return value === undefined ? null : value;
  }

  /** Create or overwrite a file, creating parent directories as needed. */
  write(path: string, content: string): void {
    const target = normalizePath(path);
    if (this.dirs.has(target)) {
      throw new Error(`EISDIR: ${target} is a directory`);
    }
    this.ensureDir(dirname(target));
    this.files.set(target, content);
  }

  /** Create a directory (recursively). */
  mkdir(path: string): void {
    this.ensureDir(normalizePath(path));
  }

  private ensureDir(path: string): void {
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += `/${part}`;
      this.dirs.add(current);
    }
  }

  /** Remove a file or a directory tree. Returns the removed paths. */
  remove(path: string): string[] {
    const target = normalizePath(path);
    if (target === WORKSPACE_ROOT) throw new Error('EPERM: cannot remove the workspace root');
    const removed: string[] = [];
    if (this.files.has(target)) {
      this.files.delete(target);
      removed.push(target);
      return removed;
    }
    if (!this.dirs.has(target)) throw new Error(`ENOENT: ${target} does not exist`);
    const prefix = `${target}/`;
    for (const file of [...this.files.keys()]) {
      if (file.startsWith(prefix)) {
        this.files.delete(file);
        removed.push(file);
      }
    }
    for (const dir of [...this.dirs]) {
      if (dir === target || dir.startsWith(prefix)) {
        this.dirs.delete(dir);
        removed.push(dir);
      }
    }
    return removed;
  }

  /** Direct children of a directory, directories first then files. */
  list(path: string): WorkspaceEntry[] {
    const target = normalizePath(path);
    if (this.files.has(target)) {
      return [{ path: target, name: basename(target), kind: 'file' }];
    }
    if (!this.dirs.has(target)) throw new Error(`ENOENT: ${target} does not exist`);
    const prefix = target === '/' ? '/' : `${target}/`;
    const entries = new Map<string, WorkspaceEntry>();
    for (const dir of this.dirs) {
      if (dir === target || !dir.startsWith(prefix)) continue;
      const rest = dir.slice(prefix.length);
      if (!rest || rest.includes('/')) continue;
      entries.set(dir, { path: dir, name: rest, kind: 'dir' });
    }
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      if (!rest || rest.includes('/')) continue;
      entries.set(file, { path: file, name: rest, kind: 'file' });
    }
    return [...entries.values()].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  /** Every file path in the workspace, sorted. */
  allFiles(): string[] {
    return [...this.files.keys()].sort();
  }

  /** Nested tree rooted at `path`. */
  tree(path: string = WORKSPACE_ROOT): TreeNode {
    const target = normalizePath(path);
    const node: TreeNode = { name: basename(target), path: target, kind: 'dir', children: [] };
    for (const entry of this.list(target)) {
      node.children.push(
        entry.kind === 'dir'
          ? this.tree(entry.path)
          : { name: entry.name, path: entry.path, kind: 'file', children: [] },
      );
    }
    return node;
  }

  /** Total bytes stored (UTF-8 length approximation via string length). */
  size(): number {
    let total = 0;
    for (const content of this.files.values()) total += content.length;
    return total;
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}

const SEED: Record<string, string> = {
  '/workspace/README.md': `# RADARMatrix

The operating environment for RADAR: agents, skills, tasks and the Matrix IDE.

## Surfaces

- **RADAR Chat** — conversation and plan preview
- **Agent Network** — specialist profiles
- **Skills Library** — the Vibe Queue registry
- **Matrix IDE** — repository workbench (this surface)

> The IDE runs against a **browser-local virtual workspace**. It does not
> clone, push or execute anything on a remote host.
`,
  '/workspace/package.json': `{
  "name": "radarmatrix",
  "version": "0.8.0",
  "type": "module",
  "scripts": {
    "test": "node tests/test-runner.mjs",
    "build:matrix-console": "npm --prefix apps/matrix-console run build"
  }
}
`,
  '/workspace/.gitignore': `node_modules/
dist/
*.log
.data/
`,
  '/workspace/src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
  '/workspace/src/App.tsx': `import { useState } from 'react';
import { MatrixIDE } from './ide/MatrixIDE';

type Screen = 'overview' | 'ide';

export function App() {
  const [screen, setScreen] = useState<Screen>('overview');

  if (screen === 'ide') return <MatrixIDE onExit={() => setScreen('overview')} />;

  return (
    <main className="shell">
      <h1>RADARMatrix</h1>
      <button onClick={() => setScreen('ide')}>Open Matrix IDE</button>
    </main>
  );
}
`,
  '/workspace/src/ide/workspace.ts': `export const WORKSPACE_ROOT = '/workspace';

export function normalizePath(input: string, cwd = WORKSPACE_ROOT): string {
  const raw = input.trim();
  if (!raw) return cwd;
  const base = raw.startsWith('/') ? '' : cwd;
  const stack: string[] = [];
  for (const segment of \`\${base}/\${raw}\`.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { stack.pop(); continue; }
    stack.push(segment);
  }
  return \`/\${stack.join('/')}\`;
}
`,
  '/workspace/src/ide/terminal.ts': `export interface TerminalResult {
  lines: string[];
  cwd: string;
  exitCode: number;
}

export function runCommand(workspace: unknown, input: string): TerminalResult {
  const trimmed = input.trim();
  if (!trimmed) return { lines: [], cwd: '/workspace', exitCode: 0 };
  return { lines: [\`\${trimmed}: command not found\`], cwd: '/workspace', exitCode: 127 };
}
`,
  '/workspace/tests/matrix-ide.test.mjs': `import { VirtualWorkspace } from '../src/ide/workspace.ts';

const workspace = new VirtualWorkspace({ '/workspace/a.txt': 'hello' });
console.log(workspace.read('/workspace/a.txt'));
`,
  '/workspace/docs/MATRIX-IDE.md': `# Matrix IDE

A VS Code-class workbench surface inside the Matrix Console.

## What is real

- A CodeMirror 6 editor with syntax highlighting, search, folding and
  multi-cursor editing.
- A file tree, tabs, dirty-state tracking and save-to-workspace.
- An integrated terminal that interprets commands against the same virtual
  workspace the editor is editing.

## What is not real

- No remote repository, no clone/push, no container, no process execution.
- Nothing persists across a page reload.

The surface labels this boundary in the status bar and in the terminal banner.
`,
};

/** A fresh workspace seeded with a small, realistic RADARMatrix tree. */
export function createSeedWorkspace(): VirtualWorkspace {
  return new VirtualWorkspace(SEED);
}
