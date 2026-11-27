/**
 * Matrix IDE — workspace + terminal regression suite.
 *
 * The IDE modules are TypeScript. Node 20 cannot strip types, so this suite
 * bundles the two dependency-free modules with the project's own bundler
 * (rolldown, already a devDependency of the console app) into a temp directory
 * and imports the emitted ESM. That keeps the suite honest: it exercises the
 * REAL source, not a re-implementation.
 *
 * Run standalone:  node tests/matrix-ide.test.mjs
 * Exit code is non-zero on any failure.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const consoleRoot = join(here, '..', 'apps', 'matrix-console');

// `rolldown` is a devDependency of the console app, not of the repo root.
// Resolve it from there so the suite works from either install layout.
const requireFromConsole = createRequire(join(consoleRoot, 'package.json'));
const { build } = requireFromConsole('rolldown');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push({ name, message: error?.message ?? String(error) });
    console.log(`  \u2717 ${name}`);
    console.log(`      ${error?.message ?? error}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n      expected: ${e}\n      actual:   ${a}`);
}

/** Bundle the IDE modules to ESM in a temp dir and import them. */
async function loadIdeModules() {
  const outDir = mkdtempSync(join(tmpdir(), 'matrix-ide-'));
  await build({
    input: join(consoleRoot, 'src', 'ide', 'workspace.ts'),
    output: { dir: outDir, format: 'esm', entryFileNames: '[name].mjs' },
  });
  await build({
    input: join(consoleRoot, 'src', 'ide', 'terminal.ts'),
    output: { dir: outDir, format: 'esm', entryFileNames: '[name].mjs' },
  });
  const workspaceModule = await import(pathToFileURL(join(outDir, 'workspace.mjs')).href);
  const terminalModule = await import(pathToFileURL(join(outDir, 'terminal.mjs')).href);
  return { workspaceModule, terminalModule, cleanup: () => rmSync(outDir, { recursive: true, force: true }) };
}

