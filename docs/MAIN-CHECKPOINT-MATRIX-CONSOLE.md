# Checkpoint carried from `main`: Matrix Console prototype

Preserves the `HANDOFF.md` checkpoint that landed on `main` via PR #11
(`519a490`, merge commit `91d9517`) while the security stack was rebased onto
that same commit. Security branches keep their own `HANDOFF.md` ledger; this
file carries main's console checkpoint so no ledger content is lost.

- Scope: standalone `apps/matrix-console/` React + TypeScript + Vite demo UI.
- Data: local demonstration data only. No model, agent execution, durable
  storage, browser takeover or terminal is exposed.
- Deployment: Cloudflare staging not claimed; production unchanged.
- Scripts preserved in `package.json`: `typecheck:matrix-console`,
  `build:matrix-console`, `test:matrix-console`, `create:cloudflare-manifest`,
  `deploy:matrix-console:wrangler`.
