/**
 * Matrix IDE — integrated terminal.
 *
 * A small, deterministic command interpreter that operates on the SAME
 * VirtualWorkspace the editor is editing. It is not a shell: it never spawns a
 * process, never touches the host, and never reaches the network. Every
 * command is implemented in-process against the virtual file system.
 *
 * Supported: help, pwd, ls, cd, cat, head, tail, wc, mkdir, touch, rm, mv, cp,
 * echo, grep, find, tree, stat, clear, date, whoami, uname, env, history,
 * open, edit, save, run (test/build simulation), git (status/log/branch).
 *
 * Anything else returns exit code 127 with an explicit "not available in the
 * virtual workspace" message — the terminal never pretends to have executed
 * something it did not.
 */

import { basename, dirname, normalizePath, VirtualWorkspace } from './workspace';

export interface TerminalResult {
  lines: string[];
  cwd: string;
  exitCode: number;
  /** When set, the UI should clear the scrollback before appending `lines`. */
  clear?: boolean;
  /** When set, the UI should open this file in the editor. */
  openPath?: string;
}

export interface TerminalContext {
  workspace: VirtualWorkspace;
  cwd: string;
  history: string[];
  /** Called by `run` so the UI can surface a simulated task result. */
  onRun?: (task: string) => string[];
}

const HELP = [
  'Matrix IDE terminal — virtual workspace commands',
  '',
  '  Navigation   pwd · cd <dir> · ls [-l] [path] · tree [path] · find <pattern>',
  '  Files        cat <file> · head <file> · tail <file> · wc <file> · stat <file>',
  '  Modify       mkdir <dir> · touch <file> · rm [-r] <path> · mv <a> <b> · cp <a> <b>',
  '  Search       grep <pattern> <file…>',
  '  Editor       open <file> · edit <file> · save',
  '  Project      run test · run build · git status · git log · git branch',
  '  Session      clear · history · date · whoami · uname · env · help',
  '',
  'This terminal is bound to the browser-local virtual workspace. It does not',
  'spawn processes, reach the network, or persist across a reload.',
];

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function fail(message: string, cwd: string): TerminalResult {
  return { lines: [message], cwd, exitCode: 1 };
}

