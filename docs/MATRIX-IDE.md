# Matrix IDE

A VS Code-class workbench surface inside the Matrix Console: editor, file
explorer, tabs, quick-open and an integrated terminal.

- **Surface route:** `/ide` (deep-linkable; the console shell is at `/`)
- **Source:** `apps/matrix-console/src/ide/`
- **Tests:** `tests/matrix-ide.test.mjs` (run by `npm test` and
  `npm run test:matrix-ide`), plus IDE markers in `tests/matrix-console-smoke.mjs`

---

## 1. What is real

| Capability | Implementation | Evidence |
|---|---|---|
| Code editor | CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `language`, `search`, `autocomplete`) | `src/ide/CodeEditor.tsx` |
| Syntax highlighting | TS/TSX, JS/JSX, JSON, Markdown, CSS, HTML, Python, Shell, YAML | `languageFor()` in `src/ide/workspace.ts` |
| Editing features | line numbers, active-line, bracket matching, code folding, multi-cursor, rectangular selection, search & replace, autocompletion, close-brackets, undo/redo | `CodeEditor.tsx` extension set |
| File explorer | nested tree, expand/collapse, active-file highlight, new file, collapse-all | `MatrixIDE.tsx` |
| Tabs | open/close, active state, dirty indicator, per-file language | `MatrixIDE.tsx` |
| Quick open | `Ctrl/Cmd+P` fuzzy path search over the workspace | `MatrixIDE.tsx` |
| Integrated terminal | 30+ commands interpreted against the same virtual workspace the editor edits | `src/ide/terminal.ts` |
| Save | `Ctrl/Cmd+S` writes the buffer to the virtual workspace | `MatrixIDE.tsx` |
| Status bar | branch, dirty count, language, line count, encoding, indent | `MatrixIDE.tsx` |
| Code splitting | the IDE is a lazy chunk; the console shell does not bundle CodeMirror | `lazy()` in `App.tsx`; `dist/assets/MatrixIDE-*.js` |

### Terminal command surface

```
Navigation   pwd · cd <dir> · ls [-l] [path] · tree [path] · find <pattern>
Files        cat <file> · head <file> · tail <file> · wc <file> · stat <file>
Modify       mkdir <dir> · touch <file> · rm [-r] <path> · mv <a> <b> · cp <a> <b>
Search       grep <pattern> <file…>
Editor       open <file> · edit <file> · save
Project      run test · run build · git status · git log · git branch
Session      clear · history · date · whoami · uname · env · help
```

---

## 2. What is NOT real (the boundary)

The IDE is a **browser-local, in-memory workbench**. It is deliberately honest
about this, and the boundary is stated in the UI itself:

- **No remote repository.** Nothing is cloned, fetched, committed or pushed.
  `git status` says "No remote is attached"; `git push` is refused with exit 1.
- **No process execution.** The terminal never spawns a process. `run test` and
  `run build` print clearly-labelled *simulated* output; with no handler
  attached they print nothing rather than fabricating a result.
- **No network.** `env` reports `NETWORK=disabled`.
- **No persistence.** The workspace lives in memory and is gone on reload.
  `env` reports `PERSISTENCE=none`.
- **Session changes are disposable.** Saving writes to the in-memory workspace,
  not durable storage. The IDE warns before closing dirty buffers, exiting after
  session changes, or reloading/leaving the page.
- **Virtual root confinement.** Paths are normalized and must remain under
  `/workspace`; attempts to traverse outside it return a virtual `EPERM` error.
- **No host access.** Unknown commands fail closed with exit code 127 and the
  message "this terminal is bound to the virtual workspace and cannot execute
  host commands".

The status bar carries the same statement: `No remote · no process execution`.

This is the same truthfulness discipline the rest of the console uses
(`DEMO MODE`, `MODEL OFFLINE`, `Unavailable` badges). The IDE is a **real
editor over a virtual workspace**, not a simulated terminal pretending to be a
machine.

---

## 3. Architecture