export async function runAllTests() {
  passed = 0;
  failures.length = 0;

  const { workspaceModule, terminalModule, cleanup } = await loadIdeModules();
  const {
    VirtualWorkspace,
    createSeedWorkspace,
    normalizePath,
    basename,
    dirname: dirName,
    languageFor,
    languageLabel,
    WORKSPACE_ROOT,
  } = workspaceModule;
  const { runCommand, tokenize } = terminalModule;

  console.log('\n\u25b6 Matrix IDE \u2014 workspace\n');

  check('WORKSPACE_ROOT is /workspace', () => assertEqual(WORKSPACE_ROOT, '/workspace', 'root'));

  check('normalizePath collapses . and ..', () => {
    assertEqual(normalizePath('src/./ide/../ide/MatrixIDE.tsx'), '/workspace/src/ide/MatrixIDE.tsx', 'relative');
    assertEqual(normalizePath('/a/b/../../c'), '/c', 'absolute with ..');
    assertEqual(normalizePath('', '/workspace/src'), '/workspace/src', 'empty keeps cwd');
    assertEqual(normalizePath('..', '/workspace/src'), '/workspace', 'parent of cwd');
  });

  check('basename / dirname', () => {
    assertEqual(basename('/workspace/src/App.tsx'), 'App.tsx', 'basename');
    assertEqual(dirName('/workspace/src/App.tsx'), '/workspace/src', 'dirname');
    assertEqual(dirName('/App.tsx'), '/', 'dirname at root');
  });

  check('languageFor maps extensions', () => {
    assertEqual(languageFor('/a/b.tsx'), 'tsx', 'tsx');
    assertEqual(languageFor('/a/b.ts'), 'ts', 'ts');
    assertEqual(languageFor('/a/b.mjs'), 'js', 'mjs');
    assertEqual(languageFor('/a/b.json'), 'json', 'json');
    assertEqual(languageFor('/a/b.md'), 'markdown', 'md');
    assertEqual(languageFor('/a/b.css'), 'css', 'css');
    assertEqual(languageFor('/a/b.sh'), 'shell', 'sh');
    assertEqual(languageFor('/a/b.unknown'), 'text', 'fallback');
  });

  check('languageLabel is human readable', () => {
    assertEqual(languageLabel('tsx'), 'TypeScript React', 'tsx label');
    assertEqual(languageLabel('text'), 'Plain text', 'text label');
  });

  check('write creates parent directories', () => {
    const ws = new VirtualWorkspace();
    ws.write('/workspace/a/b/c.txt', 'hi');
    assert(ws.isDir('/workspace/a'), 'a created');
    assert(ws.isDir('/workspace/a/b'), 'b created');
    assertEqual(ws.read('/workspace/a/b/c.txt'), 'hi', 'content');
  });

  check('write refuses to overwrite a directory', () => {
    const ws = new VirtualWorkspace();
    ws.mkdir('/workspace/dir');
    let threw = false;
    try {
      ws.write('/workspace/dir', 'x');
    } catch (error) {
      threw = /EISDIR/.test(error.message);
    }
    assert(threw, 'expected EISDIR');
  });

  check('list returns directories before files, sorted', () => {
    const ws = new VirtualWorkspace({
      '/workspace/z.txt': '',
      '/workspace/a.txt': '',
      '/workspace/mid/x.txt': '',
    });
    const names = ws.list('/workspace').map((entry) => `${entry.kind}:${entry.name}`);
    assertEqual(names, ['dir:mid', 'file:a.txt', 'file:z.txt'], 'ordering');
  });

  check('remove deletes a directory tree', () => {
    const ws = new VirtualWorkspace({ '/workspace/d/a.txt': '1', '/workspace/d/e/b.txt': '2', '/workspace/keep.txt': '3' });
    const removed = ws.remove('/workspace/d');
    assert(removed.length >= 4, `removed ${removed.length} paths`);
    assert(!ws.has('/workspace/d'), 'dir gone');
    assert(!ws.has('/workspace/d/e/b.txt'), 'nested file gone');
    assert(ws.isFile('/workspace/keep.txt'), 'sibling kept');
  });

  check('remove refuses the workspace root', () => {
    const ws = new VirtualWorkspace();
    let threw = false;
    try {
      ws.remove('/workspace');
    } catch (error) {
      threw = /EPERM/.test(error.message);
    }
    assert(threw, 'expected EPERM');
  });

  check('tree nests children', () => {
    const ws = new VirtualWorkspace({ '/workspace/src/a.ts': '', '/workspace/docs/b.md': '' });
    const tree = ws.tree('/workspace');
    const names = tree.children.map((child) => `${child.kind}:${child.name}`);
    assertEqual(names, ['dir:docs', 'dir:src'], 'top level');
    const src = tree.children.find((child) => child.name === 'src');
    assertEqual(src.children.map((child) => child.name), ['a.ts'], 'src children');
  });

  check('seed workspace is realistic and non-empty', () => {
    const ws = createSeedWorkspace();
    const files = ws.allFiles();
    assert(files.length >= 8, `expected >= 8 seed files, got ${files.length}`);
    assert(files.includes('/workspace/README.md'), 'README present');
    assert(files.includes('/workspace/src/App.tsx'), 'App.tsx present');
    assert(files.includes('/workspace/src/ide/workspace.ts'), 'workspace.ts present');
    assert(ws.size() > 500, 'seed has content');
  });

  check('seed workspace is isolated per instance', () => {
    const a = createSeedWorkspace();
    const b = createSeedWorkspace();
    a.write('/workspace/README.md', 'mutated');
    assertEqual(b.read('/workspace/README.md')?.startsWith('# RADARMatrix'), true, 'b untouched');
  });

  console.log('\n\u25b6 Matrix IDE \u2014 terminal\n');

  function makeContext(seed) {
    const workspace = new VirtualWorkspace(seed ?? {
      '/workspace/README.md': '# Title\nline two\nline three\n',
      '/workspace/src/a.ts': 'export const a = 1;\n',
      '/workspace/src/b.ts': 'export const b = 2;\n',
    });
    return { workspace, cwd: '/workspace', history: [] };
  }

  check('tokenize respects quotes', () => {
    assertEqual(tokenize('grep "hello world" file.txt'), ['grep', 'hello world', 'file.txt'], 'double quotes');
    assertEqual(tokenize("echo 'a b'"), ['echo', 'a b'], 'single quotes');
    assertEqual(tokenize('  ls   -l  '), ['ls', '-l'], 'whitespace');
  });

  check('pwd returns cwd', () => {
    const ctx = makeContext();
    assertEqual(runCommand(ctx, 'pwd').lines, ['/workspace'], 'pwd');
  });

  check('ls lists entries with trailing slash for dirs', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'ls');
    assertEqual(result.exitCode, 0, 'exit 0');
    assert(result.lines[0].includes('src/'), 'dir marked');
    assert(result.lines[0].includes('README.md'), 'file listed');
  });

  check('ls -l shows mode and size', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'ls -l /workspace');
    assert(result.lines.some((line) => line.startsWith('-rw-r--r--')), 'file mode');
    assert(result.lines.some((line) => line.startsWith('drwxr-xr-x')), 'dir mode');
  });

  check('cd changes cwd and rejects non-directories', () => {
    const ctx = makeContext();
    const moved = runCommand(ctx, 'cd src');
    assertEqual(moved.cwd, '/workspace/src', 'cwd moved');
    const bad = runCommand({ ...ctx, cwd: moved.cwd }, 'cd README.md');
    assertEqual(bad.exitCode, 1, 'file is not a directory');
  });

  check('cat prints file content', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'cat README.md');
    assertEqual(result.lines, ['# Title', 'line two', 'line three'], 'content');
  });

  check('cat on a missing file fails', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'cat nope.txt');
    assertEqual(result.exitCode, 1, 'exit 1');
    assert(result.lines[0].includes('No such file'), 'message');
  });

  check('head and tail slice ten lines', () => {
    const long = Array.from({ length: 20 }, (_, index) => `l${index + 1}`).join('\n');
    const ctx = makeContext({ '/workspace/long.txt': long });
    assertEqual(runCommand(ctx, 'head long.txt').lines.length, 10, 'head 10');
    assertEqual(runCommand(ctx, 'head long.txt').lines[0], 'l1', 'head first');
    assertEqual(runCommand(ctx, 'tail long.txt').lines[0], 'l11', 'tail first');
    assertEqual(runCommand(ctx, 'tail long.txt').lines[9], 'l20', 'tail last');
  });

  check('wc counts lines, words and bytes', () => {
    const ctx = makeContext({ '/workspace/w.txt': 'a b\nc d\n' });
    const result = runCommand(ctx, 'wc w.txt');
    assert(/^\s*2\s+4\s+8\s+w\.txt$/.test(result.lines[0]), `unexpected: ${result.lines[0]}`);
  });

  check('mkdir creates nested directories', () => {
    const ctx = makeContext();
    runCommand(ctx, 'mkdir deep/nested/dir');
    assert(ctx.workspace.isDir('/workspace/deep/nested/dir'), 'created');
  });

  check('touch creates an empty file', () => {
    const ctx = makeContext();
    runCommand(ctx, 'touch new.txt');
    assertEqual(ctx.workspace.read('/workspace/new.txt'), '', 'empty file');
  });

  check('rm requires -r for directories', () => {
    const ctx = makeContext();
    const refused = runCommand(ctx, 'rm src');
    assertEqual(refused.exitCode, 1, 'refused');
    const removed = runCommand(ctx, 'rm -r src');
    assertEqual(removed.exitCode, 0, 'removed');
    assert(!ctx.workspace.has('/workspace/src'), 'gone');
  });

  check('cp copies and mv moves', () => {
    const ctx = makeContext();
    runCommand(ctx, 'cp README.md copy.md');
    assertEqual(ctx.workspace.read('/workspace/copy.md'), ctx.workspace.read('/workspace/README.md'), 'copied');
    runCommand(ctx, 'mv copy.md moved.md');
    assert(!ctx.workspace.has('/workspace/copy.md'), 'source gone');
    assert(ctx.workspace.isFile('/workspace/moved.md'), 'destination present');
  });

  check('grep finds matches case-insensitively and reports line numbers', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'grep title README.md');
    assertEqual(result.exitCode, 0, 'match exit 0');
    assertEqual(result.lines, ['1: # Title'], 'line number + text');
    const miss = runCommand(ctx, 'grep zzz README.md');
    assertEqual(miss.exitCode, 1, 'no match exit 1');
  });

  check('find matches by path substring', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'find .ts');
    assertEqual(result.lines, ['/workspace/src/a.ts', '/workspace/src/b.ts'], 'matches');
  });

  check('tree renders a nested structure', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'tree');
    assertEqual(result.lines[0], '/workspace', 'root line');
    assert(result.lines.some((line) => line.includes('src/')), 'dir line');
    assert(result.lines.some((line) => line.includes('a.ts')), 'file line');
  });

  check('open returns an openPath for the UI', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'open src/a.ts');
    assertEqual(result.openPath, '/workspace/src/a.ts', 'openPath');
  });

  check('open on a missing file fails', () => {
    const ctx = makeContext();
    assertEqual(runCommand(ctx, 'open nope.ts').exitCode, 1, 'exit 1');
  });

  check('clear signals the UI to reset scrollback', () => {
    const ctx = makeContext();
    assertEqual(runCommand(ctx, 'clear').clear, true, 'clear flag');
  });

  check('unknown commands fail closed with exit 127', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'sudo rm -rf /');
    assertEqual(result.exitCode, 127, 'exit 127');
    assert(result.lines[0].includes('command not found'), 'message');
    assert(result.lines[0].includes('virtual workspace'), 'states the boundary');
  });

  check('git status is honest about having no repository', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'git status');
    assert(result.lines.some((line) => line.includes('No remote is attached')), 'no remote');
    assert(result.lines.some((line) => line.includes('not a git repository')), 'not a repo');
  });

  check('git push is refused', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'git push origin main');
    assertEqual(result.exitCode, 1, 'exit 1');
    assert(result.lines[0].includes('no repository is attached'), 'message');
  });

  check('run test is simulated and says so', () => {
    const ctx = makeContext();
    const result = runCommand({ ...ctx, onRun: () => ['simulated output'] }, 'run test');
    assertEqual(result.lines, ['simulated output'], 'delegates to onRun');
    const bare = runCommand(ctx, 'run test');
    assertEqual(bare.lines, [], 'no onRun yields no fabricated output');
  });

  check('run rejects unknown tasks', () => {
    const ctx = makeContext();
    assertEqual(runCommand(ctx, 'run deploy').exitCode, 1, 'exit 1');
  });

  check('env states the execution boundary', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'env');
    assert(result.lines.includes('PROCESS_EXECUTION=disabled'), 'no process execution');
    assert(result.lines.includes('NETWORK=disabled'), 'no network');
    assert(result.lines.includes('PERSISTENCE=none'), 'no persistence');
  });

  check('help lists the command surface', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, 'help');
    assert(result.lines.length > 8, 'help is substantive');
    assert(result.lines.some((line) => line.includes('virtual workspace')), 'states the boundary');
  });

  check('empty input is a no-op', () => {
    const ctx = makeContext();
    const result = runCommand(ctx, '   ');
    assertEqual(result.lines, [], 'no output');
    assertEqual(result.exitCode, 0, 'exit 0');
  });

  check('terminal mutations are visible to the editor workspace', () => {
    const ctx = makeContext();
    runCommand(ctx, 'mkdir notes');
    runCommand(ctx, 'touch notes/today.md');
    assert(ctx.workspace.isFile('/workspace/notes/today.md'), 'shared instance');
  });

  cleanup();

  console.log(`\n${failures.length === 0 ? '\u2713' : '\u2717'} Matrix IDE: ${passed} passed, ${failures.length} failed\n`);
  if (failures.length) {
    for (const failure of failures) console.log(`  FAILED: ${failure.name}\n    ${failure.message}`);
  }
  return { passed, failed: failures.length };
}

// Standalone execution: `node tests/matrix-ide.test.mjs`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runAllTests();
  process.exit(result.failed > 0 ? 1 : 0);
}