function runCommandUnchecked(context: TerminalContext, input: string): TerminalResult {
  const { workspace } = context;
  const cwd = context.cwd;
  const tokens = tokenize(input);
  if (!tokens.length) return { lines: [], cwd, exitCode: 0 };

  const [command, ...args] = tokens;
  const resolve = (value: string) => normalizePath(value, cwd);

  switch (command) {
    case 'help':
      return { lines: HELP, cwd, exitCode: 0 };

    case 'clear':
      return { lines: [], cwd, exitCode: 0, clear: true };

    case 'pwd':
      return { lines: [cwd], cwd, exitCode: 0 };

    case 'whoami':
      return { lines: ['radar-operator'], cwd, exitCode: 0 };

    case 'date':
      return { lines: [new Date().toUTCString()], cwd, exitCode: 0 };

    case 'uname':
      return {
        lines: ['RADARMatrix virtual workspace (browser) — no host kernel is attached'],
        cwd,
        exitCode: 0,
      };

    case 'env':
      return {
        lines: [
          'WORKSPACE=/workspace',
          'WORKSPACE_MODE=virtual',
          'PERSISTENCE=none',
          'NETWORK=disabled',
          'PROCESS_EXECUTION=disabled',
        ],
        cwd,
        exitCode: 0,
      };

    case 'history':
      return {
        lines: context.history.map((entry, index) => `${String(index + 1).padStart(3)}  ${entry}`),
        cwd,
        exitCode: 0,
      };

    case 'ls': {
      const long = args.includes('-l') || args.includes('-la') || args.includes('-al');
      const target = resolve(args.filter((arg) => !arg.startsWith('-'))[0] ?? '.');
      if (!workspace.has(target)) return fail(`ls: ${target}: No such file or directory`, cwd);
      if (workspace.isFile(target)) {
        const content = workspace.read(target) ?? '';
        return { lines: [long ? `-rw-r--r--  ${pad(humanSize(content.length), 6)}  ${basename(target)}` : basename(target)], cwd, exitCode: 0 };
      }
      const entries = workspace.list(target);
      if (!entries.length) return { lines: [], cwd, exitCode: 0 };
      if (!long) {
        return { lines: [entries.map((entry) => (entry.kind === 'dir' ? `${entry.name}/` : entry.name)).join('  ')], cwd, exitCode: 0 };
      }
      return {
        lines: entries.map((entry) => {
          const content = entry.kind === 'file' ? workspace.read(entry.path) ?? '' : '';
          const mode = entry.kind === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
          const size = entry.kind === 'dir' ? '-' : humanSize(content.length);
          return `${mode}  ${pad(size, 6)}  ${entry.kind === 'dir' ? `${entry.name}/` : entry.name}`;
        }),
        cwd,
        exitCode: 0,
      };
    }

    case 'cd': {
      const target = resolve(args[0] ?? '/workspace');
      if (!workspace.isDir(target)) return fail(`cd: ${target}: Not a directory`, cwd);
      return { lines: [], cwd: target, exitCode: 0 };
    }

    case 'cat': {
      if (!args.length) return fail('cat: missing file operand', cwd);
      const lines: string[] = [];
      for (const arg of args) {
        const target = resolve(arg);
        const content = workspace.read(target);
        if (content === null) return fail(`cat: ${target}: No such file`, cwd);
        lines.push(...content.replace(/\n$/, '').split('\n'));
      }
      return { lines, cwd, exitCode: 0 };
    }

    case 'head':
    case 'tail': {
      const target = resolve(args[0] ?? '');
      const content = workspace.read(target);
      if (content === null) return fail(`${command}: ${target}: No such file`, cwd);
      const all = content.replace(/\n$/, '').split('\n');
      const slice = command === 'head' ? all.slice(0, 10) : all.slice(-10);
      return { lines: slice, cwd, exitCode: 0 };
    }

    case 'wc': {
      const target = resolve(args[0] ?? '');
      const content = workspace.read(target);
      if (content === null) return fail(`wc: ${target}: No such file`, cwd);
      const lines = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
      const words = content.split(/\s+/).filter(Boolean).length;
      return { lines: [`${pad(String(lines), 5)} ${pad(String(words), 6)} ${pad(String(content.length), 7)} ${basename(target)}`], cwd, exitCode: 0 };
    }

    case 'stat': {
      const target = resolve(args[0] ?? '');
      if (!workspace.has(target)) return fail(`stat: ${target}: No such file or directory`, cwd);
      const kind = workspace.isDir(target) ? 'directory' : 'regular file';
      const size = workspace.isFile(target) ? (workspace.read(target) ?? '').length : 0;
      return {
        lines: [
          `  File: ${target}`,
          `  Type: ${kind}`,
          `  Size: ${size} bytes`,
          '  Mode: virtual (browser-local, not persisted)',
        ],
        cwd,
        exitCode: 0,
      };
    }

    case 'mkdir': {
      const targets = args.filter((arg) => !arg.startsWith('-'));
      if (!targets.length) return fail('mkdir: missing operand', cwd);
      for (const target of targets) workspace.mkdir(resolve(target));
      return { lines: [], cwd, exitCode: 0 };
    }

    case 'touch': {
      if (!args.length) return fail('touch: missing file operand', cwd);
      for (const arg of args) {
        const target = resolve(arg);
        if (!workspace.isFile(target)) workspace.write(target, '');
      }
      return { lines: [], cwd, exitCode: 0 };
    }

    case 'rm': {
      const recursive = args.some((arg) => arg.startsWith('-') && arg.includes('r'));
      const targets = args.filter((arg) => !arg.startsWith('-'));
      if (!targets.length) return fail('rm: missing operand', cwd);
      for (const arg of targets) {
        const target = resolve(arg);
        if (!workspace.has(target)) return fail(`rm: ${target}: No such file or directory`, cwd);
        if (workspace.isDir(target) && !recursive) {
          return fail(`rm: ${target}: is a directory (use rm -r)`, cwd);
        }
        workspace.remove(target);
      }
      return { lines: [], cwd, exitCode: 0 };
    }

    case 'mv':
    case 'cp': {
      if (args.length < 2) return fail(`${command}: missing destination operand`, cwd);
      const source = resolve(args[0]);
      const destination = resolve(args[1]);
      const content = workspace.read(source);
      if (content === null) return fail(`${command}: ${source}: No such file`, cwd);
      const finalPath = workspace.isDir(destination) ? `${destination}/${basename(source)}` : destination;
      workspace.write(finalPath, content);
      if (command === 'mv') workspace.remove(source);
      return { lines: [], cwd, exitCode: 0 };
    }

    case 'echo': {
      const text = args.join(' ');
      if (text.startsWith('>')) return fail('echo: redirection is not supported in the virtual workspace', cwd);
      return { lines: [text], cwd, exitCode: 0 };
    }

    case 'grep': {
      if (args.length < 2) return fail('grep: usage: grep <pattern> <file…>', cwd);
      const [pattern, ...files] = args;
      const lines: string[] = [];
      let matched = false;
      for (const file of files) {
        const target = resolve(file);
        const content = workspace.read(target);
        if (content === null) return fail(`grep: ${target}: No such file`, cwd);
        content.split('\n').forEach((line, index) => {
          if (line.toLowerCase().includes(pattern.toLowerCase())) {
            matched = true;
            lines.push(files.length > 1 ? `${basename(target)}:${index + 1}: ${line}` : `${index + 1}: ${line}`);
          }
        });
      }
      return { lines, cwd, exitCode: matched ? 0 : 1 };
    }

    case 'find': {
      const pattern = (args[0] ?? '').replace(/^['"]|['"]$/g, '');
      if (!pattern) return fail('find: usage: find <pattern>', cwd);
      const needle = pattern.toLowerCase();
      const matches = workspace.allFiles().filter((path) => path.toLowerCase().includes(needle));
      return { lines: matches.length ? matches : [`find: no files matching "${pattern}"`], cwd, exitCode: matches.length ? 0 : 1 };
    }

    case 'tree': {
      const root = resolve(args[0] ?? '.');
      if (!workspace.isDir(root)) return fail(`tree: ${root}: Not a directory`, cwd);
      const lines: string[] = [root];
      const walk = (path: string, prefix: string) => {
        const entries = workspace.list(path);
        entries.forEach((entry, index) => {
          const last = index === entries.length - 1;
          lines.push(`${prefix}${last ? '└── ' : '├── '}${entry.name}${entry.kind === 'dir' ? '/' : ''}`);
          if (entry.kind === 'dir') walk(entry.path, `${prefix}${last ? '    ' : '│   '}`);
        });
      };
      walk(root, '');
      return { lines, cwd, exitCode: 0 };
    }

    case 'open':
    case 'edit': {
      const target = resolve(args[0] ?? '');
      if (!workspace.isFile(target)) return fail(`${command}: ${target}: No such file`, cwd);
      return { lines: [`Opened ${target} in the editor`], cwd, exitCode: 0, openPath: target };
    }

    case 'save':
      return { lines: ['The editor saves to the virtual workspace automatically (Ctrl/Cmd+S).'], cwd, exitCode: 0 };

    case 'run': {
      const task = args[0] ?? '';
      if (task !== 'test' && task !== 'build') {
        return fail('run: usage: run test | run build', cwd);
      }
      const lines = context.onRun?.(task) ?? [];
      return { lines, cwd, exitCode: 0 };
    }

    case 'git': {
      const sub = args[0] ?? '';
      if (sub === 'status') {
        return {
          lines: [
            'On branch virtual-workspace',
            'No remote is attached — this workspace is browser-local.',
            '',
            'nothing to commit (the virtual workspace is not a git repository)',
          ],
          cwd,
          exitCode: 0,
        };
      }
      if (sub === 'log') {
        return {
          lines: [
            'commit 91d9517  feat: add RADARMatrix console and staging deployment',
            'commit 93c1dc1  feat: add RADAR agent routing and preview panels',
            'commit 6457271  docs: retire old Supabase project reference',
            '',
            '(read-only history shown for context; no repository is attached)',
          ],
          cwd,
          exitCode: 0,
        };
      }
      if (sub === 'branch') {
        return { lines: ['* virtual-workspace', '  main (read-only reference)'], cwd, exitCode: 0 };
      }
      return fail(`git: '${sub || '(none)'}' is not available — no repository is attached to this workspace`, cwd);
    }

    default:
      return {
        lines: [
          `${command}: command not found — this terminal is bound to the virtual workspace and cannot execute host commands`,
        ],
        cwd,
        exitCode: 127,
      };
  }
}

export function runCommand(context: TerminalContext, input: string): TerminalResult {
  try {
    normalizePath('.', context.cwd);
    return runCommandUnchecked(context, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(message, context.cwd);
  }
}

/** Convenience for the UI: run a command and return the next terminal state. */
export function execute(context: TerminalContext, input: string): TerminalResult {
  return runCommand(context, input);
}

export { tokenize, dirname };