```
src/ide/
  workspace.ts    VirtualWorkspace — in-memory FS (read/write/mkdir/remove/
                  list/tree/allFiles/size), path normalisation, language map,
                  and the seed RADARMatrix tree. Dependency-free.
  terminal.ts     runCommand(context, input) — pure command interpreter over a
                  VirtualWorkspace. Returns { lines, cwd, exitCode, clear?,
                  openPath? }. Dependency-free.
  CodeEditor.tsx  CodeMirror 6 wrapper: owns the EditorView lifecycle, pushes
                  doc changes up, swaps language/read-only via Compartments.
  MatrixIDE.tsx   The workbench: activity bar, explorer, tabs, editor, terminal,
                  status bar, quick-open palette, toasts.
  ide.css         Design-system-aligned styles.
```

`workspace.ts` and `terminal.ts` are dependency-free and side-effect-free, which
is what makes them directly unit-testable. `MatrixIDE.tsx` owns all React state;
the editor is controlled (the parent holds the document text), so tabs, dirty
state and the terminal all read from one source of truth.

### Why the test bundles the source

The suite bundles the two dependency-free TypeScript modules with **rolldown**,
pinned as a direct devDependency of the console app, into a temp directory and
imports the emitted ESM. It exercises the real source, not a re-implementation.

---

## 4. Design-system conformance

`ide.css` reuses the console tokens (`--bg`, `--panel`, `--line`, `--gold`,
`--blue`, `--violet`, `--red`, `--sans`, `--display`) and adds an IDE-scoped
palette. Quality bar:

- **No text wrapping in chrome** — every label is `white-space: nowrap` with
  `text-overflow: ellipsis`; long paths truncate rather than wrap.
- **No horizontal overflow** — `min-width: 0` on every flex/grid child that can
  shrink; confirm actual rendered widths in a browser before release.
- **Animations** — fade-in on mount, palette/toast entrances, a pulsing
  workspace dot and welcome mark, caret rotation on tree expand.
- **Reduced motion** — `@media (prefers-reduced-motion: reduce)` disables every
  animation and transition.
- **Forced colours** — `@media (forced-colors: active)` outlines active rows.
- **Breakpoints** — 1100 / 860 / 720 / 480 px; the explorer becomes a drawer
  below 720 px and the status bar sheds low-priority items.
- **Accessibility** — tree items expose hierarchy and keyboard navigation;
  editor tabs expose a tab/tabpanel relationship and keyboard selection;
  quick-open uses a modal dialog with focus containment and restoration.

---

## 5. Verification

Local verification commands for this candidate:

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build:matrix-console` | pass — console 243.37 kB (75.26 kB gzip), IDE lazy chunk 682.22 kB (237.82 kB gzip); Vite warns that the IDE chunk exceeds 500 kB |
| `npm test` | pass — root suites plus 43 IDE assertions; nonzero failure propagation verified with a temporary injected assertion failure |
| `npm run test:matrix-ide` | pass — 43 assertions |
| `npm run test:deployment` | pass — storage failures block health/workspace reads and asset writes; missing auth fails closed |
| `npm run test:matrix-console` | pass — IDE source, route, code-split and truthfulness markers |
| Browser responsive render and accessibility scan | Not covered by the automated Node test suite; verify in a browser before release |

No responsive browser-render or automated screen-reader scan was run for this
candidate; those remain release checks.

---

## 6. Honest limitations

1. **No real repository integration.** Wiring the IDE to a real Git host
   (clone/commit/push) is a separate, approval-gated capability. It is not
   present here and is not claimed.
2. **No language server.** Highlighting, folding and bracket matching are
   syntax-level. There is no LSP, no type checking in the editor, no
   diagnostics.
3. **No persistence.** Reloading the page resets the workspace to the seed tree.
4. **No file upload/download.** Files are created and edited in memory only.
5. **`run test` / `run build` are simulations.** They are labelled as such in
   their own output. They do not execute the repository's real scripts.
6. **The seed tree is illustrative.** It mirrors the shape of RADARMatrix but is
   not a live checkout.

---

## 7. Next steps (not done here)

- Wire the editor to a real workspace provider behind an approval gate
  (the same gate discipline the security stack uses).
- Add an LSP-backed diagnostics panel once a language server can run in a
  sandboxed worker.
- Persist the workspace to a durable store (depends on the M7 storage decision).
